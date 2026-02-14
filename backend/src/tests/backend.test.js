// ============================================================
// Backend tests – export idempotency + project save/load
// ============================================================
const path = require('path');
const fs = require('fs');

// Use a separate test DB
process.env.STORAGE_PATH = path.join(__dirname, '..', '..', 'test_storage');
const testDbPath = path.join(__dirname, '..', '..', 'test_data');
fs.mkdirSync(testDbPath, { recursive: true });

// Inline a minimal test db setup
const Database = require('better-sqlite3');
const testDb = new Database(path.join(testDbPath, 'test.db'));
testDb.pragma('journal_mode = WAL');
testDb.pragma('foreign_keys = ON');
testDb.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, filename TEXT, original_name TEXT,
    mime_type TEXT, path TEXT, duration REAL, fps REAL, width INTEGER, height INTEGER,
    codec TEXT, has_audio INTEGER DEFAULT 0, thumbnail_path TEXT, type TEXT DEFAULT 'video',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, "order" INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY, track_id TEXT NOT NULL, asset_id TEXT, type TEXT DEFAULT 'video',
    start_time REAL DEFAULT 0, duration REAL DEFAULT 0, in_point REAL DEFAULT 0,
    out_point REAL DEFAULT 0, properties TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS speed_keyframes (
    id TEXT PRIMARY KEY, clip_id TEXT NOT NULL, time REAL NOT NULL, speed REAL DEFAULT 1.0
  );
  CREATE TABLE IF NOT EXISTS overlay_keyframes (
    id TEXT PRIMARY KEY, clip_id TEXT NOT NULL, time REAL NOT NULL,
    x REAL DEFAULT 0, y REAL DEFAULT 0, scale_x REAL DEFAULT 1, scale_y REAL DEFAULT 1,
    rotation REAL DEFAULT 0, opacity REAL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_id TEXT UNIQUE,
    status TEXT DEFAULT 'QUEUED', progress REAL DEFAULT 0,
    output_path TEXT, error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const { v4: uuid } = require('uuid');

// ── Test 1: Export Idempotency ────────────────────────────────
function testExportIdempotency() {
    const projectId = uuid();
    testDb.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(projectId, 'Test');

    const requestId = 'unique-request-123';

    // First export
    const jobId1 = uuid();
    testDb.prepare(`
    INSERT INTO export_jobs (id, project_id, request_id, status) VALUES (?, ?, ?, 'QUEUED')
  `).run(jobId1, projectId, requestId);

    // Second export with same requestId – should return existing
    const existing = testDb.prepare('SELECT * FROM export_jobs WHERE request_id = ?').get(requestId);
    if (!existing) throw new Error('Should find existing job');
    if (existing.id !== jobId1) throw new Error('Should return same job ID');

    // Try to insert duplicate – should fail
    try {
        const jobId2 = uuid();
        testDb.prepare(`
      INSERT INTO export_jobs (id, project_id, request_id, status) VALUES (?, ?, ?, 'QUEUED')
    `).run(jobId2, projectId, requestId);
        throw new Error('Should have thrown unique constraint error');
    } catch (e) {
        if (!e.message.includes('UNIQUE') && !e.message.includes('unique')) {
            throw e; // Only expect unique constraint error
        }
    }

    // Different requestId should work
    const requestId2 = 'different-request-456';
    const jobId3 = uuid();
    testDb.prepare(`
    INSERT INTO export_jobs (id, project_id, request_id, status) VALUES (?, ?, ?, 'QUEUED')
  `).run(jobId3, projectId, requestId2);

    const jobs = testDb.prepare('SELECT * FROM export_jobs WHERE project_id = ?').all(projectId);
    if (jobs.length !== 2) throw new Error(`Expected 2 jobs, got ${jobs.length}`);

    console.log('  ✓ Test 1: Export idempotency PASSED');
}

// ── Test 2: Project Save/Load Integrity ──────────────────────
function testProjectSaveLoad() {
    const projectId = uuid();
    testDb.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(projectId, 'Save/Load Test');

    // Create tracks
    const trackId = uuid();
    testDb.prepare('INSERT INTO tracks (id, project_id, type, "order") VALUES (?, ?, ?, ?)').run(trackId, projectId, 'VIDEO_A', 0);

    // Create clip with speed keyframes and properties
    const clipId = uuid();
    const props = { customProp: 'hello', nested: { value: 42 } };
    testDb.prepare(`
    INSERT INTO clips (id, track_id, asset_id, type, start_time, duration, in_point, out_point, properties)
    VALUES (?, ?, NULL, 'video', 2.5, 7.3, 1.0, 8.3, ?)
  `).run(clipId, trackId, JSON.stringify(props));

    // Add speed keyframes
    const kf1Id = uuid(), kf2Id = uuid();
    testDb.prepare('INSERT INTO speed_keyframes (id, clip_id, time, speed) VALUES (?, ?, ?, ?)').run(kf1Id, clipId, 0, 1.0);
    testDb.prepare('INSERT INTO speed_keyframes (id, clip_id, time, speed) VALUES (?, ?, ?, ?)').run(kf2Id, clipId, 3.0, 2.5);

    // Create overlay track + clip + keyframes
    const overlayTrackId = uuid();
    testDb.prepare('INSERT INTO tracks (id, project_id, type, "order") VALUES (?, ?, ?, ?)').run(overlayTrackId, projectId, 'OVERLAY_TEXT', 1);

    const overlayClipId = uuid();
    testDb.prepare(`
    INSERT INTO clips (id, track_id, type, start_time, duration, properties)
    VALUES (?, ?, 'text', 1.0, 4.0, ?)
  `).run(overlayClipId, overlayTrackId, JSON.stringify({ text: 'Test' }));

    const okfId = uuid();
    testDb.prepare(`
    INSERT INTO overlay_keyframes (id, clip_id, time, x, y, scale_x, scale_y, rotation, opacity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(okfId, overlayClipId, 0, 10, 20, 1.5, 1.5, 30, 0.8);

    // ── Now load everything back and verify ──────────────────
    const project = testDb.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (project.name !== 'Save/Load Test') throw new Error('Project name mismatch');

    const tracks = testDb.prepare('SELECT * FROM tracks WHERE project_id = ?').all(projectId);
    if (tracks.length !== 2) throw new Error(`Expected 2 tracks, got ${tracks.length}`);

    // Load clips
    const clips = testDb.prepare('SELECT * FROM clips WHERE track_id = ?').all(trackId);
    if (clips.length !== 1) throw new Error('Expected 1 clip on VIDEO_A');

    const loadedClip = clips[0];
    if (loadedClip.start_time !== 2.5) throw new Error('Clip start_time mismatch');
    if (loadedClip.duration !== 7.3) throw new Error('Clip duration mismatch');
    if (loadedClip.in_point !== 1.0) throw new Error('Clip in_point mismatch');

    const loadedProps = JSON.parse(loadedClip.properties);
    if (loadedProps.customProp !== 'hello') throw new Error('Properties mismatch');
    if (loadedProps.nested.value !== 42) throw new Error('Nested properties mismatch');

    // Speed keyframes
    const speedKfs = testDb.prepare('SELECT * FROM speed_keyframes WHERE clip_id = ? ORDER BY time').all(clipId);
    if (speedKfs.length !== 2) throw new Error('Expected 2 speed keyframes');
    if (speedKfs[0].speed !== 1.0 || speedKfs[1].speed !== 2.5) throw new Error('Speed keyframe values mismatch');

    // Overlay keyframes
    const overlayKfs = testDb.prepare('SELECT * FROM overlay_keyframes WHERE clip_id = ?').all(overlayClipId);
    if (overlayKfs.length !== 1) throw new Error('Expected 1 overlay keyframe');
    if (overlayKfs[0].x !== 10 || overlayKfs[0].rotation !== 30) throw new Error('Overlay keyframe values mismatch');

    console.log('  ✓ Test 2: Project save/load integrity PASSED');
}

// ── Run ──────────────────────────────────────────────────────
console.log('\n🗃️  Backend Tests\n');
try {
    testExportIdempotency();
    testProjectSaveLoad();
    console.log('\n✓ All backend tests passed!\n');
} catch (err) {
    console.error('\n✗ Test failed:', err.message, '\n');
    process.exit(1);
} finally {
    testDb.close();
    // Cleanup
    try { fs.rmSync(testDbPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
