
function mapClipSourceTime(clipLocalTime, keyframes) {
    if (!keyframes || keyframes.length === 0) return clipLocalTime;

    const kf = [...keyframes].sort((a, b) => a.time - b.time);
    let sourceTime = 0;
    let prevTime = 0;
    let prevSpeed = kf[0].speed;

    for (let i = 0; i < kf.length; i++) {
        const kfTime = kf[i].time;
        const kfSpeed = kf[i].speed;

        if (clipLocalTime <= kfTime) {
            const segLen = kfTime - prevTime;
            const t = clipLocalTime - prevTime;
            if (segLen === 0) {
                sourceTime += prevSpeed * t;
            } else {
                const frac = t / segLen;
                const speedAtT = prevSpeed + (kfSpeed - prevSpeed) * frac;
                sourceTime += t * (prevSpeed + speedAtT) / 2;
            }
            return sourceTime;
        }

        const segLen = kfTime - prevTime;
        sourceTime += segLen * (prevSpeed + kfSpeed) / 2;
        prevTime = kfTime;
        prevSpeed = kfSpeed;
    }

    const remaining = clipLocalTime - prevTime;
    sourceTime += remaining * prevSpeed;
    return sourceTime;
}

function getEasedProgress(t, easing) {
    if (easing === 'easeIn') return t * t;
    if (easing === 'easeOut') return t * (2 - t);
    if (easing === 'easeInOut') return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    return t;
}

function interpolateOverlay(clipLocalTime, keyframes) {
    const defaults = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
    if (!keyframes || keyframes.length === 0) return defaults;

    const kf = [...keyframes].sort((a, b) => a.time - b.time);

    if (clipLocalTime <= kf[0].time) return kfToTransform(kf[0]);
    if (clipLocalTime >= kf[kf.length - 1].time) return kfToTransform(kf[kf.length - 1]);

    for (let i = 0; i < kf.length - 1; i++) {
        if (clipLocalTime >= kf[i].time && clipLocalTime <= kf[i + 1].time) {
            const segLen = kf[i + 1].time - kf[i].time;
            let t = segLen === 0 ? 0 : (clipLocalTime - kf[i].time) / segLen;

            // Apply easing
            const easing = kf[i].easing || 'linear';
            t = getEasedProgress(t, easing);

            return {
                x: lerp(kf[i].x, kf[i + 1].x, t),
                y: lerp(kf[i].y, kf[i + 1].y, t),
                scaleX: lerp(kf[i].scale_x ?? kf[i].scaleX ?? 1, kf[i + 1].scale_x ?? kf[i + 1].scaleX ?? 1, t),
                scaleY: lerp(kf[i].scale_y ?? kf[i].scaleY ?? 1, kf[i + 1].scale_y ?? kf[i + 1].scaleY ?? 1, t),
                rotation: lerp(kf[i].rotation, kf[i + 1].rotation, t),
                opacity: lerp(kf[i].opacity, kf[i + 1].opacity, t),
            };
        }
    }
    return kfToTransform(kf[kf.length - 1]);
}

function evaluateTimeline(project, timelineTime) {
    const result = {
        videoA: null, videoB: null,
        overlayTexts: [], overlayImages: [],
        audio: null,
    };
    if (!project || !project.tracks) return result;

    for (const track of project.tracks) {
        for (const clip of track.clips || []) {
            const clipStart = clip.start_time;
            const clipEnd = clipStart + clip.duration;
            if (timelineTime < clipStart || timelineTime >= clipEnd) continue;

            const clipLocalTime = timelineTime - clipStart;

            if (track.type === 'VIDEO_A' || track.type === 'VIDEO_B') {
                const sourceTime = clip.in_point + mapClipSourceTime(clipLocalTime, clip.speedKeyframes || []);
                const entry = {
                    clipId: clip.id, assetId: clip.asset_id,
                    sourceTime, clipLocalTime,
                    properties: clip.properties || {},
                };
                if (track.type === 'VIDEO_A') result.videoA = entry;
                else result.videoB = entry;

            } else if (track.type === 'OVERLAY_TEXT' || track.type === 'OVERLAY_IMAGE') {
                const transform = interpolateOverlay(clipLocalTime, clip.overlayKeyframes || []);
                const entry = {
                    clipId: clip.id, assetId: clip.asset_id,
                    properties: typeof clip.properties === 'string' ? JSON.parse(clip.properties) : (clip.properties || {}),
                    transform,
                };
                if (track.type === 'OVERLAY_TEXT') result.overlayTexts.push(entry);
                else result.overlayImages.push(entry);

            } else if (track.type === 'AUDIO') {
                // Audio support placeholder
            }
        }
    }
    return result;
}

function getSpeedAtTime(clipLocalTime, keyframes) {
    if (!keyframes || keyframes.length === 0) return 1;
    const kf = [...keyframes].sort((a, b) => a.time - b.time);

    if (clipLocalTime <= kf[0].time) return kf[0].speed;
    if (clipLocalTime >= kf[kf.length - 1].time) return kf[kf.length - 1].speed;

    for (let i = 0; i < kf.length - 1; i++) {
        if (clipLocalTime >= kf[i].time && clipLocalTime <= kf[i + 1].time) {
            const segLen = kf[i + 1].time - kf[i].time;
            const t = segLen === 0 ? 0 : (clipLocalTime - kf[i].time) / segLen;
            return lerp(kf[i].speed, kf[i + 1].speed, t);
        }
    }
    return kf[kf.length - 1].speed;
}

function kfToTransform(kf) {
    return {
        x: kf.x ?? 0,
        y: kf.y ?? 0,
        scaleX: kf.scale_x ?? kf.scaleX ?? 1,
        scaleY: kf.scale_y ?? kf.scaleY ?? 1,
        rotation: kf.rotation ?? 0,
        opacity: kf.opacity ?? 1,
    };
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

module.exports = {
    mapClipSourceTime,
    interpolateOverlay,
    evaluateTimeline,
    getSpeedAtTime
};

