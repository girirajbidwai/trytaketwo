# TryTakeTwo – Web-Based Video Editor

A full-stack, browser-based non-linear video editor (NLE) with multi-track timeline, variable speed ramping via keyframe integration, animated overlays, and server-side FFmpeg export.

---

## Table of Contents

- [Setup Instructions](#setup-instructions)
- [Architecture](#architecture)
- [Time Engine](#time-engine)
- [Export Approach](#export-approach)
- [Data Model](#data-model)
- [AI Usage](#ai-usage)

---

## Setup Instructions

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 18+ | With npm |
| **FFmpeg** | 4.x+ | Must be on PATH (`ffmpeg -version` should work) |
| **Git** | Any | For cloning |

### Quick Start (Local – No Docker)

```bash
# 1. Clone the repo
git clone https://github.com/girirajbidwai/trytaketwo.git
cd trytaketwo

# 2. Install backend dependencies
cd backend && npm install

# 3. Install frontend dependencies
cd ../frontend && npm install

# 4. Start the backend (Terminal 1)
cd ../backend && npm run dev
# → Runs on http://localhost:3001

# 5. Start the frontend (Terminal 2)
cd ../frontend && npm run dev
# → Runs on http://localhost:5173

# 6. Open your browser
# Navigate to http://localhost:5173
```

### Quick Start (Docker)

```bash
# Single command to build and start everything
docker-compose up --build

# Frontend:  http://localhost:5173
# Backend:   http://localhost:3001
```

### Environment Variables (Optional)

Copy `.env.example` to `.env` in the backend directory:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend server port |
| `STORAGE_PATH` | `./storage` | Directory for uploads, thumbnails, and exports |
| `FFMPEG_PATH` | Auto-detected | Explicit path to FFmpeg binary |

### Running Tests

```bash
# Time Engine unit tests (speed ramp math, hold frames, overlay interpolation)
cd backend && node src/engine/timeEngine.test.js

# Backend integration tests (export idempotency, project save/load)
cd backend && node src/tests/backend.test.js

# Frontend edit flow tests (clip creation, speed keyframes, timeline evaluation)
cd frontend && node src/tests/editFlow.test.js
```

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                     Frontend (Vite + Vanilla JS + Zustand)             │
│                                                                        │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │
│  │  Timeline     │   │  Preview      │   │  Properties   │              │
│  │  Canvas       │   │  <video> +    │   │  Panel        │              │
│  │  (drag/drop,  │   │  Canvas       │   │  (Speed KF,   │              │
│  │   trim, snap) │   │  (composited) │   │   Overlays,   │              │
│  └──────┬────────┘   └──────┬────────┘   │   Audio)      │              │
│         │                   │            └───────────────┘              │
│  ┌──────┴───────────────────┴────────────────────────────┐             │
│  │          Time Engine (Isomorphic – shared logic)       │             │
│  │  • mapClipSourceTime()     timeline → source time      │             │
│  │  • evaluateTimeline()      what's active at time T     │             │
│  │  • interpolateOverlay()    keyframe interpolation       │             │
│  │  • getSpeedAtTime()        speed at any point           │             │
│  └────────────────────────────────────────────────────────┘             │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
                          REST API
                         (JSON + Multipart)
                               │
┌──────────────────────────────┴─────────────────────────────────────────┐
│                     Backend (Node.js + Express)                         │
│                                                                        │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐       │
│  │ Project API   │   │ Asset API    │   │ Export API            │       │
│  │ CRUD, Save,   │   │ Upload,      │   │ Queue, Status,        │       │
│  │ Load, List    │   │ Ingest,      │   │ Download, Progress    │       │
│  │               │   │ Thumbnail,   │   │                       │       │
│  │               │   │ Stream       │   │                       │       │
│  └──────┬────────┘   └──────┬───────┘   └──────────┬────────────┘      │
│         │                   │                      │                    │
│  ┌──────┴────┐   ┌──────────┴──────┐   ┌──────────┴───────────┐       │
│  │  SQLite    │   │  FFprobe +      │   │  FFmpeg Export        │       │
│  │  (better-  │   │  Thumbnails     │   │  Pipeline             │       │
│  │  sqlite3)  │   │  (auto-gen)     │   │  (Segmented Render)   │       │
│  └────────────┘   └─────────────────┘   └──────────────────────┘       │
└────────────────────────────────────────────────────────────────────────┘
```

### Request Flow

```
User Action                Frontend                  Backend
───────────                ────────                  ───────
Drag video to timeline  →  Zustand store update   →  (no API call – client-side)
Press Play              →  rAF loop + Time Engine →  (no API call – client-side)
Import media file       →  File picker            →  POST /api/assets/upload
Click Export            →  POST /api/export        →  FFmpeg pipeline starts
Poll export status      →  GET /api/export/:id     →  Returns progress/download
```

### Key Frontend Modules

| File | Responsibility |
|---|---|
| `frontend/src/main.js` | App init, timeline rendering, preview engine, properties panel, playback loop |
| `frontend/src/store.js` | Zustand state management (project, selection, time, assets) |
| `frontend/src/engine/timeEngine.js` | Isomorphic time engine (speed ramps, overlay interpolation) |
| `frontend/src/api.js` | REST API client wrapper |
| `frontend/index.html` | Full application UI markup |
| `frontend/src/styles/main.css` | Premium dark theme design system |

### Key Backend Modules

| File | Responsibility |
|---|---|
| `backend/src/server.js` | Express server setup, middleware, route mounting |
| `backend/src/db.js` | SQLite schema, migrations, singleton connection |
| `backend/src/routes/projects.js` | Project CRUD (create, list, get, save timeline) |
| `backend/src/routes/assets.js` | Asset upload, ingest, streaming, thumbnail serving |
| `backend/src/routes/exports.js` | Export job creation, status polling, file download |
| `backend/src/services/exportService.js` | FFmpeg segmented render pipeline |
| `backend/src/services/ingestService.js` | Media probe, thumbnail generation, metadata extraction |

---

## Time Engine

The Time Engine is the **core algorithm** powering both preview playback and export rendering. It provides a deterministic mapping:

```
Timeline Time  →  Clip Local Time  →  Source (Media) Time
```

### The Problem It Solves

In a video editor with variable speed ramps, the relationship between "where the playhead is" and "which frame of the source video to show" is non-linear. A 10-second clip at 2× speed consumes 20 seconds of source material. A freeze-frame at 0× speed consumes no source material while time advances.

### Speed Ramp Algorithm

Speed keyframes define the playback speed at specific points within clip-local time. Between keyframes, speed is **linearly interpolated**.

The source time is computed via **piecewise trapezoidal integration** of the speed function:

```
source_time = in_point + ∫₀ᵗ speed(τ) dτ
```

For each segment between consecutive keyframes [t₀, t₁] with speeds [s₀, s₁]:

```
speed(t) = s₀ + (s₁ - s₀) × (t - t₀) / (t₁ - t₀)    ← linear interpolation
source_consumed = (t₁ - t₀) × (s₀ + s₁) / 2            ← trapezoidal rule (exact)
```

**Example:** A clip with keyframes `[{time: 0, speed: 1}, {time: 2, speed: 3}]`
- At timeline second 1: speed = 2×, source time = 0 + (1 × (1+2)/2) = 1.5s
- At timeline second 2: speed = 3×, source time = 0 + (2 × (1+3)/2) = 4.0s

### Special Cases

| Case | Behavior |
|---|---|
| **Hold (speed = 0)** | Source time freezes; the same frame is shown while the timeline advances (freeze-frame effect) |
| **Speed > 1** | Fast-forward; source time advances faster than timeline time |
| **Speed < 1** | Slow motion; source time advances slower than timeline time |
| **No keyframes** | Defaults to 1× speed (identity mapping) |

### Guarantees

- ✅ **Deterministic:** Same input always produces the same output
- ✅ **Monotonically non-decreasing:** Source time never goes backwards
- ✅ **No drift:** Integration is exact for piecewise-linear speed curves (not an approximation)
- ✅ **Isomorphic:** Same code runs in both browser (preview) and server (export)

### Key Functions

| Function | Input → Output |
|---|---|
| `mapClipSourceTime(clipLocalTime, keyframes)` | Clip-local time → source frame time |
| `evaluateTimeline(project, timelineTime)` | "What's visible at time T?" → active video layers, text overlays, image overlays, audio clips with properties |
| `interpolateOverlay(clipLocalTime, keyframes)` | Overlay keyframe time → `{x, y, scale_x, scale_y, rotation, opacity}` |
| `getSpeedAtTime(clipLocalTime, keyframes)` | Time → instantaneous speed value |

---

## Export Approach

### Pipeline Overview

The export pipeline converts the frontend's timeline state into a rendered MP4 video using FFmpeg. It runs entirely server-side and supports all timeline features.

```
Step 1: Segment Render
  For each video clip on the timeline:
    → Split into sub-segments at each speed keyframe boundary
    → Render each segment with FFmpeg setpts filter for precise speed control
    → Hold frames (speed=0) are extracted as stills and looped
    → Each segment always includes an audio stream (real or silent)

Step 2: Concatenation
  → All segments are concatenated via FFmpeg concat demuxer
  → Order follows timeline start_time

Step 3: Overlay Compositing
  → Text overlays applied via FFmpeg drawtext filter with animated expressions
  → Image overlays applied via FFmpeg overlay filter with animated transforms
  → Keyframe animation is expressed as FFmpeg if(lte()) expression chains
  → All overlays rendered in a single filter_complex_script pass

Step 4: Audio Mixing
  → Audio-only track clips are mixed with the video's audio
  → Per-clip volume and mute is respected
  → Uses amix filter for multi-track mixing

Output: Final MP4 (H.264 + AAC)
```

### Mute Handling

Audio muting is handled at two levels:

| Level | Mechanism |
|---|---|
| **Preview (browser)** | `video.muted = true` + `video.volume = 0` + pause-play cycle to break audio pipeline |
| **Export (FFmpeg)** | Muted clips get `anullsrc` (silent audio) injected instead of source audio |

### Async Job Architecture

```
POST /api/export  →  Job Created (QUEUED)
                           ↓
                    Background Worker
                           ↓
                  RUNNING (progress: 0-100%)
                      ↓           ↓
              COMPLETE           FAILED
          (download link)     (error stored)
```

- **Idempotent:** Same `requestId` returns the existing job (DB unique constraint)
- **Progress polling:** Frontend polls `GET /api/export/:id` every 2 seconds
- **Cleanup:** Temporary segment files are deleted after successful export

### Limitations & Preview-Export Gap

| Aspect | Preview (Browser) | Export (FFmpeg) |
|---|---|---|
| **Speed ramps** | Approximate (`video.playbackRate` + seeking) | Precise (`setpts` filter per sub-segment with trapezoidal integration) |
| **Text overlays** | Canvas `fillText()` in real-time | FFmpeg `drawtext` filter with animated expressions |
| **Image overlays** | Canvas `drawImage()` with transforms | FFmpeg `overlay` + `rotate` + `scale` + `colorchannelmixer` |
| **Compositing** | Canvas layers drawn per frame | FFmpeg filter_complex_script chain |
| **Quality** | Screen resolution dependent | Source resolution (full quality) |
| **Audio sync** | Best-effort via drift correction | Frame-accurate via setpts + atempo |

**The export is the source of truth.** The preview approximates the final result but may show slight frame-level differences, especially with:
- Complex multi-keyframe speed ramps (preview uses `playbackRate` which only supports limited values)
- Overlay positioning (Canvas vs FFmpeg coordinate systems have minor differences)
- Audio timing at speed boundaries (browser `atempo` equivalent doesn't exist)

### Known Limitations

1. **No GPU acceleration** – Export uses `libx264` CPU encoding only
2. **Windows font path** – Text overlay `drawtext` uses `C:/Windows/Fonts/arial.ttf` (hardcoded)
3. **Single concurrent export** – No job queue parallelism
4. **No transitions in export** – Transitions (fade, wipe) are preview-only for now
5. **Maximum speed** – `atempo` filter supports 0.5× – 100× (FFmpeg limitation)
6. **Large files** – No chunked upload; memory constrained by Express body parser

---

## Data Model

```
Project 1─────N Asset        (media files: video, audio, image)
Project 1─────N Track        (timeline lanes: VIDEO_A, VIDEO_B, AUDIO, OVERLAY_TEXT, OVERLAY_IMAGE)
Track   1─────N Clip         (placed media segments on a track)
Clip    1─────N SpeedKeyframe    (variable speed control points)
Clip    1─────N OverlayKeyframe  (position, scale, rotation, opacity over time)
Project 1─────N ExportJob    (render jobs with status and progress)
```

### Track Types

| Type | Purpose |
|---|---|
| `VIDEO_A` | Primary video layer |
| `VIDEO_B` | Secondary video layer (for transitions/compositing) |
| `AUDIO` | Audio-only tracks (background music, voiceover) |
| `OVERLAY_TEXT` | Animated text overlays |
| `OVERLAY_IMAGE` | Animated image overlays (logos, stickers) |

---

## AI Usage

This project was built with AI assistance using **Google's Antigravity** (an agentic AI coding assistant by Google DeepMind).

### What AI Was Used For

| Area | AI Contribution |
|---|---|
| **Architecture design** | System architecture, data model design, module decomposition, and REST API contract design |
| **Time Engine** | Core algorithm design (trapezoidal integration for speed ramps), mathematical formulation, and edge case identification (hold frames, speed boundaries) |
| **Code generation** | All source code across frontend and backend: Express server, SQLite schema, FFmpeg pipeline, Zustand store, timeline UI, preview engine, properties panel |
| **Export pipeline** | Segmented render approach, FFmpeg filter chain construction, animated overlay expression generation (`if/lte` chains), audio mixing logic |
| **Bug fixing** | Debugging mute toggle reliability (DOM-mid-event destruction), volume clamping, stale closure identification, video element instance isolation via clipId |
| **CSS/UI design** | Premium dark theme design system, glassmorphism effects, toggle switch components, responsive layout |
| **Test design** | Unit test cases for time engine math, backend integration tests, frontend edit flow tests |
| **Documentation** | This README, ARCHITECTURE.md, inline code comments |
| **DevOps** | Dockerfile creation, docker-compose orchestration, .gitignore configuration |

### What Was Manually Verified

| Area | Verification Method |
|---|---|
| **Time engine correctness** | Hand-calculated test cases for trapezoidal integration (e.g., speed ramp from 1× to 3× over 2 seconds should yield source time = 4.0s). Verified monotonicity and edge cases (speed=0 hold, single keyframe) |
| **FFmpeg command construction** | Manually inspected generated FFmpeg commands and filter scripts. Verified `setpts` factor calculation, `atempo` range clamping, and `concat` demuxer input format |
| **Frontend interactions** | Manual testing of drag-and-drop clip placement, timeline scrubbing, clip selection, split/trim operations, and keyboard shortcuts in Chrome |
| **Mute toggle behavior** | Tested mute during active playback, while paused, rapid toggling, and across page refreshes. Verified audio silence in both preview and exported files |
| **Export output** | Compared exported MP4 files against expected behavior: correct speed ramps, overlay positioning, audio mute status, and segment concatenation continuity |
| **Cross-browser audio** | Tested autoplay policies and `video.muted` behavior in Chromium-based browsers. Verified the pause-play cycle approach for mid-stream mute changes |
| **CSS and layout** | Visual inspection of the editor UI at different viewport sizes. Verified dark theme contrast ratios, animation smoothness, and interactive element hover states |
| **API error handling** | Tested API endpoints with missing parameters, invalid IDs, and concurrent requests. Verified proper HTTP status codes and error messages |

### AI Limitations Encountered

- **Browser audio quirks:** AI initially set only `video.volume = 0` for muting, which doesn't reliably stop audio output on some browsers when the video is actively playing. This required iterative debugging and the eventual pause-play cycle approach was developed through multiple rounds of testing.
- **FFmpeg filter escaping:** AI-generated FFmpeg filter expressions required manual comma-escaping fixes for Windows compatibility (`\\,` in `filter_complex_script`).
- **DOM lifecycle timing:** The checkbox-based mute toggle was AI-generated but had a subtle bug where `renderProperties()` destroyed the checkbox DOM element mid-event. This required redesigning the approach to use a deferred `setTimeout(0)` update pattern.
