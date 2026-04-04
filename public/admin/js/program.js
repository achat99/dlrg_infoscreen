let currentProgramItems = [];
let currentImportPreview = [];

function resetProgramForm() {
  document.getElementById('programId').value = '';
  document.getElementById('programDay').value = '';
  document.getElementById('programTime').value = '';
  document.getElementById('programTitle').value = '';
  document.getElementById('programDescription').value = '';
  document.getElementById('programLocation').value = '';
  document.getElementById('programCategory').value = '';
  document.getElementById('programIcon').value = '';
  document.getElementById('programSort').value = '';
  document.getElementById('programHighlight').checked = false;
  document.getElementById('programVisible').checked = true;
}

function resetImportPreview(message = 'Noch keine Datei geprüft.') {
  currentImportPreview = [];
  document.getElementById('importSummary').textContent = message;
  document.getElementById('programImportPreviewBody').innerHTML = '';
  document.getElementById('programImportPreviewWrap').classList.add('d-none');
  document.getElementById('programImportConfirm').disabled = true;
}

function renderImportPreview(result) {
  currentImportPreview = result.items || [];
  document.getElementById('importSummary').innerHTML = `
    <strong>${result.totalCount}</strong> Einträge geprüft ·
    <span class="text-success"><strong>${result.newCount}</strong> neu</span> ·
    <span class="text-secondary"><strong>${result.existingCount}</strong> bereits vorhanden</span>
    <span class="ms-2">(Sheet: <code>${AdminCommon.escapeHtml(result.sheetName || 'Programm')}</code>)</span>
  `;

  const tbody = document.getElementById('programImportPreviewBody');
  tbody.innerHTML = currentImportPreview.map((item) => `
    <tr>
      <td><span class="badge ${item.status === 'new' ? 'text-bg-success' : 'text-bg-secondary'}">${item.status === 'new' ? 'neu' : 'vorhanden'}</span></td>
      <td>${AdminCommon.escapeHtml(item.day || '')}</td>
      <td>${AdminCommon.escapeHtml(item.time || '')}</td>
      <td>
        <div class="fw-semibold">${AdminCommon.escapeHtml(item.title || '')}</div>
        <div class="small text-secondary">${AdminCommon.escapeHtml(item.category || '')}</div>
      </td>
      <td>${AdminCommon.escapeHtml(item.location || '')}</td>
    </tr>
  `).join('');

  document.getElementById('programImportPreviewWrap').classList.toggle('d-none', currentImportPreview.length === 0);
  document.getElementById('programImportConfirm').disabled = !(result.newCount > 0);
}

function renderProgramTable() {
  const tbody = document.getElementById('programTableBody');
  tbody.innerHTML = currentProgramItems.map((item) => `
    <tr>
      <td><strong>${AdminCommon.escapeHtml(item.time)}</strong><div class="small text-secondary">${AdminCommon.escapeHtml(item.day || '')}</div></td>
      <td>
        <div class="fw-semibold">${AdminCommon.escapeHtml(item.title)}</div>
        <div class="small text-secondary">${AdminCommon.escapeHtml(item.category || '')}</div>
      </td>
      <td>${AdminCommon.escapeHtml(item.location || '')}</td>
      <td>
        <span class="badge ${item.visible ? 'text-bg-success' : 'text-bg-secondary'}">${item.visible ? 'sichtbar' : 'aus'}</span>
        ${item.highlight ? '<span class="badge badge-soft ms-1">Highlight</span>' : ''}
      </td>
      <td class="text-end">
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-secondary" data-action="edit" data-id="${item.id}">Bearbeiten</button>
          <button class="btn btn-outline-primary" data-action="preview" data-id="${item.id}">Vorschau</button>
          <button class="btn btn-outline-warning" data-action="toggle" data-id="${item.id}">Toggle</button>
          <button class="btn btn-outline-danger" data-action="delete" data-id="${item.id}">Löschen</button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.loadPageData = async () => {
  currentProgramItems = await AdminCommon.apiFetch('/api/program');
  renderProgramTable();
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('programForm');
  const importForm = document.getElementById('programImportForm');
  const tbody = document.getElementById('programTableBody');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('programId').value;
    const payload = {
      day: document.getElementById('programDay').value,
      time: document.getElementById('programTime').value,
      title: document.getElementById('programTitle').value,
      description: document.getElementById('programDescription').value,
      location: document.getElementById('programLocation').value,
      category: document.getElementById('programCategory').value,
      icon: document.getElementById('programIcon').value,
      sort_order: Number(document.getElementById('programSort').value) || undefined,
      highlight: document.getElementById('programHighlight').checked,
      visible: document.getElementById('programVisible').checked,
    };

    await AdminCommon.apiFetch(id ? `/api/program/${id}` : '/api/program', {
      method: id ? 'PUT' : 'POST',
      body: payload,
    });

    resetProgramForm();
    await window.loadPageData();
    AdminCommon.showToast('Programmpunkt gespeichert');
  });

  importForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fileInput = document.getElementById('programImportFile');
    const file = fileInput.files[0];

    if (!file) {
      AdminCommon.showToast('Bitte zuerst eine Excel-Datei auswählen', 'danger');
      return;
    }

    const payload = new FormData();
    payload.set('file', file);
    const result = await AdminCommon.apiFetch('/api/program/import/preview', {
      method: 'POST',
      body: payload,
    });

    renderImportPreview(result);
    AdminCommon.showToast(`Vorschau geladen: ${result.newCount} neu, ${result.existingCount} bereits vorhanden`);
  });

  document.getElementById('programImportConfirm').addEventListener('click', async () => {
    if (!currentImportPreview.length) {
      AdminCommon.showToast('Bitte zuerst eine Vorschau laden', 'danger');
      return;
    }

    const result = await AdminCommon.apiFetch('/api/program/import', {
      method: 'POST',
      body: { items: currentImportPreview },
    });

    await window.loadPageData();
    document.getElementById('programImportFile').value = '';
    resetImportPreview(`Import abgeschlossen: ${result.importedCount} neu übernommen, ${result.skippedCount} übersprungen.`);
    AdminCommon.showToast(`Import abgeschlossen: ${result.importedCount} neu übernommen`);
  });

  document.getElementById('programCancel').addEventListener('click', resetProgramForm);

  tbody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const item = currentProgramItems.find((entry) => entry.id === Number(button.dataset.id));
    if (!item) return;

    if (button.dataset.action === 'edit') {
      document.getElementById('programId').value = item.id;
      document.getElementById('programDay').value = item.day || '';
      document.getElementById('programTime').value = item.time || '';
      document.getElementById('programTitle').value = item.title || '';
      document.getElementById('programDescription').value = item.description || '';
      document.getElementById('programLocation').value = item.location || '';
      document.getElementById('programCategory').value = item.category || '';
      document.getElementById('programIcon').value = item.icon || '';
      document.getElementById('programSort').value = item.sort_order || '';
      document.getElementById('programHighlight').checked = Boolean(item.highlight);
      document.getElementById('programVisible').checked = Boolean(item.visible);
      return;
    }

    if (button.dataset.action === 'delete') {
      if (!window.confirm(`Programmpunkt „${item.title}“ wirklich löschen?`)) return;
      await AdminCommon.apiFetch(`/api/program/${item.id}`, { method: 'DELETE' });
      await window.loadPageData();
      AdminCommon.showToast('Programmpunkt gelöscht', 'warning');
      return;
    }

    if (button.dataset.action === 'toggle') {
      await AdminCommon.apiFetch(`/api/program/${item.id}/visibility`, { method: 'PUT' });
      await window.loadPageData();
      return;
    }

    if (button.dataset.action === 'preview') {
      await AdminCommon.apiFetch('/api/queue/preview', {
        method: 'POST',
        body: { slide_type: 'program', reference_id: item.id },
      });
      AdminCommon.showToast('Vorschau an den Infoscreen gesendet');
    }
  });

  resetProgramForm();
  resetImportPreview();
  AdminCommon.initPage('program');
});
