// ============================================================
// Export routes – queue, status, download
// ============================================================
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { exportProject } = require('../services/exportService');

const router = express.Router();

module.exports = function (db) {
    // Queue an export
    router.post('/:projectId/export', async (req, res) => {
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const requestId = req.body.requestId || uuid();

        // Idempotency check
        const existing = db.prepare('SELECT * FROM export_jobs WHERE request_id = ?').get(requestId);
        if (existing) {
            return res.json(existing);
        }

        const jobId = uuid();
        db.prepare(`
      INSERT INTO export_jobs (id, project_id, request_id, status, progress)
      VALUES (?, ?, ?, 'QUEUED', 0)
    `).run(jobId, project.id, requestId);

        const job = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(jobId);
        res.json(job);

        // Process async (in-process worker)
        require('fs').appendFileSync('export_debug.log', `[${new Date().toISOString()}] Calling processExportJob for ${jobId}\n`);
        processExportJob(jobId, project.id, db).catch(err => {
            require('fs').appendFileSync('export_debug.log', `[${new Date().toISOString()}] processExportJob rejected: ${err.message}\n`);
            console.error('Export job failed:', err);
        });
    });

    // Get export status
    router.get('/exports/:id', (req, res) => {
        const job = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(req.params.id);
        if (!job) return res.status(404).json({ error: 'Export job not found' });
        res.json(job);
    });

    // List export jobs for a project
    router.get('/:projectId/exports', (req, res) => {
        const jobs = db.prepare('SELECT * FROM export_jobs WHERE project_id = ? ORDER BY created_at DESC').all(req.params.projectId);
        res.json(jobs);
    });

    // Download finished export
    router.get('/exports/:id/download', (req, res) => {
        const job = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(req.params.id);
        if (!job) return res.status(404).json({ error: 'Export not found' });
        if (job.status !== 'COMPLETE') return res.status(400).json({ error: 'Export not complete' });
        if (!job.output_path || !fs.existsSync(job.output_path)) {
            return res.status(404).json({ error: 'Export file not found' });
        }
        res.download(job.output_path, `export_${job.id}.mp4`);
    });

    return router;
};

/**
 * Process an export job asynchronously (in-process).
 */
async function processExportJob(jobId, projectId, db) {
    try {
        require('fs').appendFileSync('export_debug.log', `[${new Date().toISOString()}] Job ${jobId} started\n`);
        db.prepare('UPDATE export_jobs SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run('RUNNING', jobId);

        // Load full project data
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        const tracks = db.prepare('SELECT * FROM tracks WHERE project_id = ? ORDER BY "order"').all(projectId);
        for (const track of tracks) {
            track.clips = db.prepare('SELECT * FROM clips WHERE track_id = ? ORDER BY start_time').all(track.id);
            for (const clip of track.clips) {
                clip.speedKeyframes = db.prepare('SELECT * FROM speed_keyframes WHERE clip_id = ? ORDER BY time').all(clip.id);
                clip.overlayKeyframes = db.prepare('SELECT * FROM overlay_keyframes WHERE clip_id = ? ORDER BY time').all(clip.id);
                try { clip.properties = JSON.parse(clip.properties || '{}'); } catch (e) { clip.properties = {}; }
            }
        }

        const projectData = { ...project, tracks };

        const outputPath = await exportProject(projectData, db, jobId, (progress) => {
            db.prepare('UPDATE export_jobs SET progress = ?, updated_at = datetime(\'now\') WHERE id = ?')
                .run(progress, jobId);
        });

        db.prepare('UPDATE export_jobs SET status = ?, progress = 100, output_path = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run('COMPLETE', outputPath, jobId);
    } catch (err) {
        require('fs').appendFileSync('export_debug.log', `[${new Date().toISOString()}] Job ${jobId} FAILED: ${err.message}\n${err.stack}\n`);
        console.error('Export error:', err);
        db.prepare('UPDATE export_jobs SET status = ?, error = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run('FAILED', err.message, jobId);
    }
}
