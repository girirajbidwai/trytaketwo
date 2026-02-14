import { createStore } from 'zustand/vanilla';
import { api } from './api.js';

// ── Store ──────────────────────────────────────────────────
export const useStore = createStore((set, get) => ({
    // State
    currentProject: null,
    selectedClipId: null,
    playing: false,
    currentTime: 0,
    zoom: 100,         // pixels per second
    duration: 30,      // total timeline visible duration
    playAnimFrame: null,
    lastPlayTimestamp: null,
    videoElements: {},  // assetId -> HTMLVideoElement cache (for preview)

    // Actions
    setProject: (project) => set({ currentProject: project }),

    selectClip: (clipId) => set({ selectedClipId: clipId }),

    setTime: (time) => set({ currentTime: Math.max(0, time) }),

    setPlaying: (playing) => set({ playing }),

    setZoom: (zoom) => set({ zoom: Math.max(20, Math.min(500, zoom)) }),

    addAsset: (asset) => {
        const project = get().currentProject;
        if (!project) return;
        set({ currentProject: { ...project, assets: [...project.assets, asset] } });
    },

    removeAsset: (assetId) => {
        const project = get().currentProject;
        if (!project) return;
        const newAssets = project.assets.filter(a => a.id !== assetId);
        set({ currentProject: { ...project, assets: newAssets } });
    },

    updateTrackClips: (trackId, newClips) => {
        const project = get().currentProject;
        if (!project) return;

        const newTracks = project.tracks.map(t =>
            t.id === trackId ? { ...t, clips: newClips } : t
        );
        set({ currentProject: { ...project, tracks: newTracks } });
    },

    updateClip: (clipId, updates) => {
        const project = get().currentProject;
        if (!project) return;

        let found = false;
        const newTracks = project.tracks.map(track => {
            const clipIdx = (track.clips || []).findIndex(c => c.id === clipId);
            if (clipIdx === -1) return track;

            found = true;
            const newClips = [...track.clips];
            newClips[clipIdx] = { ...newClips[clipIdx], ...updates };
            return { ...track, clips: newClips };
        });

        if (found) set({ currentProject: { ...project, tracks: newTracks } });
    },

    addKeyframe: (clipId, type, kf) => {
        // type: 'speed' or 'overlay'
        const project = get().currentProject;
        if (!project) return;

        const newTracks = project.tracks.map(track => {
            const clipIdx = (track.clips || []).findIndex(c => c.id === clipId);
            if (clipIdx === -1) return track;

            const clip = track.clips[clipIdx];
            const newClips = [...track.clips];

            if (type === 'speed') {
                const kfs = [...(clip.speedKeyframes || []), { ...kf, easing: kf.easing || 'linear' }];
                kfs.sort((a, b) => a.time - b.time);
                newClips[clipIdx] = { ...clip, speedKeyframes: kfs };
            } else {
                const kfs = [...(clip.overlayKeyframes || []), { ...kf, easing: kf.easing || 'linear' }];
                kfs.sort((a, b) => a.time - b.time);
                newClips[clipIdx] = { ...clip, overlayKeyframes: kfs };
            }
            return { ...track, clips: newClips };
        });

        set({ currentProject: { ...project, tracks: newTracks } });
    },

    removeKeyframe: (clipId, type, index) => {
        const project = get().currentProject;
        if (!project) return;

        const newTracks = project.tracks.map(track => {
            const clipIdx = (track.clips || []).findIndex(c => c.id === clipId);
            if (clipIdx === -1) return track;

            const clip = track.clips[clipIdx];
            const newClips = [...track.clips];

            if (type === 'speed') {
                const kfs = [...(clip.speedKeyframes || [])];
                kfs.splice(index, 1);
                newClips[clipIdx] = { ...clip, speedKeyframes: kfs };
            } else {
                const kfs = [...(clip.overlayKeyframes || [])];
                kfs.splice(index, 1);
                newClips[clipIdx] = { ...clip, overlayKeyframes: kfs };
            }
            return { ...track, clips: newClips };
        });

        set({ currentProject: { ...project, tracks: newTracks } });
    },

    updateKeyframe: (clipId, type, index, updates) => {
        const project = get().currentProject;
        if (!project) return;

        const newTracks = project.tracks.map(track => {
            const clipIdx = (track.clips || []).findIndex(c => c.id === clipId);
            if (clipIdx === -1) return track;

            const clip = track.clips[clipIdx];
            const newClips = [...track.clips];

            if (type === 'speed') {
                const kfs = [...(clip.speedKeyframes || [])];
                kfs[index] = { ...kfs[index], ...updates };
                kfs.sort((a, b) => a.time - b.time); // re-sort if time changed
                newClips[clipIdx] = { ...clip, speedKeyframes: kfs };
            } else {
                const kfs = [...(clip.overlayKeyframes || [])];
                kfs[index] = { ...kfs[index], ...updates };
                kfs.sort((a, b) => a.time - b.time);
                newClips[clipIdx] = { ...clip, overlayKeyframes: kfs };
            }
            return { ...track, clips: newClips };
        });

        set({ currentProject: { ...project, tracks: newTracks } });
    }
}));
