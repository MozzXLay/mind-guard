CREATE TABLE schema_migration (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
INSERT INTO schema_migration (version, applied_at) VALUES (1, unixepoch() * 1000);

CREATE TABLE goal (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('reduce_content', 'avoid_late_night', 'observe_urge', 'custom')),
    title TEXT NOT NULL CHECK(length(title) <= 100),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    archived_at INTEGER
);
