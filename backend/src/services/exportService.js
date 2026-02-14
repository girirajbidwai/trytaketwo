// ============================================================
// Export Service - FFmpeg-based segmented render pipeline
// ============================================================
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const STORAGE = path.resolve(process.env.STORAGE_PATH || './storage');
const EXPORTS = path.join(STORAGE, 'exports');
const TEMP = path.join(STORAGE, 'temp');
fs.mkdirSync(EXPORTS, { recursive: true });
fs.mkdirSync(TEMP, { recursive: true });

let FFMPEG_PATH = process.env.FFMPEG_PATH;
if (!FFMPEG_PATH) {
    try {
        // Attempt to use bundled static binary if installed via npm
        const ffmpegStatic = require('ffmpeg-static');
        if (ffmpegStatic) FFMPEG_PATH = ffmpegStatic;
    } catch (e) {
        FFMPEG_PATH = 'ffmpeg';
    }
}

/**
 * Sanitize a value to prevent FFmpeg argument injection.
 */
function sanitize(val) {
    if (typeof val === 'number') return val;
    return String(val).replace(/[^a-zA-Z0-9._\-\/: \\]/g, '');
}

/**
 * Run an FFmpeg command and return a promise.
 */
function runFfmpeg(args, onProgress) {
    const logLine = '[' + new Date().toISOString() + '] Running: ' + FFMPEG_PATH + ' ' + args.map(a => '"' + a + '"').join(' ') + '\n';
    try { fs.appendFileSync('ffmpeg_debug.log', logLine); } catch (e) { }

    return new Promise((resolve, reject) => {
        console.log('[FFmpeg] Running: ' + FFMPEG_PATH + ' ' + args.join(' '));
        const proc = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (data) => {
            const str = data.toString();
            stderr += str;
            const match = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (match && onProgress) {
                const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
                onProgress(secs);
            }
        });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error('FFmpeg exited with code ' + code + ': ' + stderr.slice(-500)));
        });
        proc.on('error', (err) => {
            if (err.code === 'ENOENT') {
                reject(new Error('FFmpeg not found at "' + FFMPEG_PATH + '". Please ensure FFmpeg is installed/in PATH.'));
            } else {
                reject(err);
            }
        });
    });
}

/**
 * Check if a media file has an audio stream.
 * Uses ffmpeg -i so it works even if ffprobe is missing (e.g. ffmpeg-static).
 */
function hasAudioStream(filePath) {
    try {
        execSync('"' + FFMPEG_PATH + '" -i "' + filePath + '" 2>&1', { encoding: 'utf8', timeout: 5000 });
        return false;
    } catch (e) {
        var out = (e.stdout || '') + (e.stderr || '');
        return /Stream #\d+:\d+.*Audio:/.test(out);
    }
}

/**
 * Render a single video clip segment with speed adjustment.
 * Ensures an audio stream is ALWAYS present.
 * Supports disabling audio via isMuted param.
 */
async function renderClipSegment(assetPath, sourceStart, sourceEnd, avgSpeed, outputPath, fps, isMuted) {
    fps = fps || 30;
    const sourceDuration = sourceEnd - sourceStart;
    const targetDuration = sourceDuration / Math.max(0.01, avgSpeed);

    if (avgSpeed < 0.01) {
        // HOLD: extract still frame
        const framePath = outputPath.replace(/\.[^/.]+$/, "") + ".jpg";
        await runFfmpeg([
            '-y', '-ss', String(sourceStart), '-i', assetPath,
            '-vframes', '1', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-q:v', '2', framePath
        ]);

        await runFfmpeg([
            '-y', '-loop', '1', '-i', framePath, '-t', String(targetDuration),
            '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
            '-vf', 'fps=' + fps + ',scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-shortest', outputPath
        ]);
        try { fs.unlinkSync(framePath); } catch (e) { }
        return;
    }

    // Normal speed segment
    var hasAudio = hasAudioStream(assetPath);
    var ptsFactor = 1 / avgSpeed;

    var args = ['-y', '-ss', String(sourceStart), '-t', String(sourceDuration), '-i', assetPath];
    var vf = 'setpts=' + ptsFactor + '*PTS,fps=' + fps + ',scale=trunc(iw/2)*2:trunc(ih/2)*2';

    // Use source audio ONLY if it exists AND is not muted
    if (hasAudio && !isMuted) {
        args.push('-vf', vf);
        args.push('-af', 'atempo=' + Math.max(0.5, Math.min(100, avgSpeed)));
        args.push('-c:v', 'libx264', '-c:a', 'pcm_s16le', '-pix_fmt', 'yuv420p', outputPath);
    } else {
        // Injection of silent audio
        args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
        args.push('-filter_complex', '[0:v]' + vf + '[v];[1:a]atrim=duration=' + targetDuration + '[a]');
        args.push('-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'pcm_s16le', '-pix_fmt', 'yuv420p', '-shortest', outputPath);
    }
    await runFfmpeg(args);
}

// ─── Helper: build animated FFmpeg expression from keyframes ───
function buildAnimExpr(kfs, prop, defaultVal, clipStart) {
    var sorted = kfs.slice().sort(function (a, b) { return a.time - b.time; });
    if (!sorted.length) return String(defaultVal);

    function pv(v) { return v < 0 ? '(' + v + ')' : String(v); }

    var last = sorted[sorted.length - 1];
    var e = pv(last[prop] != null ? last[prop] : defaultVal);

    for (var j = sorted.length - 2; j >= 0; j--) {
        var k1 = sorted[j], k2 = sorted[j + 1];
        var v1 = k1[prop] != null ? k1[prop] : defaultVal;
        var v2 = k2[prop] != null ? k2[prop] : defaultVal;
        var dur = k2.time - k1.time;
        var tB = '(t-' + clipStart + ')';
        // Need to escape commas for filter script usage: lte(A\,B)
        // var tBComma = tB.replace(/,/g, '\\,');

        var lerp;
        if (dur <= 0) {
            lerp = pv(v1);
        } else {
            lerp = '(' + pv(v1) + '+(' + pv(v2) + '-' + pv(v1) + ')*(' + tB + '-' + k1.time + ')/' + dur + ')';
        }
        // Use escaped commas for lte()
        e = 'if(lte(' + tB + '\\,' + k2.time + ')\\,' + lerp + '\\,' + e + ')';
    }

    var first = sorted[0];
    var firstVal = pv(first[prop] != null ? first[prop] : defaultVal);
    // Use escaped commas for lte()
    return 'if(lte(t-' + clipStart + '\\,' + first.time + ')\\,' + firstVal + '\\,' + e + ')';
}

function ffmpegColor(color) {
    if (!color) return 'white';
    if (color.charAt(0) === '#') return '0x' + color.slice(1);
    return color;
}

/**
 * Main export pipeline.
 */
async function exportProject(projectData, db, jobId, onProgress) {
    var tempDir = path.join(TEMP, jobId);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        var outputPath = path.join(EXPORTS, jobId + '.mp4');
        var segmentFiles = [];
        var totalDuration = 0;

        for (var t = 0; t < projectData.tracks.length; t++) {
            var clips = projectData.tracks[t].clips || [];
            for (var c = 0; c < clips.length; c++) totalDuration = Math.max(totalDuration, clips[c].start_time + clips[c].duration);
        }
        if (totalDuration <= 0) throw new Error('No content on timeline');

        // == Step 1: Render video clips ==
        var videoClips = [];
        for (var t = 0; t < projectData.tracks.length; t++) {
            var track = projectData.tracks[t];
            if (track.type === 'VIDEO_A' || track.type === 'VIDEO_B') {
                var clips = track.clips || [];
                for (var c = 0; c < clips.length; c++) {
                    videoClips.push(Object.assign({}, clips[c], { trackType: track.type }));
                }
            }
        }
        videoClips.sort(function (a, b) {
            return (a.start_time - b.start_time) || (a.trackType === 'VIDEO_B' ? -1 : 1);
        });

        for (var ci = 0; ci < videoClips.length; ci++) {
            var clip = videoClips[ci];
            var asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(clip.asset_id);
            if (!asset) continue;

            // CHECK MUTED STATUS
            var isMuted = (clip.properties && clip.properties.muted === true);
            var maxSourceDur = asset.duration || 10000;

            var speedKfs = clip.speedKeyframes || [];
            if (speedKfs.length <= 1) {
                var speed = speedKfs.length === 1 ? speedKfs[0].speed : 1;
                var sourceNeeded = clip.duration * speed;
                var actualSourceEnd = Math.min(clip.in_point + sourceNeeded, maxSourceDur);

                var segPath = path.join(tempDir, 'clip_' + ci + '_seg_0.mov');
                await renderClipSegment(asset.path, clip.in_point, actualSourceEnd, speed, segPath, asset.fps || 30, isMuted);
                segmentFiles.push({ path: segPath, start: clip.start_time, duration: clip.duration });
            } else {
                // Subdivision Logic for Sync Accuracy
                var sortedKfs = speedKfs.slice().sort(function (a, b) { return a.time - b.time; });
                var prevTime = 0;
                var accumSourceTime = clip.in_point;

                // Get last speed for extended segments
                var lastDefinedSpeed = sortedKfs.length > 0 ? sortedKfs[sortedKfs.length - 1].speed : 1;

                for (var ki = 0; ki <= sortedKfs.length; ki++) {
                    var kfTime = ki < sortedKfs.length ? sortedKfs[ki].time : clip.duration;
                    if (kfTime > clip.duration) kfTime = clip.duration;

                    var segDuration = kfTime - prevTime;
                    if (segDuration <= 0.001) continue;

                    var endSpeed = ki < sortedKfs.length ? sortedKfs[ki].speed : lastDefinedSpeed;
                    var startSpeed = ki === 0 ? sortedKfs[0].speed : (ki <= sortedKfs.length ? sortedKfs[ki - 1].speed : lastDefinedSpeed);

                    // Subdivide into small chunks (approx 0.5s or less) to improve sync accuracy
                    // Using Riemann sum approximation for the speed integral
                    var steps = Math.ceil(segDuration / 0.5);
                    var stepDur = segDuration / steps;

                    for (var s = 0; s < steps; s++) {
                        var t0 = s / steps;
                        var t1 = (s + 1) / steps;

                        // Lerp speed at start and end of this mini-chunk
                        var s0 = startSpeed + (endSpeed - startSpeed) * t0;
                        var s1 = startSpeed + (endSpeed - startSpeed) * t1;
                        var avgS = (s0 + s1) / 2;

                        var subSource = stepDur * avgS;
                        var safeSourceEnd = Math.min(accumSourceTime + subSource, maxSourceDur);

                        var segPath = path.join(tempDir, 'clip_' + ci + '_seg_' + ki + '_' + s + '.mov');
                        // Use stepDur? Actually renderClipSegment calculates target duration from source range / speed.
                        // Ideally we pass exact source range.
                        // If we clamp safeSourceEnd, target duration might shrink.

                        await renderClipSegment(asset.path, accumSourceTime, safeSourceEnd, avgS, segPath, asset.fps || 30, isMuted);

                        // We push whatever result we got.
                        // Note: If source ran out, actual duration will be shorter.
                        // We rely on concat dealing with it (it might desync slightly at end of clip if source runs out).
                        segmentFiles.push({ path: segPath, start: clip.start_time + prevTime + (s * stepDur), duration: stepDur });

                        accumSourceTime += subSource;
                        if (accumSourceTime >= maxSourceDur) break;
                    }

                    prevTime = kfTime;
                    if (accumSourceTime >= maxSourceDur) break;
                }
            }
            if (onProgress) onProgress(((ci + 1) / videoClips.length) * 40);
        }

        // == Step 2: Concat ==
        if (segmentFiles.length === 0) {
            await runFfmpeg([
                '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:d=' + totalDuration + ':r=30',
                '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
                '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-pix_fmt', 'yuv420p', outputPath
            ]);
        } else {
            var listPath = path.join(tempDir, 'concat.txt');
            var listContent = segmentFiles.map(function (s) {
                return "file '" + s.path.replace(/\\/g, '/') + "'";
            }).join('\n');
            fs.writeFileSync(listPath, listContent);
            await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'copy', '-c:a', 'aac', outputPath]);
        }
        if (onProgress) onProgress(60);

        // == Step 3: Overlays ==
        var overlays = [];
        for (var t = 0; t < projectData.tracks.length; t++) {
            var track = projectData.tracks[t];
            if (track.type === 'OVERLAY_TEXT' || track.type === 'OVERLAY_IMAGE') {
                var clips = track.clips || [];
                for (var c = 0; c < clips.length; c++) overlays.push(Object.assign({}, clips[c], { trackType: track.type }));
            }
        }

        if (overlays.length > 0) {
            var withOvPath = path.join(tempDir, 'with_ov.mp4');
            var inputs = ['-i', outputPath];
            var filterLines = [];
            var streamIdx = 1;
            var lastV = '[0:v]';
            var fontPath = 'C\\:/Windows/Fonts/arial.ttf';

            for (var i = 0; i < overlays.length; i++) {
                var clip = overlays[i];
                var start = clip.start_time;
                var end = start + clip.duration;
                var kfs = clip.overlayKeyframes || [];
                var isLast = (i === overlays.length - 1);
                var outLabel = isLast ? '' : '[v_tmp' + i + ']';

                if (clip.trackType === 'OVERLAY_IMAGE') {
                    var asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(clip.asset_id);
                    if (asset) {
                        var x = buildAnimExpr(kfs, 'x', 100, start);
                        var y = buildAnimExpr(kfs, 'y', 100, start);
                        var sx = buildAnimExpr(kfs, 'scale_x', 1, start);
                        var sy = buildAnimExpr(kfs, 'scale_y', 1, start);
                        var r = buildAnimExpr(kfs, 'rotation', 0, start);
                        var a = buildAnimExpr(kfs, 'opacity', 1, start);
                        var rRad = '(' + r + ')*PI/180';
                        var si = streamIdx++;
                        inputs.push('-loop', '1', '-t', String(totalDuration), '-i', asset.path);
                        filterLines.push(
                            '[' + si + ':v]format=rgba,' +
                            'rotate=' + rRad + ':c=none:ow=rotw(iw):oh=roth(ih),' +
                            'scale=eval=frame:w=iw*(' + sx + '):h=ih*(' + sy + '),' +
                            "colorchannelmixer=aa=" + a + '[ov' + i + ']'
                        );
                        filterLines.push(
                            lastV + '[ov' + i + ']overlay=x=' + x + ':y=' + y + ':' +
                            "enable=between(t\\," + start + "\\," + end + "):eval=frame" + outLabel
                        );
                        lastV = outLabel || lastV;
                    }
                } else {
                    var props = clip.properties || {};
                    var rawText = props.text || 'Text';
                    // Escape text for drawtext
                    var escapedText = rawText.replace(/\\/g, '\\\\').replace(/'/g, "'\\\\'").replace(/:/g, '\\\\:');
                    var fontSize = props.fontSize || 48;
                    var fontColor = ffmpegColor(props.color);
                    var x = buildAnimExpr(kfs, 'x', '(w-text_w)/2', start);
                    var y = buildAnimExpr(kfs, 'y', '(h-text_h)/2', start);
                    var a = buildAnimExpr(kfs, 'opacity', 1, start);

                    filterLines.push(
                        lastV + "drawtext=fontfile=" + fontPath + ":text='" + escapedText + "'" +
                        ':fontsize=' + fontSize + ':fontcolor=' + fontColor +
                        ':x=' + x + ':y=' + y + ':alpha=' + a +
                        ":enable=between(t\\," + start + "\\," + end + ")" + outLabel
                    );
                    lastV = outLabel || lastV;
                }
            }

            var filterScriptPath = path.join(tempDir, 'overlay_filter.txt');
            fs.writeFileSync(filterScriptPath, filterLines.join(';\n'));

            // KEY FIX: Use relative path to avoid drive letter colon issues in Windows FFmpeg
            var relFilterPath = path.relative(process.cwd(), filterScriptPath).replace(/\\/g, '/');

            var ffArgs = ['-y'].concat(inputs).concat([
                '-filter_complex_script', relFilterPath,
                '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'copy', withOvPath
            ]);
            await runFfmpeg(ffArgs);
            fs.copyFileSync(withOvPath, outputPath);
        }

        if (onProgress) onProgress(80);

        // == Step 4: Multi-Track Audio Mixing ==
        var audioTracks = projectData.tracks.filter(function (t) { return t.type === 'AUDIO'; });
        var audioClips = [];
        for (var t = 0; t < audioTracks.length; t++) {
            var clips = audioTracks[t].clips || [];
            for (var c = 0; c < clips.length; c++) audioClips.push(clips[c]);
        }

        if (audioClips.length > 0) {
            var withAudPath = path.join(tempDir, 'with_aud.mp4');
            var audInputs = [];
            var audFilters = [];
            var streamIdx = 1;

            for (var i = 0; i < audioClips.length; i++) {
                var clip = audioClips[i];
                var asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(clip.asset_id);
                if (!asset || (asset.type !== 'audio' && asset.type !== 'video')) continue;

                var si = streamIdx++;
                audInputs.push('-i', asset.path);
                var delay = Math.round(clip.start_time * 1000);
                var vol = (clip.properties && clip.properties.volume != null) ? clip.properties.volume : 1;
                var muted = (clip.properties && clip.properties.muted === true);
                var volumeVal = muted ? 0 : vol;

                audFilters.push(
                    '[' + si + ':a]atrim=start=' + clip.in_point + ':duration=' + clip.duration +
                    ',asetpts=PTS-STARTPTS,adelay=' + delay + '|' + delay +
                    ',volume=' + volumeVal + '[a' + i + ']'
                );
            }

            if (audFilters.length > 0) {
                var mixStr = audFilters.map(function (_, i) { return '[a' + i + ']'; }).join('') +
                    'amix=inputs=' + audFilters.length + ':duration=longest[mixed_bg]';
                var finalFilter = audFilters.join(';') + ';' + mixStr +
                    ';[0:a]volume=1[maina];[maina][mixed_bg]amix=inputs=2:duration=first[final_a]';

                await runFfmpeg(['-y', '-i', outputPath].concat(audInputs).concat([
                    '-filter_complex', finalFilter,
                    '-map', '0:v', '-map', '[final_a]',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', withAudPath
                ]));
                fs.copyFileSync(withAudPath, outputPath);
            }
        }

        if (onProgress) onProgress(100);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }
        return outputPath;
    } catch (err) {
        console.error('[ExportService] Fatal Error:', err);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { }
        throw err;
    }
}

module.exports = { exportProject, renderClipSegment, runFfmpeg, sanitize };
