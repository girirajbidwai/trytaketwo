// ============================================================
// API Client
// ============================================================
const BASE = '/api';

async function request(path, options = {}) {
    // Default headers, merge with any provided
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const res = await fetch(`${BASE}${path}`, {
        ...options,
        headers,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Request failed');
    }
    return res.json();
}

export const api = {
    // Projects
    createProject: (name) => request('/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
    }),
    listProjects: () => request('/projects'),
    getProject: (id) => request(`/projects/${id}`),
    saveProject: (id, data) => request(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),

    // Assets
    uploadAsset: async (projectId, file, thumbnailBlob) => {
        const form = new FormData();
        form.append('file', file);
        if (thumbnailBlob) {
            form.append('thumbnail', thumbnailBlob, 'thumbnail.jpg');
        }
        const res = await fetch(`${BASE}/${projectId}/assets`, {
            method: 'POST',
            body: form,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(err.error);
        }
        return res.json();
    },
    listAssets: (projectId) => request(`/${projectId}/assets`),
    deleteAsset: (id) => request(`/assets/${id}`, { method: 'DELETE' }),
    setAssetThumbnail: async (id, blob) => {
        const form = new FormData();
        form.append('thumbnail', blob, 'thumbnail.jpg');
        const res = await fetch(`${BASE}/assets/${id}/thumbnail`, {
            method: 'POST',
            body: form,
        });
        return res.json();
    },
    getThumbnailUrl: (id) => `${BASE}/assets/${id}/thumbnail`,
    getStreamUrl: (id) => `${BASE}/assets/${id}/stream`,

    // Export
    startExport: (projectId, requestId) => request(`/${projectId}/export`, {
        method: 'POST',
        body: JSON.stringify({ requestId }),
    }),
    getExportStatus: (id) => request(`/exports/${id}`),
    listExports: (projectId) => request(`/${projectId}/exports`),
    getDownloadUrl: (id) => `${BASE}/exports/${id}/download`,
};
