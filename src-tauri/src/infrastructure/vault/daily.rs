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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal { pub id: String, pub title: String, pub kind: String, pub status: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAction { pub id: String, pub goal_id: String, pub title: String, pub enabled: bool, pub goal_status: String, pub completed: bool }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SosInput {
    pub started_at_utc_ms: i64,
    pub ended_at_utc_ms: i64,
    pub zone_id: String,
    pub initial_intensity: Option<i64>,
    pub final_intensity: Option<i64>,
    pub outcome: String,
    pub action: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SosSession { pub id: String, pub started_at_utc_ms: i64, pub ended_at_utc_ms: i64, pub local_date: String, pub initial_intensity: Option<i64>, pub final_intensity: Option<i64>, pub outcome: String, pub action: Option<String> }

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
    pub fn save_sos(&mut self, input: SosInput) -> VaultResult<SosSession> {
        if input.started_at_utc_ms < 0 || input.ended_at_utc_ms < input.started_at_utc_ms || input.ended_at_utc_ms > now_ms()? + 86_400_000
            || input.ended_at_utc_ms - input.started_at_utc_ms > 3_600_000
            || input.initial_intensity.is_some_and(|n| !(0..=10).contains(&n))
            || input.final_intensity.is_some_and(|n| !(0..=10).contains(&n))
            || !matches!(input.outcome.as_str(), "completed" | "skipped" | "interrupted")
            || input.action.as_ref().is_some_and(|s| s.chars().count() > 100)
        { return Err(VaultError::invalid()); }
        let (date, _) = zone::local_parts(input.started_at_utc_ms, &input.zone_id)?;
        let key = self.require_key()?;
        let mut db = open_db(&self.db_path(), &key, false)?;
        let tx = db.transaction().map_err(|_| VaultError::io())?;
        let session = SosSession { id: random_uuid()?, started_at_utc_ms: input.started_at_utc_ms, ended_at_utc_ms: input.ended_at_utc_ms, local_date: date, initial_intensity: input.initial_intensity, final_intensity: input.final_intensity, outcome: input.outcome, action: input.action };
        tx.execute("INSERT INTO urge_session (id,started_at_utc_ms,ended_at_utc_ms,local_date,initial_intensity,final_intensity,outcome,action) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", params![session.id,session.started_at_utc_ms,session.ended_at_utc_ms,session.local_date,session.initial_intensity,session.final_intensity,session.outcome,session.action]).map_err(|_| VaultError::io())?;
        tx.commit().map_err(|_| VaultError::io())?;
        Ok(session)
    }

    pub fn list_sos(&mut self, limit: u32) -> VaultResult<Vec<SosSession>> {
        if limit == 0 || limit > 100 { return Err(VaultError::invalid()); }
        let key = self.require_key()?;
        let db = open_db(&self.db_path(), &key, false)?;
        let mut stmt = db.prepare("SELECT id,started_at_utc_ms,ended_at_utc_ms,local_date,initial_intensity,final_intensity,outcome,action FROM urge_session ORDER BY started_at_utc_ms DESC,id DESC LIMIT ?1").map_err(|_| VaultError::io())?;
        let result = stmt.query_map([limit], |r| Ok(SosSession { id:r.get(0)?,started_at_utc_ms:r.get(1)?,ended_at_utc_ms:r.get(2)?,local_date:r.get(3)?,initial_intensity:r.get(4)?,final_intensity:r.get(5)?,outcome:r.get(6)?,action:r.get(7)? }))
            .map_err(|_| VaultError::io())?.collect::<Result<Vec<_>,_>>().map_err(|_| VaultError::io())?;
        Ok(result)
    }

    pub fn goal_details(&mut self) -> VaultResult<Vec<Goal>> {
        let key = self.require_key()?;
        let db = open_db(&self.db_path(), &key, false)?;
        let mut stmt = db.prepare("SELECT id,title,kind,status FROM goal ORDER BY created_at,id").map_err(|_| VaultError::io())?;
        let result = stmt.query_map([], |r| Ok(Goal { id:r.get(0)?,title:r.get(1)?,kind:r.get(2)?,status:r.get(3)? }))
            .map_err(|_| VaultError::io())?.collect::<Result<Vec<_>,_>>().map_err(|_| VaultError::io())?;
        Ok(result)
    }

    pub fn save_goal(&mut self, id: Option<String>, title: String, status: String) -> VaultResult<Goal> {
        if title.trim().is_empty() || title.chars().count() > 100 || !matches!(status.as_str(), "active" | "paused" | "archived") { return Err(VaultError::invalid()); }
        let key = self.require_key()?;
        let mut db = open_db(&self.db_path(), &key, false)?;
        let tx = db.transaction().map_err(|_| VaultError::io())?;
        let id = if let Some(id) = id {
            if tx.execute("UPDATE goal SET title=?2,status=?3,archived_at=CASE WHEN ?3='archived' THEN COALESCE(archived_at,?4) ELSE NULL END WHERE id=?1", params![id,title.trim(),status,now_ms()?]).map_err(|_| VaultError::io())? == 0 { return Err(VaultError::invalid()); }
            id
        } else {
            let id = random_uuid()?;
            tx.execute("INSERT INTO goal (id,kind,title,status,archived_at) VALUES (?1,'custom',?2,?3,CASE WHEN ?3='archived' THEN ?4 ELSE NULL END)", params![id,title.trim(),status,now_ms()?]).map_err(|_| VaultError::io())?;
            id
        };
        let goal = tx.query_row("SELECT id,title,kind,status FROM goal WHERE id=?1", [id], |r| Ok(Goal { id:r.get(0)?,title:r.get(1)?,kind:r.get(2)?,status:r.get(3)? })).map_err(|_| VaultError::io())?;
        tx.commit().map_err(|_| VaultError::io())?;
        Ok(goal)
    }

    pub fn list_actions(&mut self, date: &str) -> VaultResult<Vec<PlanAction>> {
        if !valid_date(date) { return Err(VaultError::invalid()); }
        let key = self.require_key()?;
        let db = open_db(&self.db_path(), &key, false)?;
        let mut stmt = db.prepare("SELECT a.id,a.goal_id,a.title,a.enabled,g.status,EXISTS(SELECT 1 FROM action_completion c WHERE c.action_id=a.id AND c.local_date=?1) FROM plan_action a JOIN goal g ON g.id=a.goal_id ORDER BY a.created_at,a.id").map_err(|_| VaultError::io())?;
        let result = stmt.query_map([date], |r| Ok(PlanAction { id:r.get(0)?,goal_id:r.get(1)?,title:r.get(2)?,enabled:r.get::<_,i64>(3)? != 0,goal_status:r.get(4)?,completed:r.get::<_,i64>(5)? != 0 }))
            .map_err(|_| VaultError::io())?.collect::<Result<Vec<_>,_>>().map_err(|_| VaultError::io())?;
        Ok(result)
    }

    pub fn save_action(&mut self, id: Option<String>, goal_id: String, title: String, enabled: bool) -> VaultResult<()> {
        if title.trim().is_empty() || title.chars().count() > 100 { return Err(VaultError::invalid()); }
        let key = self.require_key()?;
        let mut db = open_db(&self.db_path(), &key, false)?;
        let tx = db.transaction().map_err(|_| VaultError::io())?;
        if tx.query_row("SELECT 1 FROM goal WHERE id=?1", [&goal_id], |_| Ok(())).optional().map_err(|_| VaultError::io())?.is_none() { return Err(VaultError::invalid()); }
        if let Some(id) = id {
            if tx.execute("UPDATE plan_action SET goal_id=?2,title=?3,enabled=?4 WHERE id=?1", params![id,goal_id,title.trim(),enabled]).map_err(|_| VaultError::io())? == 0 { return Err(VaultError::invalid()); }
        } else {
            tx.execute("INSERT INTO plan_action (id,goal_id,title,enabled,created_at) VALUES (?1,?2,?3,?4,?5)", params![random_uuid()?,goal_id,title.trim(),enabled,now_ms()?]).map_err(|_| VaultError::io())?;
        }
        tx.commit().map_err(|_| VaultError::io())
    }

    pub fn set_action_completion(&mut self, action_id: &str, date: &str, done: bool) -> VaultResult<()> {
        if !valid_date(date) { return Err(VaultError::invalid()); }
        let key = self.require_key()?;
        let mut db = open_db(&self.db_path(), &key, false)?;
        let tx = db.transaction().map_err(|_| VaultError::io())?;
        let action_state = tx.query_row("SELECT a.enabled,g.status FROM plan_action a JOIN goal g ON g.id=a.goal_id WHERE a.id=?1", [action_id], |r| Ok((r.get::<_,i64>(0)?, r.get::<_,String>(1)?))).optional().map_err(|_| VaultError::io())?.ok_or_else(VaultError::invalid)?;
        if done && (action_state.0 == 0 || action_state.1 != "active") { return Err(VaultError::invalid()); }
        if done {
            tx.execute("INSERT INTO action_completion (id,action_id,local_date,occurred_at_utc_ms) VALUES (?1,?2,?3,?4) ON CONFLICT(action_id,local_date) DO NOTHING", params![random_uuid()?,action_id,date,now_ms()?]).map_err(|_| VaultError::io())?;
        } else { tx.execute("DELETE FROM action_completion WHERE action_id=?1 AND local_date=?2", params![action_id,date]).map_err(|_| VaultError::io())?; }
        tx.commit().map_err(|_| VaultError::io())
    }

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

    #[test]
    fn goal_identity_and_daily_completion_are_stable() {
        let root = tempfile::tempdir().unwrap();
        let mut vault = VaultService::new(root.path().join("vault"));
        vault.initialize("a long unique test password 2026", &["first title".into()]).unwrap();
        let goal = vault.goal_details().unwrap().remove(0);
        let changed = vault.save_goal(Some(goal.id.clone()), "renamed".into(), "active".into()).unwrap();
        assert_eq!(changed.id, goal.id);
        vault.save_action(None, goal.id.clone(), "walk".into(), true).unwrap();
        let action = vault.list_actions("2026-09-27").unwrap().remove(0);
        vault.set_action_completion(&action.id, "2026-09-27", true).unwrap();
        vault.set_action_completion(&action.id, "2026-09-27", true).unwrap();
        let db = open_db(&vault.db_path(), &vault.require_key().unwrap(), false).unwrap();
        let count: i64 = db.query_row("SELECT COUNT(*) FROM action_completion", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        drop(db);
        vault.set_action_completion(&action.id, "2026-09-27", false).unwrap();
        assert!(!vault.list_actions("2026-09-27").unwrap()[0].completed);
        vault.save_goal(Some(goal.id), "renamed".into(), "paused".into()).unwrap();
        assert!(vault.set_action_completion(&action.id, "2026-09-27", true).is_err());
    }

    #[test]
    fn saved_sos_allows_missing_scores_and_rejects_invalid_outcome() {
        let root = tempfile::tempdir().unwrap();
        let mut vault = VaultService::new(root.path().join("vault"));
        vault.initialize("a long unique test password 2026", &[]).unwrap();
        let now = now_ms().unwrap();
        let session = vault.save_sos(SosInput { started_at_utc_ms: now - 30_000, ended_at_utc_ms: now, zone_id: "Asia/Shanghai".into(), initial_intensity: None, final_intensity: None, outcome: "skipped".into(), action: None }).unwrap();
        assert_eq!(session.outcome, "skipped");
        assert_eq!(vault.list_sos(20).unwrap().len(), 1);
        assert!(vault.save_sos(SosInput { started_at_utc_ms: now - 30_000, ended_at_utc_ms: now, zone_id: "Asia/Shanghai".into(), initial_intensity: Some(11), final_intensity: None, outcome: "completed".into(), action: None }).is_err());
    }
}
