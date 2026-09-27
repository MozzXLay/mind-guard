use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    commands::RestorePreview,
    domain::{VaultError, VaultResult},
};

const FORMAT_VERSION: u32 = 1;
const DB_NAME: &str = "vault.db";
const MANIFEST_NAME: &str = "vault.json";
const KEY_AAD: &[u8] = b"mindguard:data-key:v1";
const BACKUP_AAD: &[u8] = b"mindguard:backup:v1";
const MAX_BACKUP_BYTES: u64 = 128 * 1024 * 1024;

mod daily;
mod zone;
pub use daily::{BehaviorEvent, EventInput, Goal, PlanAction, SosInput, SosSession, TodaySnapshot};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format_version: u32,
    kdf_version: u32,
    memory_kib: u32,
    iterations: u32,
    lanes: u32,
    salt: String,
    wrap_nonce: String,
    wrapped_key: String,
    created_at: u64,
    auto_lock_minutes: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupFile {
    format_version: u32,
    manifest: Manifest,
    nonce: String,
    encrypted_database: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
    pub auto_lock_minutes: u32,
    pub recovery_required: bool,
}

pub struct VaultService {
    data_dir: PathBuf,
    data_key: Option<Zeroizing<[u8; 32]>>,
    last_activity: Option<Instant>,
    failed_attempts: u32,
    retry_after: Option<Instant>,
}

impl VaultService {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            data_key: None,
            last_activity: None,
            failed_attempts: 0,
            retry_after: None,
        }
    }

    fn db_path(&self) -> PathBuf {
        self.data_dir.join(DB_NAME)
    }
    fn manifest_path(&self) -> PathBuf {
        self.data_dir.join(MANIFEST_NAME)
    }

    pub fn status(&mut self) -> VaultResult<VaultStatus> {
        let manifest_exists = self.manifest_path().exists();
        let db_exists = self.db_path().exists();
        let initialized = manifest_exists || db_exists;
        let manifest = if manifest_exists { self.read_manifest().ok() } else { None };
        let recovery_required = initialized && (!manifest_exists || !db_exists || manifest.is_none());
        let minutes = manifest.map(|m| m.auto_lock_minutes).unwrap_or(10);
        self.expire(minutes);
        if recovery_required { self.data_key = None; self.last_activity = None; }
        Ok(VaultStatus {
            initialized,
            unlocked: self.data_key.is_some() && !recovery_required,
            auto_lock_minutes: minutes,
            recovery_required,
        })
    }

    fn expire(&mut self, minutes: u32) {
        if self
            .last_activity
            .is_some_and(|at| at.elapsed() >= Duration::from_secs(u64::from(minutes) * 60))
        {
            self.data_key = None;
            self.last_activity = None;
        }
    }

    fn require_key(&mut self) -> VaultResult<Zeroizing<[u8; 32]>> {
        self.expire(self.read_manifest()?.auto_lock_minutes);
        let key = self.data_key.as_ref().ok_or_else(VaultError::locked)?;
        self.last_activity = Some(Instant::now());
        Ok(Zeroizing::new(**key))
    }

    pub fn touch(&mut self) -> VaultResult<()> {
        let _key = self.require_key()?;
        Ok(())
    }

    pub fn initialize(&mut self, password: &str, goals: &[String]) -> VaultResult<VaultStatus> {
        validate_password(password)?;
        if goals.len() > 4
            || goals
                .iter()
                .any(|s| s.trim().is_empty() || s.chars().count() > 100)
        {
            return Err(VaultError::invalid());
        }
        ensure_private_dir(&self.data_dir)?;
        if self.manifest_path().exists() || self.db_path().exists() {
            return Err(VaultError::conflict());
        }

        let mut data_key = Zeroizing::new([0u8; 32]);
        getrandom::fill(&mut *data_key).map_err(|_| VaultError::crypto())?;
        let manifest = make_manifest(password, &data_key)?;
        let db_path = self.db_path();
        create_private_file(&db_path)?;
        let result = (|| {
            let db = open_db(&db_path, &data_key, true)?;
            for goal in goals {
                let kind = match goal.as_str() {
                    "减少色情内容浏览" => "reduce_content",
                    "减少深夜使用" => "avoid_late_night",
                    "观察冲动和触发因素" => "observe_urge",
                    _ => "custom",
                };
                db.execute(
                    "INSERT INTO goal (id, kind, title) VALUES (?1, ?2, ?3)",
                    (random_uuid()?, kind, goal.trim()),
                )
                .map_err(|_| VaultError::io())?;
            }
            drop(db);
            atomic_write(
                &self.manifest_path(),
                &serde_json::to_vec(&manifest).map_err(|_| VaultError::io())?,
            )
        })();
        if result.is_err() {
            if !self.manifest_path().exists() { let _ = fs::remove_file(&db_path); }
            return result.map(|_| unreachable!());
        }
        self.data_key = Some(data_key);
        self.last_activity = Some(Instant::now());
        self.status()
    }

    pub fn unlock(&mut self, password: &str) -> VaultResult<VaultStatus> {
        if self.retry_after.is_some_and(|when| Instant::now() < when) {
            return Err(VaultError::new("CONFLICT", "尝试过于频繁，请稍后再试。"));
        }
        let manifest = self.read_manifest()?;
        let key = match unwrap_key(&manifest, password) {
            Ok(key) => key,
            Err(_) => {
                self.failed_attempts += 1;
                if self.failed_attempts >= 5 {
                    self.retry_after = Some(Instant::now() + Duration::from_secs(30));
                    self.failed_attempts = 0;
                }
                return Err(VaultError::crypto());
            }
        };
        let db = open_db(&self.db_path(), &key, false)?;
        verify_db(&db)?;
        drop(db);
        self.data_key = Some(key);
        self.last_activity = Some(Instant::now());
        self.failed_attempts = 0;
        self.retry_after = None;
        self.status()
    }

    pub fn lock(&mut self) -> VaultResult<VaultStatus> {
        self.data_key = None;
        self.last_activity = None;
        self.status()
    }

    pub fn list_goals(&mut self) -> VaultResult<Vec<String>> {
        let key = self.require_key()?;
        let db = open_db(&self.db_path(), &key, false)?;
        let mut stmt = db
            .prepare("SELECT title FROM goal ORDER BY rowid")
            .map_err(|_| VaultError::io())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|_| VaultError::io())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| VaultError::io())
    }

    pub fn set_auto_lock_minutes(&mut self, minutes: u32) -> VaultResult<VaultStatus> {
        if ![5, 10, 30].contains(&minutes) {
            return Err(VaultError::invalid());
        }
        let _key = self.require_key()?;
        let mut manifest = self.read_manifest()?;
        manifest.auto_lock_minutes = minutes;
        atomic_write(
            &self.manifest_path(),
            &serde_json::to_vec(&manifest).map_err(|_| VaultError::io())?,
        )?;
        self.status()
    }

    pub fn create_backup(&mut self, password: &str) -> VaultResult<PathBuf> {
        let key = self.require_key()?;
        let manifest = self.read_manifest()?;
        let confirmed = unwrap_key(&manifest, password)?;
        if *confirmed != *key {
            return Err(VaultError::crypto());
        }
        let db = open_db(&self.db_path(), &key, false)?;
        verify_db(&db)?;
        drop(db);

        let database = fs::read(self.db_path()).map_err(|_| VaultError::io())?;
        let nonce = random_array::<24>()?;
        let cipher = XChaCha20Poly1305::new(Key::from_slice(&*key));
        let encrypted = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &database,
                    aad: BACKUP_AAD,
                },
            )
            .map_err(|_| VaultError::crypto())?;
        let file = BackupFile {
            format_version: FORMAT_VERSION,
            manifest,
            nonce: hex::encode(nonce),
            encrypted_database: STANDARD.encode(encrypted),
        };
        let backups_dir = self.data_dir.join("backups");
        ensure_private_dir(&backups_dir)?;
        let filename = format!(
            "mindguard-{}-{}.mgb",
            now_secs()?,
            hex::encode(random_array::<4>()?)
        );
        let path = backups_dir.join(filename);
        atomic_write(
            &path,
            &serde_json::to_vec(&file).map_err(|_| VaultError::io())?,
        )?;
        Ok(path)
    }

    pub fn preview_restore(&mut self, path: &Path, password: &str) -> VaultResult<RestorePreview> {
        let (file, key, database) = load_backup(path, password)?;
        let (count, _) = self.verify_candidate(&database, &key)?;
        Ok(RestorePreview {
            goal_count: count,
            created_at: file.manifest.created_at,
        })
    }

    pub fn restore_backup(&mut self, path: &Path, password: &str) -> VaultResult<VaultStatus> {
        let (file, key, database) = load_backup(path, password)?;
        let (_, database) = self.verify_candidate(&database, &key)?;

        ensure_private_dir(&self.data_dir)?;

        let suffix = hex::encode(random_array::<8>()?);
        let staged_db = self.data_dir.join(format!(".restore-{suffix}.db"));
        let staged_manifest = self.data_dir.join(format!(".restore-{suffix}.json"));
        let old_db = self.data_dir.join(format!(".rollback-{suffix}.db"));
        let old_manifest = self.data_dir.join(format!(".rollback-{suffix}.json"));
        create_private_file(&staged_db)?;
        let result = (|| {
            write_existing(&staged_db, &database)?;
            atomic_write(
                &staged_manifest,
                &serde_json::to_vec(&file.manifest).map_err(|_| VaultError::io())?,
            )?;
            let had_db = self.db_path().exists();
            let had_manifest = self.manifest_path().exists();
            if had_db { fs::rename(self.db_path(), &old_db).map_err(|_| VaultError::io())?; }
            if had_manifest && fs::rename(self.manifest_path(), &old_manifest).is_err() {
                if had_db { let _ = fs::rename(&old_db, self.db_path()); }
                return Err(VaultError::io());
            }
            if fs::rename(&staged_db, self.db_path()).is_err() {
                if had_db { let _ = fs::rename(&old_db, self.db_path()); }
                if had_manifest { let _ = fs::rename(&old_manifest, self.manifest_path()); }
                return Err(VaultError::io());
            }
            if fs::rename(&staged_manifest, self.manifest_path()).is_err() {
                let _ = fs::remove_file(self.db_path());
                if had_db { let _ = fs::rename(&old_db, self.db_path()); }
                if had_manifest { let _ = fs::rename(&old_manifest, self.manifest_path()); }
                return Err(VaultError::io());
            }
            let _ = File::open(&self.data_dir).and_then(|dir| dir.sync_all());
            Ok(())
        })();
        let _ = fs::remove_file(&staged_db);
        let _ = fs::remove_file(&staged_manifest);
        result?;
        // The previous encrypted SQLCipher database and its wrapped-key manifest
        // remain together under the same rollback suffix for manual reversal.
        self.data_key = Some(key);
        self.last_activity = Some(Instant::now());
        self.status()
    }

    fn verify_candidate(&self, database: &[u8], key: &[u8; 32]) -> VaultResult<(u64, Vec<u8>)> {
        ensure_private_dir(&self.data_dir)?;
        let path = self
            .data_dir
            .join(format!(".verify-{}.db", hex::encode(random_array::<8>()?)));
        create_private_file(&path)?;
        let result = (|| {
            write_existing(&path, database)?;
            let db = open_db(&path, key, false)?;
            verify_db(&db)?;
            let count = db.query_row("SELECT COUNT(*) FROM goal", [], |row| row.get::<_, i64>(0))
                .map(|count| count as u64)
                .map_err(|_| VaultError::crypto())?;
            drop(db);
            Ok((count, fs::read(&path).map_err(|_| VaultError::io())?))
        })();
        let _ = fs::remove_file(path);
        result
    }

    fn read_manifest(&self) -> VaultResult<Manifest> {
        reject_symlink(&self.manifest_path())?;
        let bytes = fs::read(self.manifest_path()).map_err(|_| VaultError::io())?;
        if bytes.len() > 16 * 1024 {
            return Err(VaultError::unsupported());
        }
        let manifest: Manifest =
            serde_json::from_slice(&bytes).map_err(|_| VaultError::unsupported())?;
        validate_manifest(&manifest)?;
        Ok(manifest)
    }
}

fn validate_password(password: &str) -> VaultResult<()> {
    if password.chars().count() < 12 || password.len() > 1024 {
        Err(VaultError::invalid())
    } else {
        Ok(())
    }
}

fn validate_manifest(manifest: &Manifest) -> VaultResult<()> {
    if manifest.format_version != FORMAT_VERSION
        || manifest.kdf_version != 1
        || !(8 * 1024..=256 * 1024).contains(&manifest.memory_kib)
        || !(1..=10).contains(&manifest.iterations)
        || !(1..=4).contains(&manifest.lanes)
        || ![5, 10, 30].contains(&manifest.auto_lock_minutes)
    {
        return Err(VaultError::unsupported());
    }
    Ok(())
}

fn derive_wrap_key(manifest: &Manifest, password: &str) -> VaultResult<Zeroizing<[u8; 32]>> {
    validate_manifest(manifest)?;
    let salt = hex::decode(&manifest.salt).map_err(|_| VaultError::unsupported())?;
    if salt.len() != 16 {
        return Err(VaultError::unsupported());
    }
    let params = Params::new(
        manifest.memory_kib,
        manifest.iterations,
        manifest.lanes,
        Some(32),
    )
    .map_err(|_| VaultError::unsupported())?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(password.as_bytes(), &salt, &mut *key)
        .map_err(|_| VaultError::crypto())?;
    Ok(key)
}

fn make_manifest(password: &str, data_key: &[u8; 32]) -> VaultResult<Manifest> {
    let salt = random_array::<16>()?;
    let nonce = random_array::<24>()?;
    let mut manifest = Manifest {
        format_version: FORMAT_VERSION,
        kdf_version: 1,
        memory_kib: 65_536,
        iterations: 3,
        lanes: 1,
        salt: hex::encode(salt),
        wrap_nonce: hex::encode(nonce),
        wrapped_key: String::new(),
        created_at: now_secs()?,
        auto_lock_minutes: 10,
    };
    let wrap_key = derive_wrap_key(&manifest, password)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&*wrap_key));
    let wrapped = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: data_key,
                aad: KEY_AAD,
            },
        )
        .map_err(|_| VaultError::crypto())?;
    manifest.wrapped_key = STANDARD.encode(wrapped);
    Ok(manifest)
}

fn unwrap_key(manifest: &Manifest, password: &str) -> VaultResult<Zeroizing<[u8; 32]>> {
    let wrap_key = derive_wrap_key(manifest, password)?;
    let nonce = hex::decode(&manifest.wrap_nonce).map_err(|_| VaultError::unsupported())?;
    if nonce.len() != 24 {
        return Err(VaultError::unsupported());
    }
    let wrapped = STANDARD
        .decode(&manifest.wrapped_key)
        .map_err(|_| VaultError::unsupported())?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&*wrap_key));
    let unwrapped = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &wrapped,
                aad: KEY_AAD,
            },
        )
        .map_err(|_| VaultError::crypto())?;
    let array: [u8; 32] = unwrapped
        .try_into()
        .map_err(|_| VaultError::unsupported())?;
    Ok(Zeroizing::new(array))
}

fn open_db(path: &Path, key: &[u8; 32], create: bool) -> VaultResult<Connection> {
    reject_symlink(path)?;
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | if create {
            OpenFlags::SQLITE_OPEN_CREATE
        } else {
            OpenFlags::empty()
        };
    let db = Connection::open_with_flags(path, flags).map_err(|_| VaultError::io())?;
    let mut key_hex = hex::encode(key);
    let mut key_statement = format!("PRAGMA key = \"x'{key_hex}'\";");
    key_hex.zeroize();
    let key_result = db.execute_batch(&key_statement);
    key_statement.zeroize();
    key_result.map_err(|_| VaultError::crypto())?;
    let version: String = db
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .map_err(|_| VaultError::unsupported())?;
    if version.is_empty() {
        return Err(VaultError::unsupported());
    }
    db.execute_batch("PRAGMA cipher_memory_security = ON; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;").map_err(|_| VaultError::crypto())?;
    if create {
        db.execute_batch("BEGIN IMMEDIATE;").map_err(|_| VaultError::io())?;
        if db.execute_batch(include_str!("../../migrations/0001_initial.sql")).is_err() {
            let _ = db.execute_batch("ROLLBACK;");
            return Err(VaultError::io());
        }
        db.execute_batch("COMMIT;").map_err(|_| VaultError::io())?;
    } else { verify_db(&db)?; }
    let schema: u32 = db.query_row("SELECT MAX(version) FROM schema_migration", [], |row| row.get(0))
        .map_err(|_| VaultError::crypto())?;
    match schema {
        1 => {
            db.execute_batch("BEGIN IMMEDIATE;").map_err(|_| VaultError::io())?;
            if db.execute_batch(include_str!("../../migrations/0002_daily_loop.sql")).is_err() {
                let _ = db.execute_batch("ROLLBACK;");
                return Err(VaultError::io());
            }
            db.execute_batch("COMMIT;").map_err(|_| VaultError::io())?;
        }
        2 => (),
        _ => return Err(VaultError::unsupported()),
    }
    Ok(db)
}

fn verify_db(db: &Connection) -> VaultResult<()> {
    let result: String = db
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|_| VaultError::crypto())?;
    if result != "ok" {
        return Err(VaultError::crypto());
    }
    Ok(())
}

fn load_backup(
    path: &Path,
    password: &str,
) -> VaultResult<(BackupFile, Zeroizing<[u8; 32]>, Vec<u8>)> {
    reject_symlink(path)?;
    let metadata = fs::metadata(path).map_err(|_| VaultError::io())?;
    if !metadata.is_file() || metadata.len() > MAX_BACKUP_BYTES {
        return Err(VaultError::unsupported());
    }
    let bytes = fs::read(path).map_err(|_| VaultError::io())?;
    let file: BackupFile = serde_json::from_slice(&bytes).map_err(|_| VaultError::unsupported())?;
    if file.format_version != FORMAT_VERSION {
        return Err(VaultError::unsupported());
    }
    let key = unwrap_key(&file.manifest, password)?;
    let nonce = hex::decode(&file.nonce).map_err(|_| VaultError::unsupported())?;
    if nonce.len() != 24 {
        return Err(VaultError::unsupported());
    }
    let ciphertext = STANDARD
        .decode(&file.encrypted_database)
        .map_err(|_| VaultError::unsupported())?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&*key));
    let database = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: BACKUP_AAD,
            },
        )
        .map_err(|_| VaultError::crypto())?;
    Ok((file, key, database))
}

fn ensure_private_dir(path: &Path) -> VaultResult<()> {
    fs::create_dir_all(path).map_err(|_| VaultError::io())?;
    reject_symlink(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| VaultError::io())
}

fn reject_symlink(path: &Path) -> VaultResult<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(VaultError::io()),
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(VaultError::io()),
    }
}

fn create_private_file(path: &Path) -> VaultResult<()> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map(|_| ())
        .map_err(|_| VaultError::io())
}

fn write_existing(path: &Path, bytes: &[u8]) -> VaultResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|_| VaultError::io())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| VaultError::io())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> VaultResult<()> {
    let parent = path.parent().ok_or_else(VaultError::io)?;
    let temp = parent.join(format!(".write-{}", hex::encode(random_array::<8>()?)));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|_| VaultError::io())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| VaultError::io())?;
        fs::rename(&temp, path).map_err(|_| VaultError::io())?;
        File::open(parent)
            .and_then(|dir| dir.sync_all())
            .map_err(|_| VaultError::io())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

fn random_array<const N: usize>() -> VaultResult<[u8; N]> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| VaultError::crypto())?;
    Ok(bytes)
}

fn random_uuid() -> VaultResult<String> {
    let mut bytes = random_array::<16>()?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = hex::encode(bytes);
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

fn now_secs() -> VaultResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|_| VaultError::io())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWORD: &str = "a long unique test password 2026";
    const OTHER_PASSWORD: &str = "another unique password 2026";

    #[test]
    fn create_reopen_backup_and_restore_without_plaintext() {
        let home = tempfile::tempdir().unwrap();
        let marker = "私人测试备注-仅在密文数据库".to_string();
        let mut first = VaultService::new(home.path().join("first"));
        first.initialize(PASSWORD, &[marker.clone()]).unwrap();
        assert_eq!(first.list_goals().unwrap(), vec![marker.clone()]);
        assert_eq!(
            fs::metadata(&first.data_dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(first.db_path()).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let db_bytes = fs::read(first.db_path()).unwrap();
        assert!(!db_bytes.starts_with(b"SQLite format 3"));
        assert!(!db_bytes
            .windows(marker.len())
            .any(|part| part == marker.as_bytes()));
        assert!(!fs::read(first.manifest_path())
            .unwrap()
            .windows(marker.len())
            .any(|part| part == marker.as_bytes()));

        assert!(first.create_backup("wrong password here").is_err());
        let backup = first.create_backup(PASSWORD).unwrap();
        let backup_bytes = fs::read(&backup).unwrap();
        assert!(!backup_bytes
            .windows(marker.len())
            .any(|part| part == marker.as_bytes()));
        assert_eq!(
            fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
            0o600
        );
        first.lock().unwrap();
        drop(first);

        let mut reopened = VaultService::new(home.path().join("first"));
        assert!(!reopened.status().unwrap().unlocked);
        assert!(reopened.list_goals().is_err());
        assert!(reopened.unlock(OTHER_PASSWORD).is_err());
        reopened.unlock(PASSWORD).unwrap();
        assert_eq!(reopened.list_goals().unwrap(), vec![marker.clone()]);

        let mut second = VaultService::new(home.path().join("second"));
        second
            .initialize(OTHER_PASSWORD, &["different goal".to_string()])
            .unwrap();
        assert!(second.preview_restore(&backup, OTHER_PASSWORD).is_err());
        assert_eq!(second.list_goals().unwrap(), vec!["different goal"]);
        let preview = second.preview_restore(&backup, PASSWORD).unwrap();
        assert_eq!(preview.goal_count, 1);
        second.restore_backup(&backup, PASSWORD).unwrap();
        assert_eq!(second.list_goals().unwrap(), vec![marker]);
        second.lock().unwrap();
        assert!(second.unlock(OTHER_PASSWORD).is_err());
        second.unlock(PASSWORD).unwrap();
    }

    #[test]
    fn damaged_backup_does_not_replace_current_vault() {
        let home = tempfile::tempdir().unwrap();
        let mut vault = VaultService::new(home.path().join("vault"));
        vault
            .initialize(PASSWORD, &["current goal".to_string()])
            .unwrap();
        let backup = vault.create_backup(PASSWORD).unwrap();
        let mut bytes = fs::read(&backup).unwrap();
        let position = bytes
            .iter()
            .position(|b| *b == b'X')
            .unwrap_or(bytes.len() / 2);
        bytes[position] ^= 1;
        let bad = home.path().join("damaged.mgb");
        fs::write(&bad, bytes).unwrap();
        assert!(vault.restore_backup(&bad, PASSWORD).is_err());
        assert_eq!(vault.list_goals().unwrap(), vec!["current goal"]);
    }

    #[test]
    fn v1_backup_restores_without_current_vault_and_preserves_orphans() {
        let home = tempfile::tempdir().unwrap();
        let mut old = VaultService::new(home.path().join("old"));
        old.initialize(PASSWORD, &["old identity".into()]).unwrap();
        let key = old.require_key().unwrap();
        let db = open_db(&old.db_path(), &key, false).unwrap();
        db.execute_batch("BEGIN; DROP TABLE journal_entry; DROP TABLE urge_session; DROP TABLE action_completion; DROP TABLE plan_action; DROP TABLE event_trigger; DROP TABLE behavior_event; DELETE FROM schema_migration WHERE version=2; COMMIT;").unwrap();
        drop(db);
        let v1 = create_backup_v1_for_test(&mut old, PASSWORD);
        assert!(v1.is_ok());
        let backup = v1.unwrap();
        old.lock().unwrap();

        let mut fresh = VaultService::new(home.path().join("fresh"));
        assert!(!fresh.status().unwrap().initialized);
        assert!(fresh.preview_restore(&backup, OTHER_PASSWORD).is_err());
        assert_eq!(fresh.preview_restore(&backup, PASSWORD).unwrap().goal_count, 1);
        fresh.restore_backup(&backup, PASSWORD).unwrap();
        assert_eq!(fresh.list_goals().unwrap(), vec!["old identity"]);
        assert_eq!(open_db(&fresh.db_path(), &fresh.require_key().unwrap(), false).unwrap().query_row("SELECT MAX(version) FROM schema_migration", [], |r| r.get::<_, i64>(0)).unwrap(), 2);

        let mut orphan = VaultService::new(home.path().join("orphan"));
        ensure_private_dir(&orphan.data_dir).unwrap();
        fs::copy(old.manifest_path(), orphan.manifest_path()).unwrap();
        assert!(orphan.status().unwrap().recovery_required);
        assert!(orphan.initialize(PASSWORD, &[]).is_err());
        orphan.restore_backup(&backup, PASSWORD).unwrap();
        assert!(orphan.data_dir.read_dir().unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().starts_with(".rollback-") ));
    }

    #[cfg(test)]
    fn create_backup_v1_for_test(vault: &mut VaultService, password: &str) -> VaultResult<PathBuf> {
        // Save the v1 image without opening it through the migration path.
        let key = vault.require_key()?;
        let manifest = vault.read_manifest()?;
        let confirmed = unwrap_key(&manifest, password)?;
        if *confirmed != *key { return Err(VaultError::crypto()); }
        let database = fs::read(vault.db_path()).map_err(|_| VaultError::io())?;
        let nonce = random_array::<24>()?;
        let encrypted = XChaCha20Poly1305::new(Key::from_slice(&*key))
            .encrypt(XNonce::from_slice(&nonce), Payload { msg: &database, aad: BACKUP_AAD })
            .map_err(|_| VaultError::crypto())?;
        let path = vault.data_dir.join("v1.mgb");
        atomic_write(&path, &serde_json::to_vec(&BackupFile { format_version: 1, manifest, nonce: hex::encode(nonce), encrypted_database: STANDARD.encode(encrypted) }).unwrap())?;
        Ok(path)
    }
}
