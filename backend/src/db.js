// ============================================================
// Database layer – SQLite via better-sqlite3
// ============================================================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'editor.db');

// Ensure data dir exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema bootstrap ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS assets (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename       TEXT NOT NULL,
    original_name  TEXT NOT NULL,
    mime_type      TEXT NOT NULL,
    path           TEXT NOT NULL,
    duration       REAL,
    fps            REAL,
    width          INTEGER,
    height         INTEGER,
    codec          TEXT,
    has_audio      INTEGER DEFAULT 0,
    thumbnail_path TEXT,
    type           TEXT NOT NULL DEFAULT 'video',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK(type IN ('VIDEO_A','VIDEO_B','OVERLAY_TEXT','OVERLAY_IMAGE','AUDIO')),
    "order"     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS clips (
    id          TEXT PRIMARY KEY,
    track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    asset_id    TEXT REFERENCES assets(id) ON DELETE SET NULL,
    type        TEXT NOT NULL DEFAULT 'video',
    start_time  REAL NOT NULL DEFAULT 0,
    duration    REAL NOT NULL DEFAULT 0,
    in_point    REAL NOT NULL DEFAULT 0,
    out_point   REAL NOT NULL DEFAULT 0,
    properties  TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS speed_keyframes (
    id       TEXT PRIMARY KEY,
    clip_id  TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    time     REAL NOT NULL,
    speed    REAL NOT NULL DEFAULT 1.0
  );

  CREATE TABLE IF NOT EXISTS overlay_keyframes (
    id        TEXT PRIMARY KEY,
    clip_id   TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    time      REAL NOT NULL,
    x         REAL NOT NULL DEFAULT 0,
    y         REAL NOT NULL DEFAULT 0,
    scale_x   REAL NOT NULL DEFAULT 1,
    scale_y   REAL NOT NULL DEFAULT 1,
    rotation  REAL NOT NULL DEFAULT 0,
    opacity   REAL NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS export_jobs (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id   TEXT UNIQUE,
    status       TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','COMPLETE','FAILED')),
    progress     REAL NOT NULL DEFAULT 0,
    output_path  TEXT,
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
