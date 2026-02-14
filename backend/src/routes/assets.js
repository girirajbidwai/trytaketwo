// ============================================================
// Asset routes – upload, list, serve
// ============================================================
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const { ingestAsset } = require('../services/ingestService');

const STORAGE = path.resolve(process.env.STORAGE_PATH || './storage');
const UPLOADS = path.join(STORAGE, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuid()}${ext}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 500) * 1024 * 1024 },
});

const router = express.Router();

module.exports = function (db) {
    // Upload + ingest
    const cpUpload = upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);
    router.post('/:projectId/assets', cpUpload, async (req, res) => {
        try {
            const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
            if (!project) return res.status(404).json({ error: 'Project not found' });

            const file = req.files['file'] ? req.files['file'][0] : null;
            const thumb = req.files['thumbnail'] ? req.files['thumbnail'][0] : null;

            if (!file) return res.status(400).json({ error: 'No file uploaded' });

            const asset = await ingestAsset(file, thumb, req.params.projectId, db);
            res.json(asset);
        } catch (err) {
            // Clean up uploaded file on error
            if (req.files) {
                if (req.files['file']) try { fs.unlinkSync(req.files['file'][0].path); } catch (e) { }
                if (req.files['thumbnail']) try { fs.unlinkSync(req.files['thumbnail'][0].path); } catch (e) { }
            }
            res.status(400).json({ error: err.message });
        }
    });

    // List assets for a project
    router.get('/:projectId/assets', (req, res) => {
        const assets = db.prepare('SELECT * FROM assets WHERE project_id = ?').all(req.params.projectId);
        res.json(assets);
    });

    // Delete asset
    router.delete('/assets/:id', (req, res) => {
        const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found' });

        // Remove file
        try { fs.unlinkSync(asset.path); } catch (e) { /* ignore */ }
        if (asset.thumbnail_path) {
            try { fs.unlinkSync(asset.thumbnail_path); } catch (e) { /* ignore */ }
        }

        db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
        res.json({ ok: true });
    });

    // Serve thumbnail
    router.get('/assets/:id/thumbnail', (req, res) => {
        const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        if (!asset || !asset.thumbnail_path) return res.status(404).json({ error: 'Thumbnail not found' });
        res.sendFile(path.resolve(asset.thumbnail_path));
    });

    // Update thumbnail (for auto-heal)
    router.post('/assets/:id/thumbnail', upload.single('thumbnail'), (req, res) => {
        const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found' });

        if (req.file) {
            const ext = path.extname(req.file.originalname) || '.jpg';
            const thumbName = `thumb_${uuid()}${ext}`;
            const thumbnailPath = path.join(THUMBS, thumbName);
            try {
                fs.copyFileSync(req.file.path, thumbnailPath);
                fs.unlinkSync(req.file.path);
                db.prepare('UPDATE assets SET thumbnail_path = ? WHERE id = ?').run(thumbnailPath, req.params.id);
                res.json({ ok: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        } else {
            res.status(400).json({ error: 'No thumbnail' });
        }
    });

    // Stream video
    router.get('/assets/:id/stream', (req, res) => {
        const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found' });

        const filePath = path.resolve(asset.path);
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;
            const file = fs.createReadStream(filePath, { start, end });
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': asset.mime_type,
            });
            file.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': asset.mime_type,
            });
            fs.createReadStream(filePath).pipe(res);
        }
    });

    return router;
};
