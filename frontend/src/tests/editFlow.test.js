
import { mapClipSourceTime, interpolateOverlay } from '../engine/timeEngine.js';

function approxEqual(a, b, eps = 0.001) {
    if (Math.abs(a - b) > eps) {
        throw new Error(`Expected ≈${b}, got ${a}`);
    }
}

// ── Test: Basic Edit Flow ──────────────────────────────────
function testBasicEditFlow() {
    const clip = {
        speedKeyframes: [
            { time: 0, speed: 1 },
            { time: 3, speed: 3 },
            { time: 6, speed: 1 },
        ]
    };

    // t=0
    approxEqual(mapClipSourceTime(0, clip.speedKeyframes), 0);
    // t=3: area = 3*(1+3)/2 = 6
    approxEqual(mapClipSourceTime(3, clip.speedKeyframes), 6);
    // t=6: area = 6 + 3*(3+1)/2 = 6 + 6 = 12
    approxEqual(mapClipSourceTime(6, clip.speedKeyframes), 12);

    console.log('  ✓ Speed Ramp logic PASSED');
}

// ── Test: Easing ───────────────────────────────────────────
function testEasing() {
    const kf = [
        { time: 0, x: 0, y: 0, scale_x: 1, rotation: 0, opacity: 1, easing: 'linear' },
        { time: 10, x: 100, y: 0, scale_x: 1, rotation: 0, opacity: 1 }
    ];

    // Linear: t=0.5 -> val=0.5
    let res = interpolateOverlay(5, kf);
    approxEqual(res.x, 50);

    // Ease In (t*t): t=0.5 -> val=0.25 -> x=25
    kf[0].easing = 'easeIn';
    res = interpolateOverlay(5, kf);
    approxEqual(res.x, 25);

    // Ease Out (t*(2-t)): t=0.5 -> val=0.75 -> x=75
    kf[0].easing = 'easeOut';
    res = interpolateOverlay(5, kf);
    approxEqual(res.x, 75);

    // Ease In Out: t=0.5 -> val=0.5 -> x=50 (inflection point)
    // t=0.25 -> 2*0.25^2 = 0.125 -> x=12.5
    kf[0].easing = 'easeInOut';
    res = interpolateOverlay(5, kf);
    approxEqual(res.x, 50);

    res = interpolateOverlay(2.5, kf);
    approxEqual(res.x, 12.5);

    console.log('  ✓ Easing logic PASSED');
}

// ── Run ──────────────────────────────────────────────────
console.log('\n🎬 Running Time Engine Verification...');
try {
    testBasicEditFlow();
    testEasing();
    console.log('\n✓ All tests passed!\n');
} catch (err) {
    console.error('\n✗ Test failed:', err.message, '\n');
    process.exit(1);
}
