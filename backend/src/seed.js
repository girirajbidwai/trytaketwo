// ============================================================
// Seed script – creates demo project with 3 test videos
// ============================================================
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuid } = require('uuid');

const STORAGE = path.resolve(process.env.STORAGE_PATH || './storage');
const UPLOADS = path.join(STORAGE, 'uploads');
const THUMBS = path.join(STORAGE, 'thumbnails');
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(THUMBS, { recursive: true });

const db = require('./db');

async function seed() {
    console.log('🎬 Seeding demo project...\n');

    // ── Step 1: Generate test videos with FFmpeg ──────────────
    const testVideos = [
        {
            name: 'Blue Solid',
            file: 'blue.mp4',
            cmd: '-y -f lavfi -i color=c=blue:s=1280x720:d=8 -c:v libx264 -pix_fmt yuv420p',
        },
        {
            name: 'Red Solid',
            file: 'red.mp4',
            cmd: '-y -f lavfi -i color=c=red:s=1280x720:d=10 -c:v libx264 -pix_fmt yuv420p',
        },
        {
            name: 'Noise',
            file: 'noise.mp4',
            cmd: '-y -f lavfi -i nullsrc=s=1280x720:d=6 -vf geq=random(1)*255:128:128 -c:v libx264 -pix_fmt yuv420p',
        },
    ];

    const assetIds = [];
    for (const tv of testVideos) {
        const outPath = path.join(UPLOADS, tv.file);
        const thumbPath = path.join(THUMBS, `thumb_${tv.file.replace('.mp4', '.jpg')}`);

        console.log(`  Generating ${tv.name}...`);
        try {
            execSync(`ffmpeg ${tv.cmd} "${outPath}"`, { stdio: 'pipe' });
        } catch (e) {
            console.error(`    ⚠ FFmpeg failed for ${tv.name}:`, e.message.slice(0, 200));
            continue;
        }

        // Generate thumbnail
        try {
            execSync(`ffmpeg -y -ss 1 -i "${outPath}" -vframes 1 -s 320x180 -q:v 2 "${thumbPath}"`, { stdio: 'pipe' });
        } catch (e) {
            console.error(`    ⚠ Thumbnail failed for ${tv.name}`);
        }

        const id = uuid();
        assetIds.push(id);
        db.prepare(`
      INSERT INTO assets (id, project_id, filename, original_name, mime_type, path, duration, fps, width, height, codec, has_audio, thumbnail_path, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            id, '__TEMP_PROJECT__', tv.file, tv.file, 'video/mp4', outPath,
            tv.name === 'Mandelbrot' ? 6 : (tv.name === 'Color Bars' ? 8 : 10),
            30, 1280, 720, 'h264',
            tv.name !== 'Mandelbrot' ? 1 : 0,
            fs.existsSync(thumbPath) ? thumbPath : null,
            'video'
        );
        console.log(`    ✓ ${tv.name} (${id})`);
    }

    if (assetIds.length < 3) {
        console.error('\n⚠ Not all test videos were generated. Make sure FFmpeg is installed and on PATH.');
        console.log('  Continuing with available assets...\n');
    }

    // ── Step 2: Create project ────────────────────────────────
    const projectId = uuid();
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(projectId, 'Demo Project');

    // Update assets to belong to this project
    for (const aid of assetIds) {
        db.prepare('UPDATE assets SET project_id = ? WHERE id = ?').run(projectId, aid);
    }

    // Create tracks
    const trackTypes = ['VIDEO_A', 'VIDEO_B', 'OVERLAY_TEXT', 'OVERLAY_IMAGE', 'AUDIO'];
    const trackIds = {};
    trackTypes.forEach((type, i) => {
        const tid = uuid();
        trackIds[type] = tid;
        db.prepare('INSERT INTO tracks (id, project_id, type, "order") VALUES (?, ?, ?, ?)').run(tid, projectId, type, i);
    });

    // ── Step 3: Add clips to timeline ─────────────────────────
    // Clip 1: Color Bars on Video A track (0s - 5s)
    if (assetIds[0]) {
        const clipId1 = uuid();
        db.prepare(`
      INSERT INTO clips (id, track_id, asset_id, type, start_time, duration, in_point, out_point, properties)
      VALUES (?, ?, ?, 'video', 0, 5, 0, 5, '{}')
    `).run(clipId1, trackIds.VIDEO_A, assetIds[0]);

        // Add speed ramp: 1x → 2x → 0x (hold) → 1x
        const speedKfs = [
            { time: 0, speed: 1 },
            { time: 1.5, speed: 2 },
            { time: 2.5, speed: 0 },   // hold
            { time: 3.5, speed: 0 },   // end hold
            { time: 5, speed: 1 },
        ];
        for (const kf of speedKfs) {
            db.prepare('INSERT INTO speed_keyframes (id, clip_id, time, speed) VALUES (?, ?, ?, ?)')
                .run(uuid(), clipId1, kf.time, kf.speed);
        }
        console.log('  ✓ Clip 1 (Color Bars) on Video A with speed ramp + hold');
    }

    // Clip 2: Test Pattern on Video B track (3s - 8s)
    if (assetIds[1]) {
        const clipId2 = uuid();
        db.prepare(`
      INSERT INTO clips (id, track_id, asset_id, type, start_time, duration, in_point, out_point, properties)
      VALUES (?, ?, ?, 'video', 3, 5, 1, 6, '{}')
    `).run(clipId2, trackIds.VIDEO_B, assetIds[1]);
        console.log('  ✓ Clip 2 (Test Pattern) on Video B');
    }

    // Clip 3: Text overlay with animated keyframes (1s - 6s)
    const textClipId = uuid();
    db.prepare(`
    INSERT INTO clips (id, track_id, asset_id, type, start_time, duration, in_point, out_point, properties)
    VALUES (?, ?, NULL, 'text', 1, 5, 0, 5, ?)
  `).run(textClipId, trackIds.OVERLAY_TEXT, JSON.stringify({
        text: 'TryTakeTwo Editor',
        fontSize: 48,
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.5)',
    }));

    // Animated keyframes: slide in from left, scale up, fade out
    const overlayKfs = [
        { time: 0, x: -200, y: 300, scale_x: 0.5, scale_y: 0.5, rotation: 0, opacity: 0 },
        { time: 1, x: 100, y: 300, scale_x: 1, scale_y: 1, rotation: 0, opacity: 1 },
        { time: 3, x: 500, y: 300, scale_x: 1.2, scale_y: 1.2, rotation: 5, opacity: 1 },
        { time: 5, x: 800, y: 300, scale_x: 0.8, scale_y: 0.8, rotation: -5, opacity: 0 },
    ];
    for (const kf of overlayKfs) {
        db.prepare(`
      INSERT INTO overlay_keyframes (id, clip_id, time, x, y, scale_x, scale_y, rotation, opacity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), textClipId, kf.time, kf.x, kf.y, kf.scale_x, kf.scale_y, kf.rotation, kf.opacity);
    }
    console.log('  ✓ Text overlay with animated keyframes');

    console.log(`\n✓ Demo project created: "${projectId}"`);
    console.log('  Start the server and open the editor to see it.\n');
}

seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
});
