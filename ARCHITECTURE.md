# TryTakeTwo Architecture

## 1. Overview
TryTakeTwo is a web-based non-linear video editor (NLE) that allows users to create projects, upload assets (video/audio/image), arrange them on a multi-track timeline, apply effects (speed ramps, overlays, transitions), and export the final composition.

## 2. Technology Stack

### Frontend
*   **Framework**: Vanilla JavaScript (ES Modules) with `Vite` as the build tool.
*   **State Management**: `Zustand` (for global store: project state, playback status, selection).
*   **Styling**: Plain CSS (Variables, Flexbox/Grid) with a custom dark theme.
*   **Interaction**: Custom drag-and-drop implementation for timeline clips and resizable panels.
*   **Playback**: HTML5 `<video>` element synchronized with a requestAnimationFrame loop (`timeEngine.js`) for frame-accurate seeking and preview.

### Backend
*   **Runtime**: Node.js (Express.exe).
*   **Database**: SQLite (`better-sqlite3`) - High-performance synchronous I/O, ideal for single-user desktop-like web apps.
*   **Video Processing**:
    *   `fluent-ffmpeg`: Wrapper for constructing complex FFmpeg commands.
    *   `ffmpeg-static`: Bundled FFmpeg binary for portability.
    *   `ffprobe`: For asset metadata extraction.
*   **File Handling**: `multer` for streaming uploads to disk.

### Infrastructure (Docker)
*   **Containerization**: Docker & Docker Compose.
*   **Volumes**: Persistent storage for `data/` (SQLite DB) and `storage/` (User uploads & Exports).

---

## 3. Backend Services & Modules

### `src/server.js`
*   Entry point. Configures Express, CORS, and static routes.
*   Initializes database connection and mounts API routes.
*   Ensures storage directories exist (`uploads`, `thumbnails`, `exports`).

### `src/db.js`
*   Singleton database instance using `better-sqlite3`.
*   **Schema**:
    *   `projects`: Root entity.
    *   `assets`: Uploaded files linked to projects.
    *   `tracks`: Fixed audio/video lanes (VIDEO_A, VIDEO_B, OVERLAY_TEXT, etc.).
    *   `clips`: Instances of assets placed on tracks with in/out points.
    *   `speed_keyframes`: For variable speed ramps (time remapping).
    *   `overlay_keyframes`: For animating transform properties (x, y, scale, rotation, opacity).
    *   `export_jobs`: Tracks status of background render tasks.

### `src/services/`
#### `ingestService.js`
*   **Responsibility**: Handle file imports.
*   **Flow**:
    1.  Validate MIME type and size.
    2.  `probeFile`: Use `ffprobe` to get duration, resolution, codec, and FPS.
    3.  `generateThumbnail`: Extract a frame at 50% duration (or default 5s) using FFmpeg.
    4.  Insert into `assets` table.

#### `exportService.js`
*   **Responsibility**: The core rendering engine.
*   **Mechanism**: A multi-step FFmpeg pipeline.
    1.  **Segment Rendering**: Splits clips into small chunks based on Speed Keyframes.
        *   *Update*: Now uses `.mov` (PCM Audio) intermediates to prevent A/V desync caused by AAC padding in MP4s.
    2.  **Concatenation**: Stitches segments together losslessly.
    3.  **Overlays**: Applies text/image overlays using complex filter graphs (`drawtext`, `overlay`).
    4.  **Audio Mixing**: Mixes background tracks with video audio, handles volume/muting/trimming (`amix`).
*   **Execution**: Spawns `ffmpeg` child processes directly.

### `src/routes/`
*   `projects.js`: CRUD for projects. **Note**: Saving the timeline (`PUT /:id`) is transactional—it wipes existing clips/keyframes for a track and re-inserts them to ensure data consistency.
*   `assets.js`: Handle uploads (`POST /assets`), serving media (`GET /assets/:id/stream`), and thumbnails.
*   `exports.js`: Triggers export jobs and polls status.

---

## 4. Key Workflows

### A. Asset Ingestion
1.  **Frontend**: User selects file -> `api.uploadAsset`.
2.  **Backend**: `multer` saves temp file.
3.  **IngestService**: Probes file, generates thumb, moves to final `storage/uploads` path.
4.  **DB**: Record created.
5.  **Frontend**: Store updates, asset appears in library.

### B. Timeline Editing
1.  **Interaction**: User drags asset to timeline.
2.  **State**: `Zustand` store updates `currentProject.tracks`.
3.  **Rendering**: `renderTimeline()` draws clips on the canvas/DOM.
4.  **Saving**: Explicit save (Ctrl+S or Button) sends full project state to `PUT /api/projects/:id`.
    *   *Design Choice*: We do not save on every drag-drop to reduce IO, but we do optimistic UI updates.

### C. Playback Engine (`frontend/src/engine/timeEngine.js`)
*   Not using a dedicated backend stream for preview.
*   **Mechanism**:
    *   Frontend matches `currentTime` to the active clip on the timeline.
    *   It swaps the `src` of a single `<video>` element (the "Preview Player") to the underlying asset.
    *   It seeks the video to `(currentTime - clipStartTime) * speed + clipInPoint`.
    *   For speed ramps, it approximates playback rate or skips frames visually (complex authentic preview is hard in browser without re-encoding, so we prioritize frame accuracy over smooth variable-speed playback in preview).

### D. Export Flow (Asynchronous)
1.  **Trigger**: `POST /api/projects/:id/export`.
2.  **Queueing**:
    *   Record inserted into `export_jobs` table with status `QUEUED`.
    *   **NO External MQ**: We do not use RabbitMQ/Redis.
    *   **Worker**: The backend triggers an *in-process asynchronous function* (`processExportJob`) immediately after response.
    *   *Reasoning*: Simpler deployment (no extra services needed). Uses SQLite as the persistent state source.
3.  **Processing**:
    *   `exportService` runs FFmpeg commands.
    *   Updates `export_jobs.progress` in real-time.
    *   On completion, updates status to `COMPLETE` and sets `output_path`.
4.  **Polling**: Frontend polls `GET /exports/:id` every few seconds to show a progress bar.
5.  **Download**: User clicks download -> `res.download`.

---

## 5. Directory Structure Mapping

```
/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── server.js        # Entry
│   │   ├── db.js            # SQLite connection
│   │   ├── routes/          # API Controllers
│   │   └── services/        # Business Logic (Video Processing)
│   └── storage/             # (Mounted Volume)
├── frontend/
│   ├── Dockerfile
│   ├── vite.config.js
│   └── src/
│       ├── main.js          # App entry & logic
│       ├── store.js         # Zustand State
│       ├── api.js           # Fetch wrappers
│       ├── engine/          # Timeline math
│       └── styles/          # CSS
```

## 6. Deep Dive: Technical Implementation

### 6.1. State Management (Zustand)
The entire application state is held in a single Zustand store (`store.js`). This monolithic state approach simplifies undo/redo logic (though not yet fully implemented) and ensures a single source of truth for the complex timeline.

*   **Key State Slices**:
    *   `currentProject`: The full JSON object returned by `GET /projects/:id`. Contains `tracks`, `clips`, `assets`, `keyframes`.
    *   `currentTime`: Float (seconds). The global playhead position.
    *   `zoom`: Integer (pixels per second). Governs the `renderTimeline` scaling factor.
    *   `selectedClipId`: ID of the currently active clip for the "Properties Panel".
*   **Reactivity**: Components subscribe to specific slices. For example, `main.js` subscribes to `state.currentTime` to update the playhead DOM element and trigger the `updatePreview()` call, but minimizing re-renders of the heavy timeline DOM.

### 6.2. The Playback Engine (`video` Element Sync)
Browsers cannot natively play a "timeline" of multiple video files with gaps/overlaps/effects in real-time without using heavy technologies like WebCodecs or WebASM. TryTakeTwo uses a lightweight **"Swap-and-Seek"** approach for preview.

**Mechanism (`timeEngine.js` + `main.js`):**
1.  **Loop**: A `requestAnimationFrame` loop runs when `playing === true`.
2.  **Evaluation**: On every frame, `evaluateTimeline(currentTime)` runs.
    *   It iterates through all tracks.
    *   Checks if `currentTime` falls within `[clip.start_time, clip.start_time + clip.duration]`.
    *   Calculates `clipLocalTime = currentTime - clip.start_time`.
    *   **Time Remapping**: If Speed Keyframes exist, it calculates `sourceTime` by integrating the speed curve. `sourceTime = clip.in_point + Integral(speed(t) dt)`.
3.  **Rendering**:
    *   **Video**: The DOM has fixed `<video>` elements (one per track type). The engine sets `.src = /api/assets/:id/stream` and `.currentTime = sourceTime`.
    *   **Optimization**: To avoid buffering stutter on every cut, we ideally cache active video elements (though the current implementation is a simplified single-element swap for reliability).
    *   **Overlays**: `overlayKeyframes` are interpolated (Linear easing) to generate CSS `transform` strings (`translate`, `scale`, `rotate`) applied to div overlays on top of the video player.

### 6.3. Variable Speed Implementation (The "Integral" Problem)
Speed ramping is non-trivial because `Time = Distance / Speed` doesn't apply when Speed varies over Time.
*   **Formula**: The source time pointer at timeline time $T$ is $S(T) = \int_{0}^{T} speed(t) dt$.
*   **Approximation**: The backend (`exportService.js`) and frontend (`timeEngine.js`) both implement a **Riemann Sum** approximation to calculate this integral.
    *   The timeline is sliced into small steps (e.g., 0.5s).
    *   Average speed is calculated for each step.
    *   `SourceDelta = TimeDelta * AvgSpeed`.
    *   This ensures that even with complex curves, the source video stays synchronized.

### 6.4. The Export Pipeline (Detailed FFmpeg Flow)
The export process is a "render-and-stitch" pipeline designed for distinct clip manipulation. 

**Phase 1: Segment Flattening**
*   Each clip on the timeline is rendered into an intermediate file.
*   **Variable Speed**: If a clip has speed ramps, it is *further* subdivided into mini-segments (chunks) where speed is roughly constant.
    *   *Command*: `ffmpeg -ss <start> -t <dur> -i <source> -vf setpts=1/SPEED*PTS ... -af atempo=SPEED ...`
    *   **Critical Fix**: We use `.mov` containers with `pcm_s16le` (Uncompressed Audio). AAC audio frame padding would cause milliseconds of drift per segment, leading to seconds of desync after stitching 100+ segments. PCM is sample-accurate.

**Phase 2: Concatenation**
*   A `concat.txt` list is generated.
*   `ffmpeg -f concat -safe 0 -i list.txt -c copy output.mov`
*   This is a stream copy operation (extremely fast) because all segments were transcribed to the exact same format in Phase 1.

**Phase 3: Overlay Composition**
*   Text and Image overlays are applied to the flattened video.
*   **Complex Filter Graph**:
    *   Images: `overlay=x=expression:y=expression:enable=between(...)` using FFmpeg's expression evaluation engine for animation.
    *   Text: `drawtext` filter with similar expression-based animation for x/y/alpha.

**Phase 4: Audio Mixing**
*   Background music (`AUDIO` tracks) are mixed with the video's audio.
*   `amix=inputs=2:duration=first` ensures the background audio meshes with the dialogue.
*   Final encode to `H.264 (mp4)` and `AAC` happens here.

### 6.5. Database Schema Deep Dive
SQLite relationships enforce integrity via `FOREIGN KEY` constraints.

*   `projects (id)`
    *   `tracks (project_id, type)`
        *   `clips (track_id, asset_id)`
            *   `speed_keyframes (clip_id)`
            *   `overlay_keyframes (clip_id)`

**"Transactional Save"**: When the user saves, the backend **purges** the `clips` table for the project's tracks and re-inserts everything from the JSON payload. This "Overwrite" strategy avoids complex diffing logic for sync, effectively making the Frontend the "Source of Truth" for the timeline arrangement, and the Backend the "Source of Truth" for persistence and rendering.
