let currentNotices = [];

function resetNoticeForm() {
  document.getElementById('noticeId').value = '';
  document.getElementById('noticeType').value = 'info';
  document.getElementById('noticePriority').value = 'normal';
  document.getElementById('noticeTitle').value = '';
  document.getElementById('noticeText').value = '';
  document.getElementById('noticeActive').checked = true;
}

function renderNoticeTable() {
  const tbody = document.getElementById('noticeTableBody');
  tbody.innerHTML = currentNotices.map((item) => `
    <tr class="${item.priority === 'hoch' ? 'notice-high' : ''}">
      <td><span class="badge ${item.type === 'warnung' ? 'text-bg-danger' : 'text-bg-primary'}">${AdminCommon.escapeHtml(item.type)}</span></td>
      <td><div class="fw-semibold">${AdminCommon.escapeHtml(item.title)}</div><div class="small text-secondary">${AdminCommon.escapeHtml(item.text || '')}</div></td>
      <td>${AdminCommon.escapeHtml(item.priority)}</td>
      <td><span class="badge ${item.active ? 'text-bg-success' : 'text-bg-secondary'}">${item.active ? 'aktiv' : 'aus'}</span></td>
      <td class="text-end"><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" data-action="edit" data-id="${item.id}">Bearbeiten</button><button class="btn btn-outline-warning" data-action="toggle" data-id="${item.id}">Toggle</button><button class="btn btn-outline-danger" data-action="delete" data-id="${item.id}">Löschen</button></div></td>
    </tr>
  `).join('');
}

window.loadPageData = async () => {
  currentNotices = await AdminCommon.apiFetch('/api/notices');
  renderNoticeTable();
};

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('noticeForm');
  const tbody = document.getElementById('noticeTableBody');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('noticeId').value;
    const payload = {
      type: document.getElementById('noticeType').value,
      priority: document.getElementById('noticePriority').value,
      title: document.getElementById('noticeTitle').value,
      text: document.getElementById('noticeText').value,
      active: document.getElementById('noticeActive').checked,
    };

    await AdminCommon.apiFetch(id ? `/api/notices/${id}` : '/api/notices', {
      method: id ? 'PUT' : 'POST',
      body: payload,
    });

    resetNoticeForm();
    await window.loadPageData();
    AdminCommon.showToast('Hinweis gespeichert');
  });

  document.getElementById('noticeCancel').addEventListener('click', resetNoticeForm);

  tbody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const item = currentNotices.find((entry) => entry.id === Number(button.dataset.id));
    if (!item) return;

    if (button.dataset.action === 'edit') {
      document.getElementById('noticeId').value = item.id;
      document.getElementById('noticeType').value = item.type;
      document.getElementById('noticePriority').value = item.priority;
      document.getElementById('noticeTitle').value = item.title;
      document.getElementById('noticeText').value = item.text || '';
      document.getElementById('noticeActive').checked = Boolean(item.active);
      return;
    }

    if (button.dataset.action === 'toggle') {
      await AdminCommon.apiFetch(`/api/notices/${item.id}/toggle`, { method: 'PUT' });
      await window.loadPageData();
      return;
    }

    if (button.dataset.action === 'delete') {
      if (!window.confirm(`Hinweis „${item.title}“ wirklich löschen?`)) return;
      await AdminCommon.apiFetch(`/api/notices/${item.id}`, { method: 'DELETE' });
      await window.loadPageData();
      AdminCommon.showToast('Hinweis gelöscht', 'warning');
    }
  });

  resetNoticeForm();
  AdminCommon.initPage('notices');
});
