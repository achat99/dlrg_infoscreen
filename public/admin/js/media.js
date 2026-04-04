let currentMediaItems = [];

function resetMediaForm() {
  document.getElementById('mediaId').value = '';
  document.getElementById('mediaFile').value = '';
  document.getElementById('mediaTitle').value = '';
  document.getElementById('mediaCaption').value = '';
  document.getElementById('mediaType').value = 'image';
  document.getElementById('mediaDuration').value = '';
  document.getElementById('mediaActive').checked = true;
}

function renderMediaList() {
  const list = document.getElementById('mediaList');
  list.innerHTML = currentMediaItems.map((item) => `
    <div class="border rounded-4 p-3 d-flex gap-3 align-items-start">
      <img class="thumb-preview" src="/uploads/${AdminCommon.escapeHtml(item.filename)}" alt="${AdminCommon.escapeHtml(item.title)}" />
      <div class="flex-grow-1">
        <div class="d-flex justify-content-between gap-2">
          <div>
            <div class="fw-semibold">${AdminCommon.escapeHtml(item.title || item.original_name)}</div>
            <div class="small text-secondary">${AdminCommon.escapeHtml(item.caption || '')}</div>
          </div>
          <div class="text-end">
            <span class="badge ${item.active ? 'text-bg-success' : 'text-bg-secondary'}">${item.active ? 'aktiv' : 'aus'}</span>
            <div class="small text-secondary mt-1">${AdminCommon.escapeHtml(item.type)}</div>
          </div>
        </div>
        <div class="btn-group btn-group-sm mt-3">
          <button class="btn btn-outline-secondary" data-action="edit" data-id="${item.id}">Bearbeiten</button>
          <button class="btn btn-outline-primary" data-action="preview" data-id="${item.id}">Vorschau</button>
          <button class="btn btn-outline-warning" data-action="toggle" data-id="${item.id}">Toggle</button>
          <button class="btn btn-outline-danger" data-action="delete" data-id="${item.id}">Löschen</button>
        </div>
      </div>
    </div>
  `).join('');
}

window.loadPageData = async () => {
  currentMediaItems = await AdminCommon.apiFetch('/api/media');
  renderMediaList();
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('mediaForm');
  const list = document.getElementById('mediaList');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('mediaId').value;

    if (id) {
      await AdminCommon.apiFetch(`/api/media/${id}`, {
        method: 'PUT',
        body: {
          title: document.getElementById('mediaTitle').value,
          caption: document.getElementById('mediaCaption').value,
          type: document.getElementById('mediaType').value,
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
      payload.set('type', document.getElementById('mediaType').value);
      payload.set('duration', document.getElementById('mediaDuration').value);
      payload.set('active', document.getElementById('mediaActive').checked ? 'true' : 'false');
      await AdminCommon.apiFetch('/api/media', { method: 'POST', body: payload });
    }

    resetMediaForm();
    await window.loadPageData();
    AdminCommon.showToast('Medium gespeichert');
  });

  document.getElementById('mediaCancel').addEventListener('click', resetMediaForm);

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
