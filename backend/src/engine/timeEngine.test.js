// ============================================================
// Time Engine Tests – speed ramp + hold
// ============================================================
const { mapClipSourceTime, evaluateTimeline, interpolateOverlay } = require('./timeEngine');

// Helpers
function approxEqual(a, b, eps = 0.001) {
    if (Math.abs(a - b) > eps) {
        throw new Error(`Expected ≈${b}, got ${a} (diff: ${Math.abs(a - b)})`);
    }
    return true;
}

// ── Test 1: Speed Ramp ────────────────────────────────────────
// Clip with keyframes at t=0 (1x), t=2s (2x), t=4s (1x)
// Between [0,2]: speed linearly goes 1x→2x
//   source_time at t=2 = integral of (1 + t*0.5) from 0 to 2
//                        = 2*(1+2)/2 = 3s of source consumed
// Between [2,4]: speed linearly goes 2x→1x
//   source_time at t=4 = 3 + integral of (2 - (t-2)*0.5) from 2 to 4
//                        = 3 + 2*(2+1)/2 = 3 + 3 = 6s
function testSpeedRamp() {
    const keyframes = [
        { time: 0, speed: 1 },
        { time: 2, speed: 2 },
        { time: 4, speed: 1 },
    ];

    // At t=0: source = 0
    approxEqual(mapClipSourceTime(0, keyframes), 0);

    // At t=1: speed interpolated = 1.5, area = 1 * (1 + 1.5) / 2 = 1.25
    approxEqual(mapClipSourceTime(1, keyframes), 1.25);

    // At t=2: area = 2 * (1 + 2) / 2 = 3
    approxEqual(mapClipSourceTime(2, keyframes), 3);

    // At t=3: between kf[1] (speed 2 at t=2) and kf[2] (speed 1 at t=4)
    // t=3 is 0.5 through, speed = 2 + (1-2)*0.5 = 1.5
    // area from 2 to 3 = 1 * (2 + 1.5) / 2 = 1.75
    // total = 3 + 1.75 = 4.75
    approxEqual(mapClipSourceTime(3, keyframes), 4.75);

    // At t=4: area from 2 to 4 = 2 * (2 + 1) / 2 = 3; total = 3 + 3 = 6
    approxEqual(mapClipSourceTime(4, keyframes), 6);

    // Past last keyframe at t=5 (constant speed 1): total = 6 + 1 = 7
    approxEqual(mapClipSourceTime(5, keyframes), 7);

    console.log('  ✓ Test 1: Speed ramp mapping PASSED');
}

// ── Test 2: Hold (speed = 0) ──────────────────────────────────
// Clip with keyframes: t=0 (1x), t=1 (0x), t=3 (0x), t=4 (1x)
// [0,1]: speed 1→0, area = 1*(1+0)/2 = 0.5s source consumed
// [1,3]: speed 0→0 (hold), area = 0  
// [3,4]: speed 0→1, area = 1*(0+1)/2 = 0.5s source consumed
// Total at t=4: 0.5 + 0 + 0.5 = 1.0s of source consumed
function testHold() {
    const keyframes = [
        { time: 0, speed: 1 },
        { time: 1, speed: 0 },
        { time: 3, speed: 0 },
        { time: 4, speed: 1 },
    ];

    // At t=0: source = 0
    approxEqual(mapClipSourceTime(0, keyframes), 0);

    // At t=1: area = 1*(1+0)/2 = 0.5
    approxEqual(mapClipSourceTime(1, keyframes), 0.5);

    // During hold at t=2: source stays at 0.5 (speed is 0)
    approxEqual(mapClipSourceTime(2, keyframes), 0.5);

    // End of hold at t=3: source still 0.5
    approxEqual(mapClipSourceTime(3, keyframes), 0.5);

    // At t=3.5: speed = 0.5, area from 3 to 3.5 = 0.5*(0+0.5)/2 = 0.125
    // total = 0.5 + 0 + 0.125 = 0.625
    approxEqual(mapClipSourceTime(3.5, keyframes), 0.625);

    // At t=4: area from 3 to 4 = 1*(0+1)/2 = 0.5; total = 0.5 + 0 + 0.5 = 1.0
    approxEqual(mapClipSourceTime(4, keyframes), 1.0);

    // Source time must NEVER go backwards (monotonically non-decreasing)
    let prev = 0;
    for (let t = 0; t <= 5; t += 0.1) {
        const src = mapClipSourceTime(t, keyframes);
        if (src < prev - 0.0001) {
            throw new Error(`Source time went backwards at t=${t}: ${src} < ${prev}`);
        }
        prev = src;
    }

    console.log('  ✓ Test 2: Hold mapping PASSED (no drift, monotonic)');
}

// ── Test 3: evaluateTimeline ───────────────────────────────────
function testEvaluateTimeline() {
    const project = {
        tracks: [
            {
                type: 'VIDEO_A',
                clips: [{
                    id: 'clip1',
                    asset_id: 'asset1',
                    start_time: 0,
                    duration: 5,
                    in_point: 0,
                    out_point: 5,
                    speedKeyframes: [{ time: 0, speed: 1 }, { time: 2, speed: 2 }],
                    properties: {},
                }],
            },
            {
                type: 'OVERLAY_TEXT',
                clips: [{
                    id: 'text1',
                    start_time: 1,
                    duration: 3,
                    in_point: 0,
                    out_point: 3,
                    overlayKeyframes: [
                        { time: 0, x: 0, y: 0, scale_x: 1, scale_y: 1, rotation: 0, opacity: 0 },
                        { time: 3, x: 100, y: 100, scale_x: 2, scale_y: 2, rotation: 45, opacity: 1 },
                    ],
                    properties: { text: 'Hello' },
                }],
            },
        ],
    };

    // At t=2.5, clip1 is active (clipLocalTime = 2.5), text1 is active (clipLocalTime = 1.5)
    const evalResult = evaluateTimeline(project, 2.5);
    if (!evalResult.videoA) throw new Error('videoA should be active at t=2.5');
    if (evalResult.videoA.clipId !== 'clip1') throw new Error('Wrong clip on videoA');
    if (evalResult.overlayTexts.length !== 1) throw new Error('One text overlay expected');

    // Overlay at clipLocalTime 1.5 (50% through): x should be ~50
    const tx = evalResult.overlayTexts[0].transform;
    approxEqual(tx.x, 50);
    approxEqual(tx.opacity, 0.5);

    // At t=6, nothing should be active
    const evalResult2 = evaluateTimeline(project, 6);
    if (evalResult2.videoA) throw new Error('videoA should not be active at t=6');

    console.log('  ✓ Test 3: Timeline evaluation PASSED');
}

// ── Test 4: Overlay interpolation ─────────────────────────────
function testOverlayInterpolation() {
    const kfs = [
        { time: 0, x: 0, y: 0, scale_x: 1, scale_y: 1, rotation: 0, opacity: 0 },
        { time: 2, x: 200, y: 100, scale_x: 2, scale_y: 2, rotation: 90, opacity: 1 },
    ];

    const mid = interpolateOverlay(1, kfs); // 50% through
    approxEqual(mid.x, 100);
    approxEqual(mid.y, 50);
    approxEqual(mid.scaleX, 1.5);
    approxEqual(mid.rotation, 45);
    approxEqual(mid.opacity, 0.5);

    // Before first keyframe
    const before = interpolateOverlay(-1, kfs);
    approxEqual(before.x, 0);

    // After last keyframe
    const after = interpolateOverlay(5, kfs);
    approxEqual(after.x, 200);

    console.log('  ✓ Test 4: Overlay interpolation PASSED');
}

// ── Run all ───────────────────────────────────────────────────
console.log('\n⏱  Time Engine Tests\n');
try {
    testSpeedRamp();
    testHold();
    testEvaluateTimeline();
    testOverlayInterpolation();
    console.log('\n✓ All time engine tests passed!\n');
} catch (err) {
    console.error('\n✗ Test failed:', err.message, '\n');
    process.exit(1);
}
