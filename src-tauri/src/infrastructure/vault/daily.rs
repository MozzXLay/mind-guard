use super::*;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventInput {
    pub event_type: String,
    pub occurred_at_utc_ms: i64,
    pub zone_id: String,
    pub intensity: Option<i64>,
    pub note: Option<String>,
    pub triggers: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorEvent {
    pub id: String,
    pub event_type: String,
    pub occurred_at_utc_ms: i64,
    pub zone_id: String,
    pub local_date: String,
    pub local_hour: i64,
    pub intensity: Option<i64>,
    pub note: Option<String>,
    pub triggers: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodaySnapshot {
    pub today_events: u64,
    pub logged_days_last7: u64,
    pub recent: Vec<BehaviorEvent>,
}

fn now_ms() -> VaultResult<i64> { Ok((now_secs()? as i64) * 1000) }
fn valid_type(t: &str) -> bool { matches!(t, "urge" | "viewed_content" | "stopped_viewing" | "masturbation" | "alternative_action") }
fn valid_trigger(t: &str) -> bool { matches!(t, "boredom" | "stress" | "loneliness" | "anxiety" | "fatigue" | "sleep_loss" | "desire" | "habit" | "other") }
fn validate_event(input: &EventInput) -> VaultResult<(String, u32)> {
    if !valid_type(&input.event_type)
        || !(0..=10).contains(&input.intensity.unwrap_or(0))
        || input.note.as_ref().is_some_and(|n| n.chars().count() > 2000)
        || input.triggers.len() > 9
        || input.triggers.iter().any(|t| !valid_trigger(t))
        || input.occurred_at_utc_ms < 0
        || input.occurred_at_utc_ms > 4_102_444_800_000
    { return Err(VaultError::invalid()); }
    let mut unique = input.triggers.clone();
    unique.sort(); unique.dedup();
    if unique.len() != input.triggers.len() { return Err(VaultError::invalid()); }
    zone::local_parts(input.occurred_at_utc_ms, &input.zone_id)
}

fn get_event(db: &Connection, id: &str) -> VaultResult<BehaviorEvent> {
    let mut event = db.query_row("SELECT id,type,occurred_at_utc_ms,zone_id,local_date,local_hour,intensity,note FROM behavior_event WHERE id=?1", [id], |r| Ok(BehaviorEvent {
        id: r.get(0)?, event_type: r.get(1)?, occurred_at_utc_ms: r.get(2)?, zone_id: r.get(3)?, local_date: r.get(4)?, local_hour: r.get(5)?, intensity: r.get(6)?, note: r.get(7)?, triggers: Vec::new(),
    })).optional().map_err(|_| VaultError::io())?.ok_or_else(VaultError::invalid)?;
    let mut stmt = db.prepare("SELECT code FROM event_trigger WHERE event_id=?1 ORDER BY code").map_err(|_| VaultError::io())?;
    event.triggers = stmt.query_map([id], |r| r.get(0)).map_err(|_| VaultError::io())?.collect::<Result<Vec<_>,_>>().map_err(|_| VaultError::io())?;
    Ok(event)
}

impl VaultService {
    pub fn today_snapshot(&mut self, today: &str, from: &str) -> VaultResult<TodaySnapshot> {
        if !valid_date(today) || !valid_date(from) || from > today { return Err(VaultError::invalid()); }
        let key = self.require_key()?;
        let db = open_db(&self.db_path(), &key, false)?;
        let today_events = db.query_row("SELECT COUNT(*) FROM behavior_event WHERE local_date=?1", [today], |r| r.get::<_, i64>(0)).map_err(|_| VaultError::io())? as u64;
        let logged_days_last7 = db.query_row("SELECT COUNT(DISTINCT local_date) FROM behavior_event WHERE local_date BETWEEN ?1 AND ?2", params![from,today], |r| r.get::<_, i64>(0)).map_err(|_| VaultError::io())? as u64;
        let mut stmt = db.prepare("SELECT id FROM behavior_event ORDER BY occurred_at_utc_ms DESC,id DESC LIMIT 3").map_err(|_| VaultError::io())?;
        let ids = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|_| VaultError::io())?.collect::<Result<Vec<_>,_>>().map_err(|_| VaultError::io())?;
        Ok(TodaySnapshot { today_events, logged_days_last7, recent: ids.iter().map(|id| get_event(&db,id)).collect::<VaultResult<Vec<_>>>()? })
    }

    pub fn create_event(&mut self, input: EventInput) -> VaultResult<BehaviorEvent> {
        let (local_date, local_hour) = validate_event(&input)?;
        let key = self.require_key()?;
        let mut db = open_db(&self.db_path(), &key, false)?;
        let tx = db.transaction().map_err(|_| VaultError::io())?;
        let id = random_uuid()?;
        let now = now_ms()?;
        tx.execute("INSERT INTO behavior_event (id,type,occurred_at_utc_ms,zone_id,local_date,local_hour,intensity,note,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)", params![id,input.event_type,input.occurred_at_utc_ms,input.zone_id,local_date,local_hour,input.intensity,input.note,now]).map_err(|_| VaultError::io())?;
        for trigger in &input.triggers { tx.execute("INSERT INTO event_trigger (event_id,code) VALUES (?1,?2)", params![id,trigger]).map_err(|_| VaultError::io())?; }
        tx.commit().map_err(|_| VaultError::io())?;
        get_event(&db, &id)
    }

    pub fn event(&mut self, id: &str) -> VaultResult<BehaviorEvent> {
        let key = self.require_key()?;
        get_event(&open_db(&self.db_path(), &key, false)?, id)
    }

    pub fn list_events(&mut self, from: Option<String>, to: Option<String>, event_type: Option<String>, limit: u32, offset: u32) -> VaultResult<Vec<BehaviorEvent>> {
        if limit == 0 || limit > 100 || offset > 1_000_000 || from.as_ref().is_some_and(|s| !valid_date(s)) || to.as_ref().is_some_and(|s| !valid_date(s)) || event_type.as_ref().is_some_and(|s| !valid_type(s)) { return Err(VaultError::invalid()); }
        let key = self.require_key()?;
        let db = open_db(&self.db_path(), &key, false)?;
        let mut stmt = db.prepare("SELECT id FROM behavior_event WHERE (?1 IS NULL OR local_date>=?1) AND (?2 IS NULL OR local_date<=?2) AND (?3 IS NULL OR type=?3) ORDER BY occurred_at_utc_ms DESC,id DESC LIMIT ?4 OFFSET ?5").map_err(|_| VaultError::io())?;
        let ids = stmt.query_map(params![from,to,event_type,limit,offset], |r| r.get::<_, String>(0)).map_err(|_| VaultError::io())?.collect::<Result<Vec<_>,_>>().map_err(|_| VaultError::io())?;
        ids.iter().map(|id| get_event(&db,id)).collect()
    }

    pub fn update_event(&mut self, id: &str, input: EventInput) -> VaultResult<BehaviorEvent> {
        let (local_date, local_hour) = validate_event(&input)?;
        let key = self.require_key()?;
        let mut db = open_db(&self.db_path(), &key, false)?;
        let tx = db.transaction().map_err(|_| VaultError::io())?;
        let changed = tx.execute("UPDATE behavior_event SET type=?2,occurred_at_utc_ms=?3,zone_id=?4,local_date=?5,local_hour=?6,intensity=?7,note=?8,updated_at=?9 WHERE id=?1", params![id,input.event_type,input.occurred_at_utc_ms,input.zone_id,local_date,local_hour,input.intensity,input.note,now_ms()?]).map_err(|_| VaultError::io())?;
        if changed == 0 { return Err(VaultError::invalid()); }
        tx.execute("DELETE FROM event_trigger WHERE event_id=?1", [id]).map_err(|_| VaultError::io())?;
        for trigger in &input.triggers { tx.execute("INSERT INTO event_trigger (event_id,code) VALUES (?1,?2)", params![id,trigger]).map_err(|_| VaultError::io())?; }
        tx.commit().map_err(|_| VaultError::io())?;
        get_event(&db, id)
    }

    pub fn delete_event(&mut self, id: &str) -> VaultResult<()> {
        let key = self.require_key()?;
        let mut db = open_db(&self.db_path(), &key, false)?;
        let tx = db.transaction().map_err(|_| VaultError::io())?;
        if tx.execute("DELETE FROM behavior_event WHERE id=?1", [id]).map_err(|_| VaultError::io())? == 0 { return Err(VaultError::invalid()); }
        tx.commit().map_err(|_| VaultError::io())
    }
}

fn valid_date(date: &str) -> bool {
    date.len() == 10 && chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn event_crud_keeps_zone_and_recomputes_day() {
        let root = tempfile::tempdir().unwrap();
        let mut vault = VaultService::new(root.path().join("vault"));
        vault.initialize("a long unique test password 2026", &[]).unwrap();
        let input = EventInput { event_type: "viewed_content".into(), occurred_at_utc_ms: 1_730_611_800_000, zone_id: "America/New_York".into(), intensity: None, note: Some("private note".into()), triggers: vec!["stress".into(), "fatigue".into()] };
        let created = vault.create_event(input.clone()).unwrap();
        assert_eq!((created.local_date.as_str(),created.local_hour), ("2024-11-03",1));
        assert_eq!(created.triggers.len(), 2);
        let mut edited = input;
        edited.event_type = "stopped_viewing".into();
        edited.zone_id = "Asia/Shanghai".into();
        edited.occurred_at_utc_ms = 1_730_676_600_000;
        let updated = vault.update_event(&created.id, edited).unwrap();
        assert_eq!(updated.local_date, "2024-11-04");
        assert_eq!(updated.event_type, "stopped_viewing");
        assert!(vault.list_events(Some("2024-11-03".into()), Some("2024-11-03".into()), None, 20, 0).unwrap().is_empty());
        assert_eq!(vault.list_events(None,None,None,20,0).unwrap().len(), 1);
        vault.delete_event(&created.id).unwrap();
        assert!(vault.list_events(None,None,None,20,0).unwrap().is_empty());
        assert!(vault.create_event(EventInput { event_type: "urge".into(), occurred_at_utc_ms: 1_730_611_800_000, zone_id: "America/New_York".into(), intensity: Some(11), note: None, triggers: vec![] }).is_err());
    }
}
