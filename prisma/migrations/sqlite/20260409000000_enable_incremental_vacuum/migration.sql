-- Enable incremental auto-vacuum mode.
-- PRAGMA auto_vacuum must be set before VACUUM to take effect on existing DBs.
-- The VACUUM rewrites the DB file to adopt the new page format (data is preserved).
PRAGMA auto_vacuum = INCREMENTAL;
VACUUM;
