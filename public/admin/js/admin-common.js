window.AdminCommon = (() => {
  let socket;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function apiFetch(url, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) } };

    if (request.body && !(request.body instanceof FormData) && !request.headers['Content-Type']) {
      request.headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }

    const response = await fetch(url, request);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/admin/login';
      }

      throw new Error(data.error || 'Anfrage fehlgeschlagen');
    }

    return data;
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) {
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${type} border-0`;
    toast.role = 'alert';
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${escapeHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    `;

    container.appendChild(toast);
    const instance = new bootstrap.Toast(toast, { delay: 2600 });
    instance.show();
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
  }

  function renderNav(activeKey) {
    const mount = document.getElementById('topbar');
    if (!mount) {
      return;
    }

    const items = [
      ['dashboard', 'Dashboard', '/admin'],
      ['settings', 'Veranstaltung', '/admin/settings'],
      ['program', 'Programm', '/admin/program'],
      ['notices', 'Hinweise', '/admin/notices'],
      ['media', 'Medien', '/admin/media'],
      ['slides', 'Slides', '/admin/slides'],
      ['queue', 'Queue', '/admin/queue'],
    ];

    mount.innerHTML = `
      <nav class="navbar navbar-expand-lg navbar-dark" style="background:${'#013154'}">
        <div class="container-fluid px-4">
          <a class="navbar-brand" href="/admin">DLRG Infoscreen</a>
          <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav">
            <span class="navbar-toggler-icon"></span>
          </button>
          <div class="collapse navbar-collapse" id="mainNav">
            <ul class="navbar-nav me-auto mb-2 mb-lg-0">
              ${items.map(([key, label, href]) => `
                <li class="nav-item">
                  <a class="nav-link ${key === activeKey ? 'active' : ''}" href="${href}">${label}</a>
                </li>
              `).join('')}
            </ul>
            <div class="d-flex align-items-center gap-3 text-white-50 small">
              <span>Verbundene Screens: <strong class="text-white" data-connected-screens>0</strong></span>
              <button class="btn btn-sm btn-outline-light" id="logoutBtn" type="button">Logout</button>
            </div>
          </div>
        </div>
      </nav>
    `;

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await apiFetch('/api/logout', { method: 'POST' });
      window.location.href = '/admin/login';
    });
  }

  async function ensureAuth() {
    const auth = await fetch('/api/auth/check').then((res) => res.json());
    if (!auth.authenticated) {
      window.location.href = '/admin/login';
      throw new Error('Nicht eingeloggt');
    }
  }

  async function initPage(activeKey, options = {}) {
    renderNav(activeKey);

    if (options.requireAuth !== false) {
      await ensureAuth();
    }

    socket = io();
    socket.emit('client:register', { role: 'admin' });
    socket.on('admin:data-changed', () => {
      if (typeof window.loadPageData === 'function') {
        window.loadPageData();
      }
    });
    socket.on('admin:stats', (stats) => {
      document.querySelectorAll('[data-connected-screens]').forEach((el) => {
        el.textContent = String(stats.connectedScreens ?? 0);
      });
    });

    if (typeof window.loadPageData === 'function') {
      await window.loadPageData();
    }
  }

  return {
    apiFetch,
    showToast,
    escapeHtml,
    initPage,
  };
})();
