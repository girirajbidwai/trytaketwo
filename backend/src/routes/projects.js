// ============================================================
// Project routes
// ============================================================
const express = require('express');
const { v4: uuid } = require('uuid');
const router = express.Router();

module.exports = function (db) {
    // Create project
    router.post('/', (req, res) => {
        const id = uuid();
        const name = req.body.name || 'Untitled Project';
        const existing = db.prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE').get(name);
        if (existing) {
            return res.status(409).json({ error: 'A project with this name already exists' });
        }
        db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, name);

        // Create default tracks
        const trackTypes = ['VIDEO_A', 'VIDEO_B', 'OVERLAY_TEXT', 'OVERLAY_IMAGE', 'AUDIO'];
        const insertTrack = db.prepare('INSERT INTO tracks (id, project_id, type, "order") VALUES (?, ?, ?, ?)');
        trackTypes.forEach((type, i) => {
            insertTrack.run(uuid(), id, type, i);
        });

        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
        res.json(project);
    });

    // List projects
    router.get('/', (req, res) => {
        const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
        res.json(projects);
    });

    // Get full project state
    router.get('/:id', (req, res) => {
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const tracks = db.prepare('SELECT * FROM tracks WHERE project_id = ? ORDER BY "order"').all(project.id);
        for (const track of tracks) {
            track.clips = db.prepare('SELECT * FROM clips WHERE track_id = ? ORDER BY start_time').all(track.id);
            for (const clip of track.clips) {
                clip.speedKeyframes = db.prepare('SELECT * FROM speed_keyframes WHERE clip_id = ? ORDER BY time').all(clip.id);
                clip.overlayKeyframes = db.prepare('SELECT * FROM overlay_keyframes WHERE clip_id = ? ORDER BY time').all(clip.id);
                // Parse properties JSON
                try {
                    clip.properties = JSON.parse(clip.properties || '{}');
                } catch (e) {
                    clip.properties = {};
                }
            }
        }

        const assets = db.prepare('SELECT * FROM assets WHERE project_id = ?').all(project.id);
        const exports = db.prepare('SELECT * FROM export_jobs WHERE project_id = ? ORDER BY created_at DESC').all(project.id);

        res.json({ ...project, tracks, assets, exports });
    });

    // Update project (save timeline state)
    router.put('/:id', (req, res) => {
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const { name, tracks } = req.body;
        if (name) {
            db.prepare('UPDATE projects SET name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(name, project.id);
        }

        if (tracks && Array.isArray(tracks)) {
            // Transactional save
            const saveAll = db.transaction(() => {
                for (const track of tracks) {
                    // Ensure track exists
                    const existing = db.prepare('SELECT * FROM tracks WHERE id = ?').get(track.id);
                    if (!existing) continue;

                    // Delete existing clips for this track then re-insert
                    const clipIds = db.prepare('SELECT id FROM clips WHERE track_id = ?').all(track.id).map(c => c.id);
                    for (const cid of clipIds) {
                        db.prepare('DELETE FROM speed_keyframes WHERE clip_id = ?').run(cid);
                        db.prepare('DELETE FROM overlay_keyframes WHERE clip_id = ?').run(cid);
                    }
                    db.prepare('DELETE FROM clips WHERE track_id = ?').run(track.id);

                    // Insert clips
                    for (const clip of track.clips || []) {
                        const clipId = clip.id || uuid();
                        db.prepare(`
              INSERT INTO clips (id, track_id, asset_id, type, start_time, duration, in_point, out_point, properties)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                            clipId, track.id, clip.asset_id || null, clip.type || 'video',
                            clip.start_time || 0, clip.duration || 0, clip.in_point || 0, clip.out_point || 0,
                            JSON.stringify(clip.properties || {})
                        );

                        // Insert speed keyframes
                        if (clip.speedKeyframes) {
                            for (const kf of clip.speedKeyframes) {
                                db.prepare('INSERT INTO speed_keyframes (id, clip_id, time, speed) VALUES (?, ?, ?, ?)')
                                    .run(kf.id || uuid(), clipId, kf.time, kf.speed);
                            }
                        }
                        // Insert overlay keyframes
                        if (clip.overlayKeyframes) {
                            for (const kf of clip.overlayKeyframes) {
                                db.prepare(`
                  INSERT INTO overlay_keyframes (id, clip_id, time, x, y, scale_x, scale_y, rotation, opacity)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                                    kf.id || uuid(), clipId, kf.time,
                                    kf.x || 0, kf.y || 0, kf.scale_x || 1, kf.scale_y || 1,
                                    kf.rotation || 0, kf.opacity ?? 1
                                );
                            }
                        }
                    }
                }
            });
            saveAll();
        }

        // Return updated project
        const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
        res.json(updated);
    });

    // Delete project
    router.delete('/:id', (req, res) => {
        db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
        res.json({ ok: true });
    });

    return router;
};
