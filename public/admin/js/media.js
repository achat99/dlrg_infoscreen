let currentMediaItems = [];
let streamStatusMap = {}; // id -> { status, error }
let statusPollTimer = null;

function isRtmpOrRtsp(url) {
  return /^rtmp[se]?:\/\//i.test(url) || /^rtsps?:\/\//i.test(url);
}

function detectStreamUrlType(url) {
  if (!url) return null;
  if (isRtmpOrRtsp(url)) return 'rtmp_rtsp';
  if (/\.m3u8(\?.*)?$/i.test(url)) return 'hls';
  if (/youtube\.com\/watch|youtu\.be\//i.test(url)) return 'youtube';
  if (/\.mp4(\?.*)?$/i.test(url)) return 'mp4';
  if (/^https?:\/\//i.test(url)) return 'http';
  return null;
}

function getStreamUrlHint(url) {
  const type = detectStreamUrlType(url);
  switch (type) {
    case 'rtmp_rtsp':
      return '\u26a1 RTMP/RTSP erkannt \u2013 der Server startet FFmpeg automatisch zum Umwandeln in HLS.';
    case 'hls':
      return '\u2705 HLS-Stream \u2013 wird direkt im Browser abgespielt.';
    case 'youtube':
      return '\u2705 YouTube-Link \u2013 wird als eingebettetes Video angezeigt.';
    case 'mp4':
      return '\u2705 Direkte Video-URL \u2013 wird als Video eingebettet.';
    case 'http':
      return '\u2139\ufe0f HTTP-URL \u2013 bitte sicherstellen, dass es sich um einen Stream-Link handelt.';
    default:
      return 'HLS (.m3u8), YouTube, RTMP (rtmp://...) oder RTSP (rtsp://...).';
  }
}

function resetMediaForm() {
  document.getElementById('mediaId').value = '';
  document.getElementById('mediaFile').value = '';
  document.getElementById('mediaTitle').value = '';
  document.getElementById('mediaCaption').value = '';
  document.getElementById('mediaType').value = 'image';
  document.getElementById('mediaDuration').value = '';
  document.getElementById('mediaActive').checked = true;
  document.getElementById('mediaStreamUrl').value = '';
  document.getElementById('mediaStreamHint').textContent = getStreamUrlHint('');
  updateMediaTypeVisibility('image');
}

function updateMediaTypeVisibility(type) {
  const isStream = type === 'stream';
  document.getElementById('mediaFileRow').style.display = isStream ? 'none' : '';
  document.getElementById('mediaStreamUrlRow').style.display = isStream ? '' : 'none';
}

function streamStatusBadge(item) {
  if (!isRtmpOrRtsp(item.stream_url || '')) return '';
  const st = streamStatusMap[item.id];
  if (!st || st.status === 'stopped') return '<span class="badge text-bg-secondary ms-1">gestoppt</span>';
  if (st.status === 'running') return '<span class="badge text-bg-danger ms-1">\u25cf Live</span>';
  if (st.status === 'starting') return '<span class="badge text-bg-warning text-dark ms-1">\u23f3 Startet\u2026</span>';
  if (st.status === 'error') return `<span class="badge text-bg-danger ms-1" title="${AdminCommon.escapeHtml(st.error || '')}">\u26a0 Fehler</span>`;
  return '<span class="badge text-bg-secondary ms-1">gestoppt</span>';
}

function streamControlButtons(item) {
  if (!isRtmpOrRtsp(item.stream_url || '')) return '';
  const st = streamStatusMap[item.id];
  const isRunning = st && (st.status === 'running' || st.status === 'starting');
  if (isRunning) {
    return `<button class="btn btn-sm btn-danger" data-action="stream-stop" data-id="${item.id}">\u23f9 Stream stoppen</button>`;
  }
  return `<button class="btn btn-sm btn-success" data-action="stream-start" data-id="${item.id}">\u25b6 Stream starten</button>`;
}

function renderMediaList() {
  const list = document.getElementById('mediaList');
  list.innerHTML = currentMediaItems.map((item) => {
    const isStream = item.type === 'stream';
    const preview = isStream
      ? `<div class="thumb-preview d-flex align-items-center justify-content-center bg-dark text-white rounded" style="font-size:1.5rem;" title="${AdminCommon.escapeHtml(item.stream_url || '')}">\u25b6</div>`
      : `<img class="thumb-preview" src="/uploads/${AdminCommon.escapeHtml(item.filename)}" alt="${AdminCommon.escapeHtml(item.title)}" />`;
    const subtitle = isStream ? (item.stream_url || '') : (item.caption || '');
    return `
    <div class="border rounded-4 p-3 d-flex gap-3 align-items-start" id="media-item-${item.id}">
      ${preview}
      <div class="flex-grow-1">
        <div class="d-flex justify-content-between gap-2">
          <div>
            <div class="fw-semibold">${AdminCommon.escapeHtml(item.title || item.original_name)}${isStream ? streamStatusBadge(item) : ''}</div>
            <div class="small text-secondary text-truncate" style="max-width:380px;">${AdminCommon.escapeHtml(subtitle)}</div>
          </div>
          <div class="text-end flex-shrink-0">
            <span class="badge ${item.active ? 'text-bg-success' : 'text-bg-secondary'}">${item.active ? 'aktiv' : 'aus'}</span>
            <div class="small text-secondary mt-1">${AdminCommon.escapeHtml(item.type)}</div>
          </div>
        </div>
        ${isStream && streamStatusMap[item.id]?.error ? `<div class="small text-danger mt-1"><strong>Fehler:</strong> ${AdminCommon.escapeHtml(streamStatusMap[item.id].error)}</div>` : ''}
        <div class="d-flex flex-wrap gap-2 mt-3">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary" data-action="edit" data-id="${item.id}">Bearbeiten</button>
            ${!isStream ? `<button class="btn btn-outline-primary" data-action="preview" data-id="${item.id}">Vorschau</button>` : ''}
            <button class="btn btn-outline-warning" data-action="toggle" data-id="${item.id}">${item.active ? 'Deaktivieren' : 'Aktivieren'}</button>
            <button class="btn btn-outline-danger" data-action="delete" data-id="${item.id}">L\u00f6schen</button>
          </div>
          ${isStream ? streamControlButtons(item) : ''}
        </div>
      </div>
    </div>
  `;
  }).join('');
}

async function pollStreamStatuses() {
  const rtmpItems = currentMediaItems.filter((item) => item.type === 'stream' && isRtmpOrRtsp(item.stream_url || ''));
  if (!rtmpItems.length) return;

  const results = await Promise.allSettled(
    rtmpItems.map((item) =>
      AdminCommon.apiFetch(`/api/media/${item.id}/stream/status`).then((data) => ({ id: item.id, data }))
    )
  );

  let changed = false;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { id, data } = result.value;
      const prev = streamStatusMap[id];
      if (!prev || prev.status !== data.status || prev.error !== data.error) {
        streamStatusMap[id] = data;
        changed = true;
      }
    }
  }

  if (changed) renderMediaList();
}

function startStatusPolling() {
  clearInterval(statusPollTimer);
  const hasRtmp = currentMediaItems.some((item) => item.type === 'stream' && isRtmpOrRtsp(item.stream_url || ''));
  if (hasRtmp) {
    statusPollTimer = setInterval(pollStreamStatuses, 4000);
    pollStreamStatuses();
  }
}

window.loadPageData = async () => {
  currentMediaItems = await AdminCommon.apiFetch('/api/media');
  renderMediaList();
  startStatusPolling();
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('mediaForm');
  const list = document.getElementById('mediaList');

  document.getElementById('mediaStreamUrl').addEventListener('input', (event) => {
    document.getElementById('mediaStreamHint').textContent = getStreamUrlHint(event.target.value.trim());
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('mediaId').value;
    const selectedType = document.getElementById('mediaType').value;

    if (id) {
      const body = {
        title: document.getElementById('mediaTitle').value,
        caption: document.getElementById('mediaCaption').value,
        type: selectedType,
        duration: document.getElementById('mediaDuration').value || null,
        active: document.getElementById('mediaActive').checked,
      };
      if (selectedType === 'stream') {
        body.stream_url = document.getElementById('mediaStreamUrl').value;
      }
      await AdminCommon.apiFetch(`/api/media/${id}`, { method: 'PUT', body });
    } else if (selectedType === 'stream') {
      await AdminCommon.apiFetch('/api/media', {
        method: 'POST',
        body: {
          title: document.getElementById('mediaTitle').value,
          caption: document.getElementById('mediaCaption').value,
          type: 'stream',
          stream_url: document.getElementById('mediaStreamUrl').value,
          duration: document.getElementById('mediaDuration').value || null,
          active: document.getElementById('mediaActive').checked,
        },
      });
    } else {
      const payload = new FormData();
      const file = document.getElementById('mediaFile').files[0];
      if (!file) {
        AdminCommon.showToast('Bitte zuerst eine Datei auswählen', 'danger');
        return;
      }

      payload.set('file', file);
      payload.set('title', document.getElementById('mediaTitle').value);
      payload.set('caption', document.getElementById('mediaCaption').value);
      payload.set('type', selectedType);
      payload.set('duration', document.getElementById('mediaDuration').value);
      payload.set('active', document.getElementById('mediaActive').checked ? 'true' : 'false');
      await AdminCommon.apiFetch('/api/media', { method: 'POST', body: payload });
    }

    resetMediaForm();
    await window.loadPageData();
    AdminCommon.showToast('Medium gespeichert');
  });

  document.getElementById('mediaCancel').addEventListener('click', resetMediaForm);

  document.getElementById('mediaType').addEventListener('change', (event) => {
    updateMediaTypeVisibility(event.target.value);
  });

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const item = currentMediaItems.find((entry) => entry.id === Number(button.dataset.id));
    if (!item) return;

    if (button.dataset.action === 'edit') {
      document.getElementById('mediaId').value = item.id;
      document.getElementById('mediaTitle').value = item.title || '';
      document.getElementById('mediaCaption').value = item.caption || '';
      document.getElementById('mediaType').value = item.type || 'image';
      document.getElementById('mediaDuration').value = item.duration || '';
      document.getElementById('mediaActive').checked = Boolean(item.active);
      document.getElementById('mediaStreamUrl').value = item.stream_url || '';
      document.getElementById('mediaStreamHint').textContent = getStreamUrlHint(item.stream_url || '');
      updateMediaTypeVisibility(item.type || 'image');
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (button.dataset.action === 'preview') {
      await AdminCommon.apiFetch('/api/queue/preview', {
        method: 'POST',
        body: { slide_type: 'media', reference_id: item.id },
      });
      AdminCommon.showToast('Medienvorschau gesendet');
      return;
    }

    if (button.dataset.action === 'toggle') {
      await AdminCommon.apiFetch(`/api/media/${item.id}/toggle`, { method: 'PUT' });
      await window.loadPageData();
      return;
    }

    if (button.dataset.action === 'stream-start') {
      button.disabled = true;
      try {
        await AdminCommon.apiFetch(`/api/media/${item.id}/stream/start`, { method: 'POST' });
        streamStatusMap[item.id] = { status: 'starting', error: null };
        renderMediaList();
        AdminCommon.showToast('Stream wird gestartet…');
        setTimeout(pollStreamStatuses, 2000);
      } catch (error) {
        AdminCommon.showToast(error.message || 'Stream konnte nicht gestartet werden', 'danger');
        button.disabled = false;
      }
      return;
    }

    if (button.dataset.action === 'stream-stop') {
      await AdminCommon.apiFetch(`/api/media/${item.id}/stream/stop`, { method: 'POST' });
      streamStatusMap[item.id] = { status: 'stopped', error: null };
      renderMediaList();
      AdminCommon.showToast('Stream gestoppt', 'warning');
      return;
    }

    if (button.dataset.action === 'delete') {
      if (!window.confirm(`Medium „${item.title || item.original_name}“ wirklich löschen?`)) return;
      await AdminCommon.apiFetch(`/api/media/${item.id}`, { method: 'DELETE' });
      await window.loadPageData();
      AdminCommon.showToast('Medium gelöscht', 'warning');
    }
  });

  resetMediaForm();
  AdminCommon.initPage('media');
});
