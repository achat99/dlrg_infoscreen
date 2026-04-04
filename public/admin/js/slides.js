let currentSlides = [];

function resetSlideForm() {
  document.getElementById('slideId').value = '';
  document.getElementById('slideTitle').value = '';
  document.getElementById('slideContent').value = '';
  document.getElementById('slideBg').value = '';
  document.getElementById('slideColor').value = '';
  document.getElementById('slideLayout').value = 'center';
  document.getElementById('slideDuration').value = '';
  document.getElementById('slideActive').checked = true;
}

function renderSlidesList() {
  const list = document.getElementById('slidesList');
  list.innerHTML = currentSlides.map((item) => `
    <div class="border rounded-4 p-3">
      <div class="d-flex justify-content-between gap-2">
        <div>
          <div class="fw-semibold">${AdminCommon.escapeHtml(item.title)}</div>
          <div class="small text-secondary">Layout: ${AdminCommon.escapeHtml(item.layout)} · Dauer: ${AdminCommon.escapeHtml(item.duration || '')}</div>
        </div>
        <span class="badge ${item.active ? 'text-bg-success' : 'text-bg-secondary'}">${item.active ? 'aktiv' : 'aus'}</span>
      </div>
      <div class="mt-2 small">${AdminCommon.escapeHtml(item.content || '')}</div>
      <div class="btn-group btn-group-sm mt-3">
        <button class="btn btn-outline-secondary" data-action="edit" data-id="${item.id}">Bearbeiten</button>
        <button class="btn btn-outline-primary" data-action="preview" data-id="${item.id}">Vorschau</button>
        <button class="btn btn-outline-warning" data-action="toggle" data-id="${item.id}">Toggle</button>
        <button class="btn btn-outline-danger" data-action="delete" data-id="${item.id}">Löschen</button>
      </div>
    </div>
  `).join('');
}

window.loadPageData = async () => {
  currentSlides = await AdminCommon.apiFetch('/api/slides');
  renderSlidesList();
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('slideForm');
  const list = document.getElementById('slidesList');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('slideId').value;
    const payload = {
      title: document.getElementById('slideTitle').value,
      content: document.getElementById('slideContent').value,
      background_color: document.getElementById('slideBg').value,
      text_color: document.getElementById('slideColor').value,
      layout: document.getElementById('slideLayout').value,
      duration: document.getElementById('slideDuration').value || null,
      active: document.getElementById('slideActive').checked,
    };

    await AdminCommon.apiFetch(id ? `/api/slides/${id}` : '/api/slides', {
      method: id ? 'PUT' : 'POST',
      body: payload,
    });

    resetSlideForm();
    await window.loadPageData();
    AdminCommon.showToast('Slide gespeichert');
  });

  document.getElementById('slideCancel').addEventListener('click', resetSlideForm);

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const item = currentSlides.find((entry) => entry.id === Number(button.dataset.id));
    if (!item) return;

    if (button.dataset.action === 'edit') {
      document.getElementById('slideId').value = item.id;
      document.getElementById('slideTitle').value = item.title || '';
      document.getElementById('slideContent').value = item.content || '';
      document.getElementById('slideBg').value = item.background_color || '';
      document.getElementById('slideColor').value = item.text_color || '';
      document.getElementById('slideLayout').value = item.layout || 'center';
      document.getElementById('slideDuration').value = item.duration || '';
      document.getElementById('slideActive').checked = Boolean(item.active);
      return;
    }

    if (button.dataset.action === 'preview') {
      await AdminCommon.apiFetch('/api/queue/preview', {
        method: 'POST',
        body: { slide_type: 'custom', reference_id: item.id },
      });
      AdminCommon.showToast('Slide-Vorschau gesendet');
      return;
    }

    if (button.dataset.action === 'toggle') {
      await AdminCommon.apiFetch(`/api/slides/${item.id}/toggle`, { method: 'PUT' });
      await window.loadPageData();
      return;
    }

    if (button.dataset.action === 'delete') {
      if (!window.confirm(`Slide „${item.title}“ wirklich löschen?`)) return;
      await AdminCommon.apiFetch(`/api/slides/${item.id}`, { method: 'DELETE' });
      await window.loadPageData();
      AdminCommon.showToast('Slide gelöscht', 'warning');
    }
  });

  resetSlideForm();
  AdminCommon.initPage('slides');
});
