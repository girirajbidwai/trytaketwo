// ============================================================
// Ingest Service – extract metadata + generate thumbnails
// ============================================================
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');

const STORAGE = path.resolve(process.env.STORAGE_PATH || './storage');
const THUMBS = path.join(STORAGE, 'thumbnails');
fs.mkdirSync(THUMBS, { recursive: true });

const ALLOWED_VIDEO = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const ALLOWED_AUDIO = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac'];
const ALLOWED_IMAGE = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 500) * 1024 * 1024;

/**
 * Validate an uploaded file
 */
function validateUpload(file) {
    const allAllowed = [...ALLOWED_VIDEO, ...ALLOWED_AUDIO, ...ALLOWED_IMAGE];
    if (!allAllowed.includes(file.mimetype)) {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
    }
    if (file.size > MAX_SIZE) {
        throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_SIZE / 1024 / 1024}MB limit`);
    }
}

/**
 * Determine asset type from MIME
 */
function getAssetType(mime) {
    if (ALLOWED_VIDEO.includes(mime)) return 'video';
    if (ALLOWED_AUDIO.includes(mime)) return 'audio';
    if (ALLOWED_IMAGE.includes(mime)) return 'image';
    return 'unknown';
}

/**
 * Probe a media file with ffprobe. Returns metadata object.
 */
function probeFile(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            const video = metadata.streams.find(s => s.codec_type === 'video');
            const audio = metadata.streams.find(s => s.codec_type === 'audio');
            resolve({
                duration: parseFloat(metadata.format.duration) || 0,
                fps: video ? eval(video.r_frame_rate) : 0,
                width: video ? video.width : 0,
                height: video ? video.height : 0,
                codec: video ? video.codec_name : (audio ? audio.codec_name : ''),
                hasAudio: !!audio,
            });
        });
    });
}

/**
 * Generate a thumbnail using direct ffmpeg command (more reliable here)
 */
function generateThumbnail(filePath, outputDir) {
    return new Promise((resolve, reject) => {
        try {
            const thumbName = `thumb_${uuid()}.jpg`;
            const outPath = path.join(outputDir, thumbName);

            // Get duration to seek to 20%
            const { execSync } = require('child_process');

            // Simple probe for duration
            let duration = 5;
            try {
                const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
                const probeOut = execSync(probeCmd).toString();
                // Check if duration is N/A or empty
                if (!probeOut || probeOut.trim() === 'N/A') {
                    duration = 5;
                } else {
                    duration = parseFloat(probeOut);
                }
            } catch (e) {
                console.warn('Probe duration failed, defaulting to 5s seek:', e.message);
            }
            if (!duration || isNaN(duration)) duration = 5;

            const seek = duration * 0.5; // Seek to 50% (mid-frame)

            // Generate thumb
            // -ss before -i is faster. -vframes 1 to output single image.
            const cmd = `ffmpeg -y -ss ${seek} -i "${filePath}" -vframes 1 -s 320x180 -q:v 3 "${outPath}"`;
            execSync(cmd, { stdio: 'pipe' }); // Pipe stdio to avoid clutter

            if (fs.existsSync(outPath)) {
                resolve(outPath);
            } else {
                reject(new Error('Thumbnail not created'));
            }
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Full ingest pipeline: validate → probe → thumbnail → return metadata
 */
/**
 * Full ingest pipeline: validate → probe → thumbnail → return metadata
 */
async function ingestAsset(file, thumbnailFile, projectId, db) {
    validateUpload(file);

    const assetType = getAssetType(file.mimetype);
    const id = uuid();
    let meta = { duration: 0, fps: 0, width: 0, height: 0, codec: '', hasAudio: false };
    let thumbnailPath = null;

    try {
        // Probe metadata
        if (assetType === 'video' || assetType === 'audio') {
            meta = await probeFile(file.path);
        }

        // Thumbnail Logic
        if (thumbnailFile) {
            // Use uploaded thumbnail
            const ext = path.extname(thumbnailFile.originalname) || '.jpg';
            const thumbName = `thumb_${uuid()}${ext}`;
            thumbnailPath = path.join(THUMBS, thumbName);

            // Safer Copy + Unlink
            try {
                fs.copyFileSync(thumbnailFile.path, thumbnailPath);
                fs.unlinkSync(thumbnailFile.path); // cleanup
            } catch (err) {
                console.error('Failed to move uploaded thumbnail:', err);
                thumbnailPath = null;
            }
        } else if (assetType === 'video') {
            // Fallback to server-side generation
            try {
                thumbnailPath = await generateThumbnail(file.path, THUMBS);
            } catch (err) {
                console.error('Server-side thumbnail generation failed:', err.message);
                thumbnailPath = null;
            }
        }
    } catch (e) {
        console.error('Ingest probe/thumbnail error (continuing):', e.message);
    }

    const asset = {
        id,
        project_id: projectId,
        filename: file.filename,
        original_name: file.originalname,
        mime_type: file.mimetype,
        path: file.path,
        duration: meta.duration,
        fps: meta.fps,
        width: meta.width,
        height: meta.height,
        codec: meta.codec,
        has_audio: meta.hasAudio ? 1 : 0,
        thumbnail_path: thumbnailPath,
        type: assetType,
    };

    db.prepare(`
    INSERT INTO assets (id, project_id, filename, original_name, mime_type, path, duration, fps, width, height, codec, has_audio, thumbnail_path, type)
    VALUES (@id, @project_id, @filename, @original_name, @mime_type, @path, @duration, @fps, @width, @height, @codec, @has_audio, @thumbnail_path, @type)
  `).run(asset);

    return asset;
}

module.exports = { ingestAsset, validateUpload, probeFile, generateThumbnail, getAssetType, ALLOWED_VIDEO, ALLOWED_AUDIO, ALLOWED_IMAGE };
