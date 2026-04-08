let currentSlides = [];

function getSlideImages(item = {}) {
  const images = Array.isArray(item.images)
    ? item.images
    : Array.isArray(item.image_paths)
      ? item.image_paths
      : [];

  return images.filter(Boolean).slice(0, 4);
}

function renderSlideImagePreview(images = [], files = []) {
  const preview = document.getElementById('slideImagesPreview');
  if (!preview) {
    return;
  }

  const selectedFiles = Array.from(files || []).slice(0, 4);
  if (selectedFiles.length) {
    preview.innerHTML = selectedFiles.map((file) => `
      <div class="border rounded-3 overflow-hidden" style="width:88px;height:88px;">
        <img src="${URL.createObjectURL(file)}" alt="${AdminCommon.escapeHtml(file.name)}" style="width:100%;height:100%;object-fit:cover;" />
      </div>
    `).join('');
    return;
  }

  const existingImages = images.filter(Boolean).slice(0, 4);
  if (!existingImages.length) {
    preview.innerHTML = '<div class="small text-secondary">Optional: bis zu 4 Bilder.</div>';
    return;
  }

  preview.innerHTML = existingImages.map((fileName) => `
    <div class="border rounded-3 overflow-hidden" style="width:88px;height:88px;">
      <img src="/uploads/${encodeURIComponent(fileName)}" alt="${AdminCommon.escapeHtml(fileName)}" style="width:100%;height:100%;object-fit:cover;" />
    </div>
  `).join('');
}

function resetSlideForm() {
  document.getElementById('slideId').value = '';
  document.getElementById('slideTitle').value = '';
  document.getElementById('slideContent').value = '';
  document.getElementById('slideImages').value = '';
  document.getElementById('slideBg').value = '';
  document.getElementById('slideColor').value = '';
  document.getElementById('slideLayout').value = 'center';
  document.getElementById('slideDuration').value = '';
  document.getElementById('slideActive').checked = true;
  renderSlideImagePreview();
}

function renderSlidesList() {
  const list = document.getElementById('slidesList');
  list.innerHTML = currentSlides.map((item) => {
    const images = getSlideImages(item);
    const imageMarkup = images.length
      ? `
        <div class="d-flex flex-wrap gap-2 mt-3">
          ${images.map((fileName) => `
            <div class="border rounded-3 overflow-hidden" style="width:72px;height:72px;">
              <img src="/uploads/${encodeURIComponent(fileName)}" alt="${AdminCommon.escapeHtml(fileName)}" style="width:100%;height:100%;object-fit:cover;" />
            </div>
          `).join('')}
        </div>
      `
      : '';

    return `
      <div class="border rounded-4 p-3">
        <div class="d-flex justify-content-between gap-2">
          <div>
            <div class="fw-semibold">${AdminCommon.escapeHtml(item.title)}</div>
            <div class="small text-secondary">Layout: ${AdminCommon.escapeHtml(item.layout)} · Bilder: ${images.length} · Dauer: ${AdminCommon.escapeHtml(item.duration || '')}</div>
          </div>
          <span class="badge ${item.active ? 'text-bg-success' : 'text-bg-secondary'}">${item.active ? 'aktiv' : 'aus'}</span>
        </div>
        <div class="mt-2 small">${AdminCommon.escapeHtml(item.content || '').replace(/\n/g, '<br>')}</div>
        ${imageMarkup}
        <div class="btn-group btn-group-sm mt-3">
          <button class="btn btn-outline-secondary" data-action="edit" data-id="${item.id}">Bearbeiten</button>
          <button class="btn btn-outline-primary" data-action="preview" data-id="${item.id}">Vorschau</button>
          <button class="btn btn-outline-warning" data-action="toggle" data-id="${item.id}">Toggle</button>
          <button class="btn btn-outline-danger" data-action="delete" data-id="${item.id}">Löschen</button>
        </div>
      </div>
    `;
  }).join('');
}

window.loadPageData = async () => {
  currentSlides = await AdminCommon.apiFetch('/api/slides');
  renderSlidesList();
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('slideForm');
  const list = document.getElementById('slidesList');
  const slideImagesInput = document.getElementById('slideImages');

  slideImagesInput.addEventListener('change', () => {
    if (slideImagesInput.files.length > 4) {
      AdminCommon.showToast('Bitte maximal 4 Bilder auswählen', 'warning');
    }
    renderSlideImagePreview([], slideImagesInput.files);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('slideId').value;
    const payload = new FormData();
    payload.set('title', document.getElementById('slideTitle').value);
    payload.set('content', document.getElementById('slideContent').value);
    payload.set('background_color', document.getElementById('slideBg').value);
    payload.set('text_color', document.getElementById('slideColor').value);
    payload.set('layout', document.getElementById('slideLayout').value);
    payload.set('duration', document.getElementById('slideDuration').value || '');
    payload.set('active', document.getElementById('slideActive').checked ? 'true' : 'false');

    Array.from(slideImagesInput.files).slice(0, 4).forEach((file) => {
      payload.append('images', file);
    });

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
      document.getElementById('slideImages').value = '';
      document.getElementById('slideBg').value = item.background_color || '';
      document.getElementById('slideColor').value = item.text_color || '';
      document.getElementById('slideLayout').value = item.layout || 'center';
      document.getElementById('slideDuration').value = item.duration || '';
      document.getElementById('slideActive').checked = Boolean(item.active);
      renderSlideImagePreview(getSlideImages(item));
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
