// ============================================================
// TryTakeTwo – Main Application (Zustand Refactor)
// ============================================================
import { api } from './api.js';
import { useStore } from './store.js';
import { evaluateTimeline, getSpeedAtTime } from './engine/timeEngine.js';

// ── DOM refs ───────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initProjectManager();
    initEditorControls();
    initRippleEffect();
    initStoreSubscriptions();
    initResizablePanels();
});

// ── Store Subscriptions ────────────────────────────────────
function initStoreSubscriptions() {
    let prevState = useStore.getState();

    // Render timeline on project/zoom/selection changes
    useStore.subscribe((state) => {
        const projectChanged = state.currentProject !== prevState.currentProject;
        const zoomChanged = state.zoom !== prevState.zoom;
        const selectionChanged = state.selectedClipId !== prevState.selectedClipId;
        const timeChanged = state.currentTime !== prevState.currentTime;
        const playingChanged = state.playing !== prevState.playing;
        const assetsChanged = state.currentProject?.assets !== prevState.currentProject?.assets;

        if (projectChanged || zoomChanged || selectionChanged) {
            renderTimeline();
        }

        if (selectionChanged || projectChanged) {
            renderProperties();
        }

        if (assetsChanged) {
            renderAssetList();
        }

        if (projectChanged) {
            if (state.currentProject) {
                $('#project-name').textContent = state.currentProject.name;
                $('#project-manager').classList.remove('active');
                $('#editor').classList.add('active');
            } else {
                $('#project-manager').classList.add('active');
                $('#editor').classList.remove('active');
            }
        }

        if (playingChanged) {
            if (state.playing) startPlaybackLoop();
            else stopPlaybackLoop();
        }

        if (timeChanged) {
            updatePlayhead();
            updateTimecode();
            updatePreview();
        }

        // Also refresh preview when clip properties change (mute, volume, etc)
        // but only if time didn't already trigger it
        if (projectChanged && !timeChanged) {
            updatePreview();
        }

        if (zoomChanged) {
            $('#zoom-level').textContent = Math.round(state.zoom) + '%';
        }

        prevState = state; // Update prevState for next run
    });
}

// ════════════════════════════════════════════════════════════
// RESIZABLE PANELS
// ════════════════════════════════════════════════════════════
function initResizablePanels() {
    const grid = document.querySelector('.workspace-grid');
    if (!grid) return;

    const root = document.documentElement;

    // Restore saved sizes or use defaults
    let leftW = parseInt(localStorage.getItem('ttt-left-width')) || parseInt(getComputedStyle(root).getPropertyValue('--pane-left-width'));
    let rightW = parseInt(localStorage.getItem('ttt-right-width')) || parseInt(getComputedStyle(root).getPropertyValue('--pane-right-width'));
    let tlH = parseInt(localStorage.getItem('ttt-timeline-height')) || parseInt(getComputedStyle(root).getPropertyValue('--timeline-height'));

    // Apply restored sizes
    root.style.setProperty('--pane-left-width', leftW + 'px');
    root.style.setProperty('--pane-right-width', rightW + 'px');
    root.style.setProperty('--timeline-height', tlH + 'px');

    // Create dividers
    const divLeft = document.createElement('div');
    divLeft.className = 'resize-divider resize-divider-v resize-divider-left';
    divLeft.title = 'Drag to resize media panel';

    const divRight = document.createElement('div');
    divRight.className = 'resize-divider resize-divider-v resize-divider-right';
    divRight.title = 'Drag to resize properties panel';

    const divBottom = document.createElement('div');
    divBottom.className = 'resize-divider resize-divider-h';
    divBottom.title = 'Drag to resize timeline';

    grid.appendChild(divLeft);
    grid.appendChild(divRight);
    grid.appendChild(divBottom);

    // Left divider – resizes left/media panel
    panelDrag(divLeft, {
        axis: 'x',
        onDrag(dx) {
            leftW = clamp(leftW + dx, 150, 500);
            root.style.setProperty('--pane-left-width', leftW + 'px');
        },
        onEnd() {
            localStorage.setItem('ttt-left-width', leftW);
        }
    });

    // Right divider – resizes right/properties panel
    panelDrag(divRight, {
        axis: 'x',
        onDrag(dx) {
            rightW = clamp(rightW - dx, 180, 500);
            root.style.setProperty('--pane-right-width', rightW + 'px');
        },
        onEnd() {
            localStorage.setItem('ttt-right-width', rightW);
        }
    });

    // Bottom divider – resizes timeline height
    panelDrag(divBottom, {
        axis: 'y',
        onDrag(_, dy) {
            tlH = clamp(tlH - dy, 120, 600);
            root.style.setProperty('--timeline-height', tlH + 'px');
        },
        onEnd() {
            localStorage.setItem('ttt-timeline-height', tlH);
        }
    });
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function panelDrag(el, { axis, onDrag, onEnd }) {
    el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        el.classList.add('active');
        document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';

        let lastX = e.clientX;
        let lastY = e.clientY;

        function onMove(ev) {
            const dx = ev.clientX - lastX;
            const dy = ev.clientY - lastY;
            lastX = ev.clientX;
            lastY = ev.clientY;
            onDrag(dx, dy);
        }

        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            el.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (onEnd) onEnd();
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ── Toast notifications ────────────────────────────────────
function toast(msg, type = 'info') {
    let container = $('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('removing');
        el.addEventListener('animationend', () => el.remove());
    }, 3500);
}

// ════════════════════════════════════════════════════════════
// THEME SYSTEM
// ════════════════════════════════════════════════════════════
function initTheme() {
    const saved = localStorage.getItem('ttt-theme') || 'dark';
    setTheme(saved, false);
    // Support all theme toggle classes
    document.querySelectorAll('.theme-toggle, .theme-toggle-mini, .theme-toggle-simple, .nav-item[title="Toggle theme"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            setTheme(current === 'dark' ? 'light' : 'dark', true);
        });
    });
}

function setTheme(theme, animate = true) {
    if (animate) {
        document.documentElement.classList.add('theme-transitioning');
        setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 550);
    }
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ttt-theme', theme);
    const icon = theme === 'dark' ? '\uD83C\uDF19' : '☀️';
    document.querySelectorAll('.theme-toggle-thumb').forEach(el => el.textContent = icon);
}

// ════════════════════════════════════════════════════════════
// PROJECT MANAGER
// ════════════════════════════════════════════════════════════
function initProjectManager() {
    // Open New Project Modal
    $('#btn-new-project').addEventListener('click', () => {
        $('#new-project-modal').classList.remove('hidden');
        $('#global-backdrop').classList.remove('hidden');
        $('#input-project-name').focus();
    });

    // Close Modals
    const closeModals = () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
        $('#global-backdrop').classList.add('hidden');
    };

    $('#btn-new-project-close').addEventListener('click', closeModals);
    $('#global-backdrop').addEventListener('click', closeModals);

    // Confirm Create
    $('#btn-create-project-confirm').addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        const input = $('#input-project-name');
        const name = input.value.trim() || `Project ${new Date().toLocaleTimeString()}`;

        try {
            btn.disabled = true;
            btn.textContent = 'Creating...';

            const project = await api.createProject(name);
            toast('Project created', 'success');

            input.value = '';
            closeModals();

            // Re-render project list in background
            await loadProjectList();

            // Open the new project
            await openProject(project.id);
        } catch (err) {
            toast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Project';
        }
    });

    loadProjectList();
}

async function loadProjectList() {
    try {
        const projects = await api.listProjects();
        const list = $('#project-list');
        list.innerHTML = '';

        if (projects.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'pm-divider';
            divider.innerHTML = '<span>Recent Projects</span>';
            list.appendChild(divider);
        }

        for (const p of projects) {
            const card = document.createElement('div');
            card.className = 'project-card';
            card.innerHTML = `
        <div class="card-info">
          <div class="card-name">${escHtml(p.name)}</div>
          <div class="card-date">${new Date(p.created_at).toLocaleDateString()}</div>
        </div>
        <button class="project-delete" title="Delete Project">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      `;
            card.addEventListener('click', (e) => {
                if (e.target.closest('.project-delete')) {
                    deleteProject(p.id);
                    return;
                }
                openProject(p.id);
            });
            list.appendChild(card);
        }
    } catch (err) {
        console.warn('Could not load projects:', err.message);
    }
}

async function deleteProject(id) {
    if (!confirm('Delete this project?')) return;
    try {
        await api.deleteProject(id);
        toast('Project deleted', 'success');
        loadProjectList();
    } catch (err) {
        toast('Delete failed: ' + err.message, 'error');
    }
}

async function openProject(id) {
    try {
        const project = await api.getProject(id);
        // Reset state via store
        useStore.getState().setProject(project);
        useStore.getState().selectClip(null);
        useStore.getState().setTime(0);
        useStore.getState().setPlaying(false);
        toast(`Opened "${project.name}"`, 'info');
    } catch (err) {
        toast('Failed to open project: ' + err.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════
// EDITOR CONTROLS
// ════════════════════════════════════════════════════════════
function initEditorControls() {
    $('#btn-back').addEventListener('click', () => {
        useStore.getState().setPlaying(false);
        useStore.getState().setProject(null); // Triggers switch to PM
        loadProjectList();
    });

    $('#btn-play').addEventListener('click', togglePlayback);
    $('#btn-skip-start').addEventListener('click', () => { seekTo(0); });
    $('#btn-skip-end').addEventListener('click', () => { seekTo(getTimelineDuration()); });

    $('#btn-split').addEventListener('click', splitAtPlayhead);
    $('#btn-delete-clip').addEventListener('click', deleteSelectedClip);

    // ── Sidebar Nav switching ────────────────────────────
    const navMap = {
        'Your media': 'panel-media',
        'Content library': 'panel-library',
        'Text overlays': 'panel-media',   // Text adds overlay, stays on media
        'Transitions': 'panel-transitions',
    };

    document.querySelectorAll('.nav-top .nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const title = btn.getAttribute('title');
            const panelId = navMap[title];
            if (!panelId) return; // Record/other not mapped yet

            // Activate nav item
            document.querySelectorAll('.nav-top .nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Switch panel view
            document.querySelectorAll('.pane-left .panel-view').forEach(p => p.classList.remove('active'));
            const target = document.getElementById(panelId);
            if (target) target.classList.add('active');

            // Text button: also add a text overlay
            if (title === 'Text overlays') {
                const { currentProject } = useStore.getState();
                if (!currentProject) { toast('Open a project first', 'error'); return; }
                const textTrack = currentProject.tracks.find(t => t.type === 'OVERLAY_TEXT');
                if (textTrack) {
                    addTextOverlayToTrack(textTrack);
                    toast('Text overlay added', 'success');
                } else {
                    toast('No text overlay track available', 'error');
                }
            }
        });
    });

    // ── Library: Backgrounds ────────────────────────────
    document.querySelectorAll('.library-item[data-bg-type]').forEach(item => {
        item.addEventListener('click', () => {
            const { currentProject } = useStore.getState();
            if (!currentProject) { toast('Open a project first', 'error'); return; }

            const bgType = item.dataset.bgType;
            const bgValue = item.dataset.bgValue;
            const textTrack = currentProject.tracks.find(t => t.type === 'OVERLAY_TEXT');
            if (!textTrack) { toast('No overlay track available', 'error'); return; }

            const { currentTime } = useStore.getState();
            const newClips = [...(textTrack.clips || []), {
                id: generateId(),
                track_id: textTrack.id,
                asset_id: null,
                type: 'text',
                start_time: currentTime,
                duration: 5,
                in_point: 0,
                out_point: 5,
                properties: {
                    text: '',
                    fontSize: 1,
                    color: 'transparent',
                    backgroundColor: bgValue,
                    bgType: bgType,
                },
                overlayKeyframes: [
                    { id: generateId(), time: 0, x: 0, y: 0, scale_x: 1, scale_y: 1, rotation: 0, opacity: 1, easing: 'linear' }
                ],
            }];
            useStore.getState().updateTrackClips(textTrack.id, newClips);
            useStore.getState().selectClip(newClips[newClips.length - 1].id);
            toast(`${bgType === 'gradient' ? 'Gradient' : 'Solid'} background added`, 'success');
        });
    });

    // ── Library: Text Templates ─────────────────────────
    const textPresets = {
        'title': { text: 'Title Text', fontSize: 72, color: '#ffffff' },
        'subtitle': { text: 'Subtitle', fontSize: 36, color: '#cccccc' },
        'lower-third': { text: 'Name Here', fontSize: 28, color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.6)' },
        'caption': { text: 'Caption text...', fontSize: 24, color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.75)' },
    };

    document.querySelectorAll('.library-item[data-text-preset]').forEach(item => {
        item.addEventListener('click', () => {
            const { currentProject } = useStore.getState();
            if (!currentProject) { toast('Open a project first', 'error'); return; }

            const preset = textPresets[item.dataset.textPreset];
            if (!preset) return;
            const textTrack = currentProject.tracks.find(t => t.type === 'OVERLAY_TEXT');
            if (!textTrack) { toast('No text overlay track available', 'error'); return; }

            const { currentTime } = useStore.getState();
            const newClips = [...(textTrack.clips || []), {
                id: generateId(),
                track_id: textTrack.id,
                asset_id: null,
                type: 'text',
                start_time: currentTime,
                duration: 4,
                in_point: 0,
                out_point: 4,
                properties: { ...preset },
                overlayKeyframes: [
                    { id: generateId(), time: 0, x: 100, y: 300, scale_x: 1, scale_y: 1, rotation: 0, opacity: 1, easing: 'linear' }
                ],
            }];
            useStore.getState().updateTrackClips(textTrack.id, newClips);
            useStore.getState().selectClip(newClips[newClips.length - 1].id);
            toast(`${item.dataset.textPreset} template added`, 'success');
        });
    });

    // ── Transitions ─────────────────────────────────────
    document.querySelectorAll('.transition-item').forEach(item => {
        item.addEventListener('click', () => {
            const { selectedClipId, currentProject } = useStore.getState();
            if (!currentProject) { toast('Open a project first', 'error'); return; }
            if (!selectedClipId) { toast('Select a clip first', 'error'); return; }

            const transType = item.dataset.transition;
            const { clip } = findClipAndTrack(selectedClipId);
            if (!clip) return;

            // Store transition info on the clip
            const props = clip.properties || {};
            useStore.getState().updateClip(clip.id, {
                properties: {
                    ...props,
                    transition: transType,
                    transitionDuration: props.transitionDuration || 0.5,
                }
            });

            // Visual feedback
            document.querySelectorAll('.transition-item').forEach(t => t.classList.remove('selected'));
            item.classList.add('selected');
            toast(`${transType === 'none' ? 'Transition removed' : `"${transType}" transition applied`}`, 'success');
            renderTimeline();
        });
    });

    const zoom = () => useStore.getState().zoom;
    $('#btn-zoom-in').addEventListener('click', () => useStore.getState().setZoom(zoom() * 1.5));
    $('#btn-zoom-out').addEventListener('click', () => useStore.getState().setZoom(zoom() / 1.5));

    $('#file-upload').addEventListener('change', handleFileUpload);
    $('#btn-save').addEventListener('click', saveProject);

    $('#btn-export').addEventListener('click', () => $('#export-modal').classList.remove('hidden'));
    $('#btn-export-close').addEventListener('click', () => $('#export-modal').classList.add('hidden'));
    $('#btn-export-start').addEventListener('click', startExport);
    $('.modal-backdrop').addEventListener('click', () => $('#export-modal').classList.add('hidden'));

    $('#timeline-ruler').addEventListener('mousedown', onRulerMouseDown);

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
        if (e.code === 'Delete' || e.code === 'Backspace') deleteSelectedClip();
        if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveProject(); }
    });
}

function initRippleEffect() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn, .btn-icon, .transport-btn, .mini-btn, .tool-btn, .nav-item, .project-card');
        if (!btn) return;
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        const rect = btn.getBoundingClientRect();
        ripple.style.left = (e.clientX - rect.left) + 'px';
        ripple.style.top = (e.clientY - rect.top) + 'px';
        btn.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove());
    });
}

// ── Client-side Thumbnail Generation ───────────────────────
function generateClientThumbnail(source) {
    const isFile = source instanceof File;
    if (isFile && !source.type.startsWith('video/')) return Promise.resolve(null);

    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.style.position = 'fixed';
        video.style.top = '-10000px';
        video.style.opacity = '0';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous'; // Important for external/stream URLs

        const url = isFile ? URL.createObjectURL(source) : source;
        video.src = url;
        document.body.appendChild(video);

        const cleanup = () => {
            if (isFile) URL.revokeObjectURL(url);
            if (video.parentNode) video.parentNode.removeChild(video);
        };

        const timeout = setTimeout(() => {
            cleanup();
            resolve(null);
        }, 12000);

        video.onloadeddata = () => {
            const seek = (isFinite(video.duration) && video.duration > 0) ? video.duration * 0.5 : 0.5;
            video.currentTime = seek;
        };

        video.onseeked = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 320;
                canvas.height = 180;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(blob => {
                    clearTimeout(timeout);
                    cleanup();
                    resolve(blob);
                }, 'image/jpeg', 0.8);
            } catch (err) {
                cleanup();
                resolve(null);
            }
        };

        video.onerror = () => {
            clearTimeout(timeout);
            cleanup();
            resolve(null);
        };
    });
}

// ── File Upload ────────────────────────────────────────────
async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    const { currentProject } = useStore.getState();
    if (!files.length || !currentProject) return;

    for (const file of files) {
        try {
            toast(`Processing ${file.name}...`, 'info');
            const thumbBlob = await generateClientThumbnail(file);

            if (file.type.startsWith('video/') && !thumbBlob) {
                toast('Could not generate thumbnail preview (using fallback)', 'warning');
            }

            toast(`Uploading ${file.name}...`, 'info');
            // If thumb generation failed, pass null
            const asset = await api.uploadAsset(currentProject.id, file, thumbBlob);

            useStore.getState().addAsset(asset); // Update store
            toast(`Imported ${file.name}`, 'success');
        } catch (err) {
            toast(`Upload failed: ${err.message}`, 'error');
        }
    }
    e.target.value = '';
}

async function deleteAsset(id) {
    if (!confirm('Permanently delete this asset?')) return;
    try {
        await api.deleteAsset(id);
        // Also remove from store
        useStore.getState().removeAsset(id);
        toast('Asset deleted', 'success');
    } catch (err) {
        toast(`Delete failed: ${err.message}`, 'error');
    }
}

// ════════════════════════════════════════════════════════════
// ASSET LIST
// ════════════════════════════════════════════════════════════
function renderAssetList() {
    const list = $('#asset-list');
    list.innerHTML = '';
    const { currentProject } = useStore.getState();
    if (!currentProject) return;

    for (const asset of currentProject.assets || []) {
        const item = document.createElement('div');
        item.className = 'asset-item';
        item.draggable = true;
        item.dataset.assetId = asset.id;
        item.dataset.type = asset.type;

        // Thumbnail Logic
        let thumbUrl = asset.thumbnail_path ? api.getThumbnailUrl(asset.id) : null;

        // Use original image as thumb if no thumb generated
        if (!thumbUrl && asset.type.startsWith('image')) {
            thumbUrl = api.getStreamUrl(asset.id);
        }

        const icon = asset.type.startsWith('audio') ? '🎵' : (asset.type.startsWith('image') ? '🖼️' : '🎬');

        let thumbHTML = `<div class="asset-thumb-placeholder">${icon}</div>`;
        if (thumbUrl) {
            // Show image, hide on error
            thumbHTML = `
                <div class="asset-thumb-wrapper">
                    <img class="asset-thumb-img" src="${thumbUrl}" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />
                    <div class="asset-thumb-fallback" style="display:none">${icon}</div>
                </div>
            `;
        } else {
            thumbHTML = `<div class="asset-thumb-wrapper">
                            <img class="asset-thumb-img" style="display:none" src="" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />
                            <div class="asset-thumb-fallback">${icon}</div>
                         </div>`;
        }

        const dur = asset.duration ? formatTime(asset.duration) : '';

        item.innerHTML = `
            ${thumbHTML}
            <button class="asset-del-btn" title="Remove asset">×</button>
            <div class="asset-info">
                <div class="asset-name" title="${escHtml(asset.original_name)}">${escHtml(asset.original_name)}</div>
                <div class="asset-meta">
                    <span>${asset.type === 'video' ? dur : (asset.type === 'audio' ? dur : '')}</span>
                    <span class="asset-type-badge">${asset.type.toUpperCase()}</span>
                </div>
            </div>
        `;

        // ── AUTO HEAL ───────────────────────────────────────
        // If missing video thumbnail, generate it from the stream URL
        if (!thumbUrl && asset.type === 'video') {
            generateClientThumbnail(api.getStreamUrl(asset.id)).then(blob => {
                if (blob && document.body.contains(item)) {
                    const localUrl = URL.createObjectURL(blob);
                    const img = item.querySelector('.asset-thumb-img');
                    if (img) {
                        img.src = localUrl;
                        img.style.display = 'block';
                        const fallback = item.querySelector('.asset-thumb-fallback');
                        if (fallback) fallback.style.display = 'none';
                    }
                    // Persist to server so it's fixed permanently
                    api.setAssetThumbnail(asset.id, blob).catch(() => { });
                }
            });
        }
        // ──────────────────────────────────────────────────────

        item.querySelector('.asset-del-btn').onclick = (e) => {
            e.stopPropagation();
            deleteAsset(asset.id);
        };

        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/asset-id', asset.id);
            e.dataTransfer.setData('application/asset-type', asset.type);
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));
        list.appendChild(item);
    }
}

// ════════════════════════════════════════════════════════════
// TIMELINE
// ════════════════════════════════════════════════════════════
function getTimelineDuration() {
    const { currentProject } = useStore.getState();
    let maxTime = 10;
    if (currentProject) {
        for (const track of currentProject.tracks || []) {
            for (const clip of track.clips || []) {
                const end = clip.start_time + clip.duration;
                if (end > maxTime) maxTime = end;
            }
        }
    }
    return maxTime + 5;
}

function renderTimeline() {
    const { currentProject, zoom, selectedClipId } = useStore.getState();
    if (!currentProject) return;
    const totalDur = getTimelineDuration();

    // Ruler
    const ruler = $('#timeline-ruler');
    ruler.innerHTML = '';
    ruler.style.width = (totalDur * zoom + 100) + 'px';
    const step = zoom >= 100 ? 1 : zoom >= 40 ? 2 : 5;
    for (let t = 0; t <= totalDur; t += step) {
        const x = 100 + t * zoom;
        const tick = document.createElement('div');
        tick.className = 'ruler-tick major';
        tick.style.left = x + 'px';
        ruler.appendChild(tick);

        const label = document.createElement('div');
        label.className = 'ruler-label';
        label.style.left = x + 'px';
        label.textContent = formatTimeShort(t);
        ruler.appendChild(label);

        if (step === 1 && zoom >= 80) {
            for (let sub = 1; sub < 4; sub++) {
                const subT = t + sub * 0.25;
                if (subT > totalDur) break;
                const subTick = document.createElement('div');
                subTick.className = 'ruler-tick';
                subTick.style.left = (100 + subT * zoom) + 'px';
                ruler.appendChild(subTick);
            }
        }
    }

    // Tracks
    const container = $('#timeline-tracks');
    container.innerHTML = '';
    container.style.width = (totalDur * zoom + 100) + 'px';

    const trackLabels = { VIDEO_A: 'Video A', VIDEO_B: 'Video B', OVERLAY_TEXT: 'Text', OVERLAY_IMAGE: 'Image', AUDIO: 'Audio' };
    const trackClasses = { VIDEO_A: 'clip-video-a', VIDEO_B: 'clip-video-b', OVERLAY_TEXT: 'clip-text', OVERLAY_IMAGE: 'clip-image', AUDIO: 'clip-audio' };

    for (const track of currentProject.tracks || []) {
        const trackEl = document.createElement('div');
        trackEl.className = 'timeline-track';
        trackEl.innerHTML = `<div class="track-label">${trackLabels[track.type] || track.type}</div>`;

        const content = document.createElement('div');
        content.className = 'track-content';

        // Dnd
        content.addEventListener('dragover', (e) => { e.preventDefault(); content.classList.add('drop-target'); });
        content.addEventListener('dragleave', () => content.classList.remove('drop-target'));
        content.addEventListener('drop', (e) => {
            e.preventDefault();
            content.classList.remove('drop-target');
            const assetId = e.dataTransfer.getData('application/asset-id');
            const assetType = e.dataTransfer.getData('application/asset-type');
            if (!assetId) return;
            const rect = content.getBoundingClientRect();
            const dropTime = Math.max(0, (e.clientX - rect.left) / zoom);
            addClipToTrack(track, assetId, assetType, dropTime);
        });

        // Clips
        for (const clip of track.clips || []) {
            const clipEl = document.createElement('div');
            clipEl.className = `timeline-clip ${trackClasses[track.type] || 'clip-video-a'}`;
            if (clip.id === selectedClipId) clipEl.classList.add('selected');

            const left = clip.start_time * zoom;
            const width = Math.max(20, clip.duration * zoom);
            clipEl.style.left = left + 'px';
            clipEl.style.width = width + 'px';
            clipEl.dataset.clipId = clip.id;

            clipEl.innerHTML = `
                <div class="trim-handle trim-handle-left"></div>
                <span class="clip-label">${escHtml(getClipLabel(clip, track.type))}</span>
                <div class="trim-handle trim-handle-right"></div>
            `;

            // Speed markers
            if (clip.speedKeyframes?.length > 0 && clip.id === selectedClipId) {
                for (const kf of clip.speedKeyframes) {
                    const marker = document.createElement('div');
                    marker.className = 'speed-kf-marker';
                    marker.style.left = (kf.time / clip.duration * 100) + '%';
                    clipEl.appendChild(marker);
                }
            }

            clipEl.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('trim-handle-left') || e.target.classList.contains('trim-handle-right')) {
                    startTrim(e, clip, track, e.target.classList.contains('trim-handle-left') ? 'left' : 'right', zoom);
                    return;
                }
                useStore.getState().selectClip(clip.id);
                startDragClip(e, clip, track, zoom);
            });

            content.appendChild(clipEl);
        }
        trackEl.appendChild(content);
        container.appendChild(trackEl);
    }
    updatePlayhead();
}

function getClipLabel(clip, trackType) {
    if (trackType === 'OVERLAY_TEXT') {
        const props = typeof clip.properties === 'string' ? JSON.parse(clip.properties) : (clip.properties || {});
        return props.text || 'Text';
    }
    const { currentProject } = useStore.getState();
    const asset = currentProject?.assets?.find(a => a.id === clip.asset_id);
    return asset ? asset.original_name : 'Clip';
}

async function addClipToTrack(track, assetId, assetType, startTime) {
    const { currentProject } = useStore.getState();
    const asset = currentProject.assets.find(a => a.id === assetId);
    if (!asset) return;

    // Type validation
    const assetTypeLower = assetType.toLowerCase();

    const isValid = (track.type.startsWith('VIDEO') && assetTypeLower === 'video') ||
        (track.type === 'OVERLAY_IMAGE' && assetTypeLower === 'image') ||
        (track.type === 'AUDIO' && assetTypeLower === 'audio');

    if (!isValid) {
        toast(`Cannot place ${assetTypeLower} on ${track.type} track`, 'error');
        return;
    }

    startTime = snapTime(startTime, track);

    // Get clip duration: use asset's probed duration, or detect from media element
    let duration = asset.duration;
    if (!duration && (assetTypeLower === 'video' || assetTypeLower === 'audio')) {
        try {
            duration = await getMediaDuration(assetId);
        } catch (e) {
            console.warn('Could not detect media duration:', e);
        }
    }
    // Final fallback: 5s for images, or if all detection failed
    if (!duration || duration <= 0) {
        duration = assetTypeLower === 'image' ? 5 : 10;
    }

    // Preserved properties from asset or defaults
    const properties = {
        originalName: asset.original_name,
        width: asset.width,
        height: asset.height,
        codec: asset.codec,
        muted: (assetTypeLower === 'video' || assetTypeLower === 'audio') ? true : false,
    };

    const newClips = [...(track.clips || []), {
        id: generateId(),
        track_id: track.id,
        asset_id: assetId,
        type: assetTypeLower,
        start_time: startTime,
        duration: duration,
        in_point: 0,
        out_point: duration,
        properties: properties,
        speedKeyframes: assetTypeLower === 'video' ? [{ id: generateId(), time: 0, speed: 1 }] : [],
        overlayKeyframes: assetTypeLower === 'image' ? [
            { id: generateId(), time: 0, x: 0, y: 0, scale_x: 1, scale_y: 1, rotation: 0, opacity: 1, easing: 'linear' }
        ] : [],
    }];

    useStore.getState().updateTrackClips(track.id, newClips);
    toast('Clip added', 'success');
}

/**
 * Load a media file via HTML5 element to detect its real duration.
 * Used as a fallback when the backend ffprobe didn't return a duration.
 */
function getMediaDuration(assetId) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('video');
        el.preload = 'metadata';
        el.src = api.getStreamUrl(assetId);
        el.addEventListener('loadedmetadata', () => {
            const dur = el.duration;
            el.src = ''; // release
            if (isFinite(dur) && dur > 0) resolve(dur);
            else reject(new Error('Invalid duration'));
        });
        el.addEventListener('error', () => reject(new Error('Media load error')));
        // Timeout after 10s
        setTimeout(() => reject(new Error('Duration detection timeout')), 10000);
    });
}

function addTextOverlayToTrack(track) {
    const { currentTime } = useStore.getState();
    const newClips = [...(track.clips || []), {
        id: generateId(),
        track_id: track.id,
        asset_id: null,
        type: 'text',
        start_time: currentTime,
        duration: 3,
        in_point: 0,
        out_point: 3,
        properties: { text: 'New Text', fontSize: 48, color: '#ffffff' },
        overlayKeyframes: [
            { id: generateId(), time: 0, x: 100, y: 100, scale_x: 1, scale_y: 1, rotation: 0, opacity: 1, easing: 'linear' }
        ],
    }];
    useStore.getState().updateTrackClips(track.id, newClips);
    // Auto select last clip
    useStore.getState().selectClip(newClips[newClips.length - 1].id);
}

// ── Operations ─────────────────────────────────────────────
function startDragClip(e, clip, track, zoom) {
    const startX = e.clientX;
    const origStart = clip.start_time;
    let moved = false;

    function onMove(ev) {
        const dx = ev.clientX - startX;
        if (Math.abs(dx) > 3) moved = true;
        const dt = dx / zoom;
        const newStart = Math.max(0, snapTime(origStart + dt, track, clip.id));
        // Optimistic update
        clip.start_time = newStart;
        renderTimeline();
    }

    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
            // Commit to store
            useStore.getState().updateClip(clip.id, { start_time: clip.start_time });
        }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function startTrim(e, clip, track, side, zoom) {
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = clip.start_time;
    const origDur = clip.duration;
    const origIn = clip.in_point;
    const origOut = clip.out_point;

    function onMove(ev) {
        const dt = (ev.clientX - startX) / zoom;
        if (side === 'left') {
            const newStart = Math.max(0, origStart + dt);
            const delta = newStart - origStart;
            clip.start_time = newStart;
            clip.duration = Math.max(0.1, origDur - delta);
            clip.in_point = origIn + delta;
        } else {
            clip.duration = Math.max(0.1, origDur + dt);
            clip.out_point = origOut + dt;
        }
        renderTimeline();
    }

    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Commit
        useStore.getState().updateClip(clip.id, {
            start_time: clip.start_time, duration: clip.duration,
            in_point: clip.in_point, out_point: clip.out_point
        });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function splitAtPlayhead() {
    const { currentProject, currentTime } = useStore.getState();
    if (!currentProject) return;

    for (const track of currentProject.tracks) {
        const clipIdx = (track.clips || []).findIndex(c => currentTime > c.start_time && currentTime < c.start_time + c.duration);
        if (clipIdx !== -1) {
            const clip = track.clips[clipIdx];
            const localT = currentTime - clip.start_time;

            const clip1 = { ...clip, duration: localT, out_point: clip.in_point + localT };
            if (clip1.speedKeyframes) clip1.speedKeyframes = clip.speedKeyframes.filter(k => k.time <= localT);

            const clip2 = {
                ...JSON.parse(JSON.stringify(clip)),
                id: generateId(),
                start_time: currentTime,
                duration: clip.duration - localT,
                in_point: clip.in_point + localT
            };
            if (clip2.speedKeyframes) {
                clip2.speedKeyframes = clip.speedKeyframes
                    .filter(k => k.time >= localT)
                    .map(k => ({ ...k, id: generateId(), time: k.time - localT }));
            }

            const newClips = [...track.clips];
            newClips.splice(clipIdx, 1, clip1, clip2);
            useStore.getState().updateTrackClips(track.id, newClips);
            useStore.getState().selectClip(clip1.id);
            toast('Clip split', 'success');
            return;
        }
    }
}

function deleteSelectedClip() {
    const { currentProject, selectedClipId } = useStore.getState();
    if (!selectedClipId || !currentProject) return;

    for (const track of currentProject.tracks) {
        if (track.clips.some(c => c.id === selectedClipId)) {
            const newClips = track.clips.filter(c => c.id !== selectedClipId);
            useStore.getState().updateTrackClips(track.id, newClips);
            useStore.getState().selectClip(null);
            toast('Clip deleted', 'success');
            return;
        }
    }
}

function snapTime(time, track, excludeId) {
    const { currentTime, currentProject } = useStore.getState();
    const SNAP = 0.15;
    if (Math.abs(time - currentTime) < SNAP) return currentTime;

    for (const t of currentProject.tracks || []) {
        for (const c of t.clips || []) {
            if (c.id === excludeId) continue;
            if (Math.abs(time - c.start_time) < SNAP) return c.start_time;
            if (Math.abs(time - (c.start_time + c.duration)) < SNAP) return c.start_time + c.duration;
        }
    }
    return Math.max(0, time);
}

// ── Playback ───────────────────────────────────────────────
function togglePlayback() {
    const { playing } = useStore.getState();
    useStore.getState().setPlaying(!playing);
}

function startPlaybackLoop() {
    $('#btn-play').textContent = '⏸';
    let last = performance.now();

    function tick(now) {
        if (!useStore.getState().playing) return;
        const delta = (now - last) / 1000;
        last = now;

        const { currentProject, currentTime } = useStore.getState();

        // Calculate speed
        let playbackSpeed = 1;
        const eval_ = evaluateTimeline(currentProject, currentTime);
        const activeClip = eval_.videoB || eval_.videoA;
        if (activeClip) {
            const clip = findClip(activeClip.clipId);
            if (clip?.speedKeyframes?.length) {
                playbackSpeed = getSpeedAtTime(currentTime - clip.start_time, clip.speedKeyframes);
                if (playbackSpeed < 0.01) playbackSpeed = 0;
            }
        }

        const nextTime = currentTime + delta * Math.max(0, playbackSpeed);
        if (nextTime >= getTimelineDuration() - 5) {
            useStore.getState().setPlaying(false);
            return;
        }

        useStore.getState().setTime(nextTime);
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

function stopPlaybackLoop() {
    $('#btn-play').textContent = '▶';
}

function seekTo(time) {
    useStore.getState().setTime(time);
}

function onRulerMouseDown(e) {
    const ruler = $('#timeline-ruler');
    const rect = ruler.getBoundingClientRect();
    const scrollLeft = $('#timeline-scroll').scrollLeft;
    function calc(ev) {
        return Math.max(0, (ev.clientX - rect.left + scrollLeft - 100) / useStore.getState().zoom);
    }
    seekTo(calc(e));

    function onMove(ev) { seekTo(calc(ev)); }
    function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function updatePlayhead() {
    const { currentTime, zoom } = useStore.getState();
    $('#timeline-playhead').style.left = (100 + currentTime * zoom) + 'px';
}
function updateTimecode() {
    const { currentTime } = useStore.getState();
    $('#timecode').textContent = formatTimeFull(currentTime);
}

// ── Preview (Pure Canvas) ──────────────────────────────────
function updatePreview() {
    const state = useStore.getState();
    const { currentProject, currentTime, videoElements, playing } = state;
    if (!currentProject) return;

    const evalResult = evaluateTimeline(currentProject, currentTime);

    // Canvas setup
    const canvas = $('#preview-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height); // Black background

    // Viewport calculation (16:9 Fit)
    const targetAspect = 16 / 9;
    const canvasAspect = canvas.width / canvas.height;
    let viewW, viewH, viewX, viewY;

    if (canvasAspect > targetAspect) {
        viewH = canvas.height;
        viewW = viewH * targetAspect;
        viewX = (canvas.width - viewW) / 2;
        viewY = 0;
    } else {
        viewW = canvas.width;
        viewH = viewW / targetAspect;
        viewX = 0;
        viewY = (canvas.height - viewH) / 2;
    }

    // Identify all active media elements for sync
    const activeMediaKeys = new Set();

    // Helper to draw a video layer
    const drawVideoLayer = (layer) => {
        if (!layer) return;
        const key = `vid_${layer.clipId}`; // Use clipId for unique instance control
        activeMediaKeys.add(key);

        let video = videoElements[key];
        if (!video) {
            video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.src = api.getStreamUrl(layer.assetId);
            video.style.display = 'none';
            video.preload = 'auto';
            document.body.appendChild(video);
            videoElements[key] = video;
            // Track mute state on the element itself for change detection
            video._lastMuted = undefined;
        }

        // Determine mute state
        const isMuted = !!layer.properties.muted;
        const muteStateChanged = video._lastMuted !== undefined && video._lastMuted !== isMuted;
        video._lastMuted = isMuted;

        // Apply mute + volume
        video.muted = isMuted;
        const rawVol = isMuted ? 0 : (layer.properties.volume ?? 1);
        video.volume = Math.min(1, Math.max(0, rawVol));

        if (playing) {
            // Check if we effectively reached the end of the source file
            const duration = (video.duration && video.duration > 0) ? video.duration : Infinity;

            if (layer.sourceTime >= duration - 0.05) {
                // HOLD LAST FRAME: Prevent default loop/restart behavior
                if (!video.paused) video.pause();
                if (Math.abs(video.currentTime - duration) > 0.1) {
                    video.currentTime = duration;
                }
            } else {
                // If mute state just changed while playing, force a pause-play cycle
                // to break the browser's audio pipeline and apply the new mute state
                if (muteStateChanged && !video.paused) {
                    video.pause();
                    video.muted = isMuted;
                    video.volume = Math.min(1, Math.max(0, rawVol));
                    video.play().catch(e => console.warn(`Re-play after mute change blocked:`, e));
                }

                // NORMAL PLAYBACK
                if (video.paused) {
                    video.muted = isMuted; // Ensure muted before play
                    video.play().catch(e => console.warn(`Play blocked for ${layer.assetId}:`, e));
                }

                // Sync playback rate to speed ramp
                const targetSpeed = Math.max(0.1, layer.speed || 1);
                if (Math.abs(video.playbackRate - targetSpeed) > 0.05) {
                    video.playbackRate = targetSpeed;
                }

                // Drift correction
                const drift = Math.abs(video.currentTime - layer.sourceTime);
                const tolerance = 0.3 + (0.1 * targetSpeed);

                if (drift > tolerance && video.readyState >= 3) {
                    video.currentTime = layer.sourceTime;
                }
            }
        } else {
            if (!video.paused) video.pause();
            if (Math.abs(video.currentTime - layer.sourceTime) > 0.1) {
                video.currentTime = layer.sourceTime;
            }
        }

        ctx.save();
        // Apply Transition Effects
        const { effect } = layer;
        if (effect && effect.type !== 'none') {
            if (effect.type === 'fade' || effect.type === 'crossfade' || effect.type === 'dissolve') {
                ctx.globalAlpha = effect.opacity;
            } else if (effect.type.startsWith('wipe')) {
                let progress = effect.phase === 'in' ? effect.progress : effect.opacity;
                ctx.beginPath();
                let clipX = viewX, clipY = viewY, clipW = viewW, clipH = viewH;
                if (effect.type === 'wipe-left') clipW = viewW * progress;
                else if (effect.type === 'wipe-right') { clipX = viewX + viewW * (1 - progress); clipW = viewW * progress; }
                else if (effect.type === 'wipe-up') { clipH = viewH * progress; clipY = viewY + viewH * (1 - progress); }
                else if (effect.type === 'wipe-down') clipH = viewH * progress;
                ctx.rect(clipX, clipY, clipW, clipH);
                ctx.clip();
            }
        }

        ctx.drawImage(video, viewX, viewY, viewW, viewH);
        ctx.restore();
    };

    // 1. Draw Video Layers
    if (evalResult.videoA) drawVideoLayer(evalResult.videoA);
    if (evalResult.videoB) drawVideoLayer(evalResult.videoB);

    // 2. Sync Audio-only track
    for (const audio of evalResult.audioClips) {
        const key = `vid_${audio.clipId}`;
        activeMediaKeys.add(key);

        let el = videoElements[key];
        if (!el) {
            el = document.createElement('video');
            el.crossOrigin = 'anonymous';
            el.src = api.getStreamUrl(audio.assetId);
            el.style.display = 'none';
            el.preload = 'auto';
            document.body.appendChild(el);
            videoElements[key] = el;
            el._lastMuted = undefined;
        }

        const audioIsMuted = !!audio.muted;
        const audioMuteChanged = el._lastMuted !== undefined && el._lastMuted !== audioIsMuted;
        el._lastMuted = audioIsMuted;

        el.muted = audioIsMuted;
        const rawVol = audioIsMuted ? 0 : (audio.volume ?? 1);
        el.volume = Math.min(1, Math.max(0, rawVol));

        if (playing) {
            // Force pause-play cycle on mute change to break audio pipeline
            if (audioMuteChanged && !el.paused) {
                el.pause();
                el.muted = audioIsMuted;
                el.volume = Math.min(1, Math.max(0, rawVol));
                el.play().catch(e => console.warn(`Audio re-play after mute change blocked:`, e));
            }
            if (el.paused) {
                el.muted = audioIsMuted;
                el.play().catch(e => console.warn(`Audio play blocked:`, e));
            }
            if (Math.abs(el.currentTime - audio.sourceTime) > 0.15) {
                el.currentTime = audio.sourceTime;
            }
        } else {
            if (!el.paused) el.pause();
            el.currentTime = audio.sourceTime;
        }
    }

    // 3. Pause Inactive Media
    for (const key in videoElements) {
        if (key.startsWith('vid_') && !activeMediaKeys.has(key)) {
            const el = videoElements[key];
            if (!el.paused) el.pause();
        }
    }

    // 4. Draw Overlays (Text/Image)
    const scaleX = viewW / 1280;
    const scaleY = viewH / 720;

    for (const textOverlay of evalResult.overlayTexts) {
        const { properties: props, transform } = textOverlay;
        ctx.save();
        if (textOverlay.effect && textOverlay.effect.type === 'fade') {
            ctx.globalAlpha = textOverlay.effect.opacity * transform.opacity;
        } else {
            ctx.globalAlpha = transform.opacity;
        }
        const tx = viewX + transform.x * scaleX;
        const ty = viewY + transform.y * scaleY;
        ctx.translate(tx, ty);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.scale(transform.scaleX, transform.scaleY);

        const fontSize = (props.fontSize || 48) * scaleY;
        ctx.font = `bold ${fontSize}px Inter, sans-serif`;
        ctx.textBaseline = 'top';

        if (props.backgroundColor) {
            const metrics = ctx.measureText(props.text);
            ctx.fillStyle = props.backgroundColor;
            ctx.fillRect(-8, -4, metrics.width + 16, fontSize + 8);
        }
        ctx.fillStyle = props.color || '#fff';
        ctx.fillText(props.text, 0, 0);
        ctx.restore();
    }

    for (const imgOverlay of evalResult.overlayImages) {
        const { transform, assetId } = imgOverlay;
        const asset = currentProject.assets.find(a => a.id === assetId);
        if (!asset) continue;

        let img = videoElements[`img_${asset.id}`];
        if (!img) {
            img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = api.getStreamUrl(asset.id);
            videoElements[`img_${asset.id}`] = img;
        }

        if (img.complete && img.naturalWidth > 0) {
            ctx.save();
            if (imgOverlay.effect && imgOverlay.effect.type === 'fade') {
                ctx.globalAlpha = imgOverlay.effect.opacity * transform.opacity;
            } else {
                ctx.globalAlpha = transform.opacity;
            }
            const tx = viewX + transform.x * scaleX;
            const ty = viewY + transform.y * scaleY;
            ctx.translate(tx, ty);
            ctx.rotate((transform.rotation * Math.PI) / 180);
            ctx.scale(transform.scaleX, transform.scaleY);
            const drawW = 200 * scaleX;
            const drawH = drawW * (img.naturalHeight / img.naturalWidth);
            ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
        }
    }
}

// ── Properties Panel ───────────────────────────────────────
function renderProperties() {
    const { selectedClipId, currentProject } = useStore.getState();
    const content = $('#props-content');
    const title = $('#props-title');

    if (!selectedClipId || !currentProject) {
        title.textContent = 'Properties';
        content.innerHTML = '<div class="placeholder-text"><div class="empty-icon">🎬</div><p>Select a clip to edit its properties</p></div>';
        return;
    }
    const { clip, track } = findClipAndTrack(selectedClipId);
    if (!clip) return;

    title.textContent = track.type.replace('_', ' ');
    content.innerHTML = '';

    // Metadata (read-only information)
    const infoGrp = createPropGroup('Metadata');
    const p = clip.properties || {};
    if (p.originalName) infoGrp.appendChild(createPropRow('Filename', 'text', p.originalName, null));
    if (p.width && p.height) infoGrp.appendChild(createPropRow('Resolution', 'text', `${p.width}×${p.height}`, null));
    if (p.codec) infoGrp.appendChild(createPropRow('Codec', 'text', p.codec, null));
    if (infoGrp.childNodes.length > 1) content.appendChild(infoGrp);

    // Timeline position
    const grp = createPropGroup('Timeline');
    grp.appendChild(createPropRow('Start (s)', 'number', clip.start_time, v => useStore.getState().updateClip(clip.id, { start_time: parseFloat(v) })));
    grp.appendChild(createPropRow('Duration (s)', 'number', clip.duration, v => useStore.getState().updateClip(clip.id, { duration: parseFloat(v) })));
    content.appendChild(grp);

    // Audio (Video & Audio clips)
    if (track.type.startsWith('VIDEO') || track.type === 'AUDIO') {
        const aGrp = createPropGroup('Audio');
        const p = clip.properties || {};
        const isMuted = !!p.muted;
        const clipId = clip.id; // capture for closure safety

        // Mute Toggle – uses a clickable div (not checkbox) to avoid DOM-mid-event issues
        const muteRow = document.createElement('div');
        muteRow.className = `mute-toggle-row${isMuted ? ' is-muted' : ''}`;
        muteRow.innerHTML = `
            <div class="mute-toggle-label">
                <span class="mute-icon">${isMuted ? '🔇' : '🔊'}</span>
                <span>${isMuted ? 'Audio Muted' : 'Audio On'}</span>
            </div>
            <div class="mute-toggle-switch"></div>
        `;
        muteRow.addEventListener('click', () => {
            // Read FRESH state at click time
            const freshClip = findClip(clipId);
            if (!freshClip) return;
            const freshProps = freshClip.properties || {};
            const newMuted = !freshProps.muted;

            // Defer the store update so the DOM isn't destroyed during this click handler
            setTimeout(() => {
                useStore.getState().updateClip(clipId, {
                    properties: { ...freshProps, muted: newMuted }
                });
            }, 0);
        });
        aGrp.appendChild(muteRow);

        // Volume slider (only visible when not muted)
        if (!isMuted) {
            const vol = p.volume ?? 1;
            aGrp.appendChild(createPropRow('Volume', 'range', vol, v => {
                const freshClip = findClip(clipId);
                const freshProps = freshClip?.properties || {};
                useStore.getState().updateClip(clipId, { properties: { ...freshProps, volume: parseFloat(v) } });
            }));
        }
        content.appendChild(aGrp);
    }

    // Speed Ramp (Video only)
    if (track.type.startsWith('VIDEO')) {
        const sGrp = createPropGroup('Speed Ramp', () => {
            useStore.getState().addKeyframe(clip.id, 'speed', {
                id: generateId(), time: 0, speed: 1, easing: 'linear'
            });
        });

        const kList = document.createElement('div');
        kList.className = 'kf-list';
        (clip.speedKeyframes || []).forEach((kf, i) => {
            const item = document.createElement('div');
            item.className = 'kf-item kf-item-row';
            item.innerHTML = `
                <span class="kf-diamond speed">◆</span>
                <div class="kf-field"><label>Time</label><input type="number" step="0.1" value="${kf.time}" class="kf-time" /></div>
                <div class="kf-field"><label>Speed</label><input type="number" step="0.1" value="${kf.speed}" class="kf-val" /></div>
                <button class="kf-rem" title="Remove keyframe">×</button>
            `;
            item.querySelector('.kf-time').onchange = e => useStore.getState().updateKeyframe(clip.id, 'speed', i, { time: parseFloat(e.target.value) });
            item.querySelector('.kf-val').onchange = e => useStore.getState().updateKeyframe(clip.id, 'speed', i, { speed: parseFloat(e.target.value) });
            item.querySelector('.kf-rem').onclick = () => useStore.getState().removeKeyframe(clip.id, 'speed', i);
            kList.appendChild(item);
        });
        sGrp.appendChild(kList);
        content.appendChild(sGrp);
    }

    // TEXT OVERLAY – Rich Editing Panel
    if (track.type === 'OVERLAY_TEXT') {
        const tGrp = createPropGroup('Text Editing');
        const tp = clip.properties || {};

        // Content – textarea
        const contentRow = document.createElement('div');
        contentRow.className = 'prop-field-full';
        contentRow.innerHTML = `<label class="prop-field-label">Content</label>`;
        const textarea = document.createElement('textarea');
        textarea.className = 'prop-textarea';
        textarea.rows = 3;
        textarea.value = tp.text || '';
        textarea.placeholder = 'Enter your text...';
        textarea.onchange = () => useStore.getState().updateClip(clip.id, { properties: { ...tp, text: textarea.value } });
        contentRow.appendChild(textarea);
        tGrp.appendChild(contentRow);

        // Font Size + Color row
        const styleRow = document.createElement('div');
        styleRow.className = 'prop-inline-row';
        styleRow.innerHTML = `
            <div class="prop-field">
                <label class="prop-field-label">Font Size</label>
                <input type="number" class="prop-input" value="${tp.fontSize || 48}" min="8" max="400" step="1" />
            </div>
            <div class="prop-field">
                <label class="prop-field-label">Color</label>
                <div class="color-picker-wrap">
                    <input type="color" class="prop-color" value="${tp.color || '#ffffff'}" />
                    <span class="color-hex">${tp.color || '#ffffff'}</span>
                </div>
            </div>
        `;
        styleRow.querySelector('input[type="number"]').onchange = e => {
            useStore.getState().updateClip(clip.id, { properties: { ...tp, fontSize: parseInt(e.target.value) } });
        };
        const colorInput = styleRow.querySelector('input[type="color"]');
        colorInput.oninput = e => {
            styleRow.querySelector('.color-hex').textContent = e.target.value;
        };
        colorInput.onchange = e => {
            useStore.getState().updateClip(clip.id, { properties: { ...tp, color: e.target.value } });
        };
        tGrp.appendChild(styleRow);

        // Background Color
        const bgRow = document.createElement('div');
        bgRow.className = 'prop-inline-row';
        bgRow.innerHTML = `
            <div class="prop-field">
                <label class="prop-field-label">Background</label>
                <div class="color-picker-wrap">
                    <input type="color" class="prop-color" value="${tp.backgroundColor || '#000000'}" />
                    <span class="color-hex">${tp.backgroundColor || 'none'}</span>
                </div>
            </div>
            <div class="prop-field">
                <label class="toggle-label">
                    <input type="checkbox" class="toggle-check" ${tp.backgroundColor ? 'checked' : ''} />
                    <span>Enable BG</span>
                </label>
            </div>
        `;
        const bgColor = bgRow.querySelector('input[type="color"]');
        const bgCheck = bgRow.querySelector('input[type="checkbox"]');
        bgColor.oninput = e => {
            bgRow.querySelector('.color-hex').textContent = e.target.value;
        };
        bgColor.onchange = e => {
            if (bgCheck.checked) {
                useStore.getState().updateClip(clip.id, { properties: { ...tp, backgroundColor: e.target.value } });
            }
        };
        bgCheck.onchange = e => {
            useStore.getState().updateClip(clip.id, {
                properties: { ...tp, backgroundColor: e.target.checked ? bgColor.value : null }
            });
        };
        tGrp.appendChild(bgRow);

        content.appendChild(tGrp);
    }

    // OVERLAY Transform & Easing (Text + Image overlays)
    if (track.type.startsWith('OVERLAY')) {
        const ovGrp = createPropGroup('Transform & Easing', () => {
            useStore.getState().addKeyframe(clip.id, 'overlay', {
                id: generateId(), time: 0, x: 100, y: 100, scale_x: 1, scale_y: 1, rotation: 0, opacity: 1, easing: 'linear'
            });
        });

        const kList = document.createElement('div');
        kList.className = 'kf-list';
        (clip.overlayKeyframes || []).forEach((kf, i) => {
            const item = document.createElement('div');
            item.className = 'kf-item kf-item-column';

            // Row 1: Time + Remove
            const row1 = document.createElement('div');
            row1.className = 'kf-row kf-row-header';
            row1.innerHTML = `
                <div class="kf-row-left">
                    <span class="kf-diamond accent">◆</span>
                    <div class="kf-field"><label>Time</label><input type="number" step="0.1" value="${kf.time}" class="kf-time"/></div>
                </div>
                <button class="kf-rem" title="Remove keyframe">×</button>
            `;

            // Row 2: Easing
            const row2 = document.createElement('div');
            row2.className = 'kf-row';
            row2.innerHTML = `
                <div class="kf-field kf-field-full">
                    <label>Easing</label>
                    <select class="kf-select">
                        <option value="linear">Linear</option>
                        <option value="easeIn">Ease In (Quad)</option>
                        <option value="easeOut">Ease Out (Quad)</option>
                        <option value="easeInOut">Ease In Out</option>
                    </select>
                </div>
            `;
            row2.querySelector('select').value = kf.easing || 'linear';

            // Row 3: Transform values
            const row3 = document.createElement('div');
            row3.className = 'kf-row kf-row-wrap';
            const fields = [
                { key: 'x', label: 'X' },
                { key: 'y', label: 'Y' },
                { key: 'scale_x', label: 'Scale' },
                { key: 'rotation', label: 'Rot°' },
                { key: 'opacity', label: 'Alpha' }
            ];
            fields.forEach(({ key, label }) => {
                const wrap = document.createElement('div');
                wrap.className = 'kf-field';
                wrap.innerHTML = `<label>${label}</label><input type="number" step="0.1" value="${kf[key]}" class="kf-v-${key}"/>`;
                row3.appendChild(wrap);
            });

            // Bindings
            row1.querySelector('.kf-time').onchange = e => useStore.getState().updateKeyframe(clip.id, 'overlay', i, { time: parseFloat(e.target.value) });
            row1.querySelector('.kf-rem').onclick = () => useStore.getState().removeKeyframe(clip.id, 'overlay', i);
            row2.querySelector('.kf-select').onchange = e => useStore.getState().updateKeyframe(clip.id, 'overlay', i, { easing: e.target.value });
            fields.forEach(({ key }) => {
                row3.querySelector(`.kf-v-${key}`).onchange = e => useStore.getState().updateKeyframe(clip.id, 'overlay', i, { [key]: parseFloat(e.target.value) });
            });

            item.appendChild(row1);
            item.appendChild(row2);
            item.appendChild(row3);
            kList.appendChild(item);
        });
        ovGrp.appendChild(kList);
        content.appendChild(ovGrp);
    }
}

// ── Helpers ────────────────────────────────────────────────
function findClip(id) {
    const { currentProject } = useStore.getState();
    if (!currentProject) return null;
    for (const t of currentProject.tracks) for (const c of t.clips) if (c.id === id) return c;
    return null;
}
function findClipAndTrack(id) {
    const { currentProject } = useStore.getState();
    if (!currentProject) return { clip: null, track: null };
    for (const t of currentProject.tracks) {
        const c = t.clips.find(xx => xx.id === id);
        if (c) return { clip: c, track: t };
    }
    return { clip: null, track: null };
}
function generateId() { return crypto.randomUUID(); }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function formatTime(s) { const m = Math.floor(s / 60), sec = (s % 60).toFixed(1); return `${m}:${sec.padStart(4, '0')}`; }
function formatTimeShort(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`; }
function formatTimeFull(s) { return new Date(s * 1000).toISOString().substr(11, 12); } // simple HH:MM:SS.mmm
function createPropGroup(t, act) {
    const d = document.createElement('div'); d.className = 'prop-group';
    const hd = document.createElement('div'); hd.className = 'prop-group-title'; hd.textContent = t;
    if (act) { const b = document.createElement('button'); b.className = 'btn btn-small btn-secondary'; b.textContent = '+ Add'; b.onclick = act; hd.appendChild(b); }
    d.appendChild(hd); return d;
}
function createPropRow(l, typ, val, chg) {
    const r = document.createElement('div'); r.className = 'prop-row';
    r.innerHTML = `<span class="prop-label">${l}</span>`;
    const i = document.createElement('input');
    i.className = (typ === 'range') ? 'prop-range' : 'prop-input';
    i.type = typ;
    i.value = val;
    if (typ === 'number' || typ === 'range') {
        i.step = typ === 'range' ? '0.01' : '0.1';
        i.min = '0';
        i.max = typ === 'range' ? '1.0' : '10000';
    }
    if (chg) {
        if (typ === 'range') i.oninput = () => chg(i.value);
        else i.onchange = () => chg(i.value);
    } else {
        i.disabled = true;
    }
    r.appendChild(i); return r;
}

async function startExport() {
    const { currentProject } = useStore.getState();
    if (!currentProject) return;
    const requestId = `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await saveProject();

    try {
        const job = await api.startExport(currentProject.id, requestId);
        toast('Export started', 'info');
        $('#btn-export-start').disabled = true;
        $('#export-progress-wrap').classList.remove('hidden');
        $('#export-download').classList.add('hidden');
        $('#export-status').innerHTML = '<p>Rendering your project...</p>';

        const poll = setInterval(async () => {
            try {
                const status = await api.getExportStatus(job.id);
                $('#export-progress-bar').style.width = status.progress + '%';
                $('#export-progress-label').textContent = Math.round(status.progress) + '%';

                if (status.status === 'COMPLETE') {
                    clearInterval(poll);
                    $('#export-status').innerHTML = '<p style="color:var(--success)">✓ Export complete!</p>';
                    $('#export-download').classList.remove('hidden');
                    const dlLink = $('#export-download-link');
                    dlLink.href = api.getDownloadUrl(job.id);
                    $('#btn-export-start').disabled = false;
                    toast('Export complete!', 'success');
                } else if (status.status === 'FAILED') {
                    clearInterval(poll);
                    $('#export-status').innerHTML = `<p style="color:var(--danger)">✗ Export failed: ${status.error || 'Unknown error'}</p>`;
                    $('#btn-export-start').disabled = false;
                    toast('Export failed', 'error');
                }
            } catch (e) {
                console.error('Poll error:', e);
            }
        }, 2000);
    } catch (err) {
        toast('Export failed: ' + err.message, 'error');
        $('#btn-export-start').disabled = false;
    }
}
async function saveProject() {
    const { currentProject } = useStore.getState();
    if (!currentProject) return;
    try {
        await api.saveProject(currentProject.id, {
            name: currentProject.name,
            tracks: currentProject.tracks
        });
        toast('Project saved', 'success');
    } catch (err) {
        toast('Save failed: ' + err.message, 'error');
    }
}
