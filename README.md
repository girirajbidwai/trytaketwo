# TryTakeTwo – Web-Based Video Editor

A full-stack video editor with multi-track timeline, speed ramping (keyframed time-remap),
motion graphics overlays, and server-side FFmpeg export.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Vite + Vanilla JS)                  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Timeline  │  │   Preview    │  │  Properties  │              │
│  │ (DOM +    │  │ (<video> +   │  │  (Speed KF   │              │
│  │  drag)    │  │  Canvas)     │  │  + Overlay)  │              │
│  └─────┬─────┘  └──────┬───────┘  └──────────────┘              │
│        │               │                                         │
│  ┌─────┴───────────────┴─────────┐                              │
│  │  Time Engine (Client-side)    │  Shared isomorphic logic     │
│  │  mapClipSourceTime()          │                              │
│  │  evaluateTimeline()           │                              │
│  │  interpolateOverlay()         │                              │
│  └───────────────────────────────┘                              │
└─────────────────────┬───────────────────────────────────────────┘
                      │ REST API
┌─────────────────────┴───────────────────────────────────────────┐
│                    Backend (Node.js + Express)                    │
│  ┌─────────────┐  ┌────────────┐  ┌──────────────────────┐     │
│  │ Project API  │  │ Asset API  │  │ Export API           │     │
│  │ CRUD, Save   │  │ Upload,    │  │ Queue, Status,       │     │
│  │ /Load        │  │ Ingest     │  │ Download             │     │
│  └──────┬───────┘  └─────┬──────┘  └──────────┬───────────┘     │
│         │                │                     │                 │
│  ┌──────┴────┐  ┌────────┴──────┐  ┌──────────┴───────────┐    │
│  │  SQLite   │  │  FFprobe +    │  │  FFmpeg Export        │    │
│  │  (DB)     │  │  Thumbnails   │  │  (Segmented Render)   │    │
│  └───────────┘  └───────────────┘  └──────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Setup Instructions

### Prerequisites
- **Node.js** 18+ (with npm)
- **FFmpeg** installed and available on PATH (`ffmpeg -version` should work)

### Quick Start

```bash
# 1. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 2. Start backend (terminal 1)
cd backend && npm run dev

# 3. Start frontend (terminal 2)
cd frontend && npm run dev

# 4. Open the editor
# Navigate to http://localhost:5173

# 5. (Optional) Seed demo project with sample videos
cd backend && npm run seed
```

### Running Tests

```bash
# Time Engine tests (speed ramp + hold + timeline eval + overlay interpolation)
cd backend && node src/engine/timeEngine.test.js

# Backend tests (export idempotency + project save/load integrity)
cd backend && node src/tests/backend.test.js

# Frontend test (basic edit flow with speed keyframes)
cd frontend && node src/tests/editFlow.test.js
```

## Time Engine

The Time Engine is the **core algorithm** powering the editor. It provides a deterministic
mapping from timeline time → clip local time → source (media) time, accounting for
speed ramps via keyframe interpolation.

### Speed Ramp Algorithm

Speed keyframes define the playback speed at specific points in clip-local time.
Between keyframes, speed is **linearly interpolated**.

The source time is computed via **piecewise trapezoidal integration**:

```
source_time = ∫₀ᵗ speed(τ) dτ
```

For each segment between consecutive keyframes [t₀, t₁] with speeds [s₀, s₁]:
- Speed is linearly interpolated: `speed(t) = s₀ + (s₁ - s₀) × (t - t₀) / (t₁ - t₀)`
- Source consumed = `(t₁ - t₀) × (s₀ + s₁) / 2` (trapezoidal rule)

**Hold (speed = 0):** When speed is 0, no source time is consumed. The source frame
freezes while the timeline advances. This creates a hold/freeze-frame effect.

**Guarantees:**
- ✅ Deterministic: same input always produces same output
- ✅ Monotonically non-decreasing: source time never goes backwards
- ✅ No drift: integration is exact for piecewise-linear speed curves
- ✅ Supports 0x (hold) through 8x speed

### Key Functions

| Function | Description |
|----------|-------------|
| `mapClipSourceTime(clipLocalTime, keyframes)` | Clip-local time → source time |
| `evaluateTimeline(project, timelineTime)` | At time T: active clips, source times, overlay transforms |
| `interpolateOverlay(clipLocalTime, keyframes)` | Linear interpolation of position, scale, rotation, opacity |
| `getSpeedAtTime(clipLocalTime, keyframes)` | Current speed at a given time |

## Export Approach

### Pipeline
1. **Segment-based rendering**: Each video clip is split into segments between speed keyframes
2. **Per-segment FFmpeg**: Each segment rendered with `setpts` filter for speed adjustment
3. **Hold frames**: Freeze frames extracted and looped for hold duration
4. **Concat**: All segments concatenated via FFmpeg concat demuxer
5. **Overlays**: Text overlays applied via `drawtext` filter, image overlays via `overlay` filter
6. **Audio mix**: Optional audio track mixed with `-shortest` flag

### Async Job States
```
QUEUED → RUNNING → COMPLETE (download link available)
                 → FAILED (error message stored)
```

- **Idempotent**: Same `requestId` returns existing job (unique constraint)
- **Progress**: Updated during render, polled from frontend every 2 seconds

### Limitations / Preview-Export Gap

| Aspect | Preview | Export |
|--------|---------|-------|
| Speed ramps | Approximate (`playbackRate` + seeking) | Precise (FFmpeg `setpts` filter per segment) |
| Text overlays | Canvas `fillText` in real-time | FFmpeg `drawtext` filter |
| Compositing | Canvas layer over `<video>` | FFmpeg filter chain |
| Quality | Screen resolution dependent | Source resolution |

The export is the source of truth. Preview approximates the final result but may
show slight frame-level differences, especially with complex speed ramps.

## Data Model

```
Project 1─────N Asset
Project 1─────N Track
Track   1─────N Clip
Clip    1─────N SpeedKeyframe
Clip    1─────N OverlayKeyframe
Project 1─────N ExportJob
```

Track types: `VIDEO_A`, `VIDEO_B`, `OVERLAY_TEXT`, `OVERLAY_IMAGE`, `AUDIO`

## AI Usage

This project was built with AI assistance (Google's Antigravity coding assistant).

**AI was used for:**
- Architecture design and data modeling
- Code generation for all modules
- Test case design and mathematical verification
- Documentation writing

**Manually verified:**
- Time engine correctness via hand-calculated test cases
- Export pipeline FFmpeg command construction
- Frontend interaction logic (drag, trim, split, snap)
- CSS design and responsive layout
- API endpoint contracts and error handling
