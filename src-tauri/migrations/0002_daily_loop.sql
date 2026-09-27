CREATE TABLE behavior_event (
 id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('urge','viewed_content','stopped_viewing','masturbation','alternative_action')),
 occurred_at_utc_ms INTEGER NOT NULL, zone_id TEXT NOT NULL, local_date TEXT NOT NULL, local_hour INTEGER NOT NULL CHECK(local_hour BETWEEN 0 AND 23),
 intensity INTEGER CHECK(intensity BETWEEN 0 AND 10), note TEXT CHECK(length(note) <= 2000), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX behavior_event_date ON behavior_event(local_date, occurred_at_utc_ms DESC);
CREATE INDEX behavior_event_time ON behavior_event(occurred_at_utc_ms DESC);
CREATE TABLE event_trigger (event_id TEXT NOT NULL REFERENCES behavior_event(id) ON DELETE CASCADE, code TEXT NOT NULL, PRIMARY KEY(event_id,code));
CREATE INDEX event_trigger_code ON event_trigger(code,event_id);
CREATE TABLE plan_action (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goal(id), title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at INTEGER NOT NULL);
CREATE TABLE action_completion (id TEXT PRIMARY KEY, action_id TEXT NOT NULL REFERENCES plan_action(id), local_date TEXT NOT NULL, occurred_at_utc_ms INTEGER NOT NULL, UNIQUE(action_id,local_date));
CREATE INDEX action_completion_date ON action_completion(local_date);
CREATE TABLE urge_session (id TEXT PRIMARY KEY, started_at_utc_ms INTEGER NOT NULL, ended_at_utc_ms INTEGER NOT NULL, local_date TEXT NOT NULL, initial_intensity INTEGER CHECK(initial_intensity BETWEEN 0 AND 10), final_intensity INTEGER CHECK(final_intensity BETWEEN 0 AND 10), outcome TEXT NOT NULL CHECK(outcome IN ('completed','skipped','interrupted')), action TEXT);
CREATE INDEX urge_session_date ON urge_session(local_date);
CREATE TABLE journal_entry (id TEXT PRIMARY KEY, content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 10000), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX journal_entry_time ON journal_entry(updated_at DESC);
INSERT INTO schema_migration (version, applied_at) VALUES (2, unixepoch() * 1000);
