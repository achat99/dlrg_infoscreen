let currentQueue = [];

function renderQueue() {
  const list = document.getElementById('queueList');
  list.innerHTML = currentQueue.map((item, index) => `
    <label class="list-group-item d-flex justify-content-between align-items-center gap-3">
      <div>
        <div class="fw-semibold">${index + 1}. ${AdminCommon.escapeHtml(item.slide_type)}</div>
        <div class="small text-secondary">Ref: ${AdminCommon.escapeHtml(item.reference_id ?? '—')} · Wiederholen: ${AdminCommon.escapeHtml(item.repeat_every ?? 0)}</div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <input class="form-control form-control-sm" type="number" min="1" value="${item.sort_order ?? index + 1}" data-field="sort_order" data-id="${item.id ?? index}" style="width: 80px;" />
        <div class="form-check form-switch mb-0">
          <input class="form-check-input" type="checkbox" ${item.enabled ? 'checked' : ''} data-field="enabled" data-id="${item.id ?? index}" />
        </div>
        <button class="btn btn-outline-primary btn-sm" data-action="preview" data-id="${item.id ?? index}">Vorschau</button>
      </div>
    </label>
  `).join('');
}

window.loadPageData = async () => {
  currentQueue = await AdminCommon.apiFetch('/api/queue');
  renderQueue();
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('reloadQueueBtn').addEventListener('click', () => window.loadPageData());

  document.getElementById('autoGenerateBtn').addEventListener('click', async () => {
    const result = await AdminCommon.apiFetch('/api/queue/auto-generate', { method: 'POST' });
    currentQueue = result.queue || [];
    renderQueue();
    AdminCommon.showToast('Queue automatisch generiert');
  });

  document.getElementById('saveQueueBtn').addEventListener('click', async () => {
    const items = currentQueue.map((item, index) => {
      const sortInput = document.querySelector(`[data-field="sort_order"][data-id="${item.id ?? index}"]`);
      const enabledInput = document.querySelector(`[data-field="enabled"][data-id="${item.id ?? index}"]`);
      return {
        slide_type: item.slide_type,
        reference_id: item.reference_id,
        repeat_every: item.repeat_every,
        sort_order: Number(sortInput?.value || item.sort_order || index + 1),
        enabled: Boolean(enabledInput?.checked),
      };
    });

    items.sort((a, b) => a.sort_order - b.sort_order);
    await AdminCommon.apiFetch('/api/queue', { method: 'PUT', body: { items } });
    await window.loadPageData();
    AdminCommon.showToast('Queue gespeichert');
  });

  document.getElementById('previewWelcomeBtn').addEventListener('click', async () => {
    await AdminCommon.apiFetch('/api/queue/preview', { method: 'POST', body: { slide_type: 'welcome' } });
    AdminCommon.showToast('Willkommen-Slide gesendet');
  });

  document.getElementById('queueList').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="preview"]');
    if (!button) return;

    const item = currentQueue.find((entry, index) => String(entry.id ?? index) === button.dataset.id);
    if (!item) return;

    await AdminCommon.apiFetch('/api/queue/preview', { method: 'POST', body: item });
    AdminCommon.showToast('Vorschau gesendet');
  });

  AdminCommon.initPage('queue');
});
