use std::{fs, path::Path};
use chrono::{DateTime, Duration, Utc};
use crate::domain::{VaultError, VaultResult};

fn number(bytes: &[u8], start: usize) -> VaultResult<usize> {
    let value = bytes.get(start..start + 4).ok_or_else(VaultError::invalid)?;
    Ok(u32::from_be_bytes(value.try_into().unwrap()) as usize)
}

// TZif v2/v3 uses 64-bit transition times. Read only the transition and type
// sections; the input is the installed IANA zoneinfo database, never a user path.
pub(super) fn local_parts(timestamp_ms: i64, zone: &str) -> VaultResult<(String, u32)> {
    if zone.len() > 100 || zone.is_empty() || zone.split('/').any(|s| s.is_empty() || s == "." || s == ".." || !s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_+-".contains(&b))) {
        return Err(VaultError::invalid());
    }
    let path = Path::new("/usr/share/zoneinfo").join(zone);
    let bytes = fs::read(path).map_err(|_| VaultError::invalid())?;
    if bytes.len() > 2_000_000 || bytes.get(..4) != Some(b"TZif") || !matches!(bytes.get(4), Some(b'2' | b'3' | b'4')) {
        return Err(VaultError::invalid());
    }
    let counts = |at: usize| -> VaultResult<(usize, usize, usize, usize, usize, usize)> {
        Ok((number(&bytes, at + 20)?, number(&bytes, at + 24)?, number(&bytes, at + 28)?, number(&bytes, at + 32)?, number(&bytes, at + 36)?, number(&bytes, at + 40)?))
    };
    let (gmt, std, leap, time, types, chars) = counts(0)?;
    let first_size = time.checked_mul(5).and_then(|n| n.checked_add(types * 6 + chars + leap * 8 + std + gmt)).ok_or_else(VaultError::invalid)?;
    let header = 44 + first_size;
    if bytes.get(header..header + 4) != Some(b"TZif") { return Err(VaultError::invalid()); }
    let (_gmt, _std, leap, time, types, chars) = counts(header)?;
    if types == 0 || time > 100_000 || types > 256 || chars > 100_000 || leap > 100_000 { return Err(VaultError::invalid()); }
    let start = header + 44;
    let transitions_end = start.checked_add(time * 8).ok_or_else(VaultError::invalid)?;
    let indices_end = transitions_end.checked_add(time).ok_or_else(VaultError::invalid)?;
    let info_end = indices_end.checked_add(types * 6).ok_or_else(VaultError::invalid)?;
    if bytes.get(start..info_end).is_none() { return Err(VaultError::invalid()); }
    let timestamp = timestamp_ms.div_euclid(1000);
    let mut selected = None;
    for i in 0..time {
        let transition = i64::from_be_bytes(bytes[start + i * 8..start + (i + 1) * 8].try_into().unwrap());
        if transition <= timestamp { selected = Some(bytes[transitions_end + i] as usize); } else { break; }
    }
    let index = selected.unwrap_or_else(|| (0..types).find(|i| bytes[indices_end + i * 6 + 4] == 0).unwrap_or(0));
    if index >= types { return Err(VaultError::invalid()); }
    let offset = i32::from_be_bytes(bytes[indices_end + index * 6..indices_end + index * 6 + 4].try_into().unwrap());
    let utc = DateTime::<Utc>::from_timestamp_millis(timestamp_ms).ok_or_else(VaultError::invalid)?;
    let local = utc.checked_add_signed(Duration::seconds(i64::from(offset))).ok_or_else(VaultError::invalid)?;
    Ok((local.format("%Y-%m-%d").to_string(), local.format("%H").to_string().parse().map_err(|_| VaultError::invalid())?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dst_fall_back_keeps_both_local_hours() {
        assert_eq!(local_parts(1730611800000, "America/New_York").unwrap(), ("2024-11-03".into(), 1));
        assert_eq!(local_parts(1730615400000, "America/New_York").unwrap(), ("2024-11-03".into(), 1));
        assert_eq!(local_parts(1730676600000, "Asia/Shanghai").unwrap().0, "2024-11-04");
    }
}
