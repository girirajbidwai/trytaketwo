// ============================================================
// Express Server
// ============================================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Ensure storage dirs
const STORAGE = path.resolve(process.env.STORAGE_PATH || './storage');
fs.mkdirSync(path.join(STORAGE, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(STORAGE, 'thumbnails'), { recursive: true });
fs.mkdirSync(path.join(STORAGE, 'exports'), { recursive: true });

const db = require('./db');
const projectRoutes = require('./routes/projects');
const assetRoutes = require('./routes/assets');
const exportRoutes = require('./routes/exports');

const app = express();
const PORT = parseInt(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Routes ──────────────────────────────────────────────────
app.use('/api/projects', projectRoutes(db));
app.use('/api', assetRoutes(db));
app.use('/api', exportRoutes(db));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Error handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`✓ TryTakeTwo backend running on http://localhost:${PORT} (restarted)`);
});

module.exports = app;
