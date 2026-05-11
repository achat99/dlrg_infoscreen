const { getPublicScreenData, upsertScreenClient, markScreenClientOffline, getScreenClients } = require('./db');

let ioInstance = null;

// ─── Relay-Push ───────────────────────────────────────────────────────────────
// Sendet Daten an einen optionalen Cloud-Relay-Server.
// Konfiguration via RELAY_URL und RELAY_SECRET in .env.

const RELAY_URL = String(process.env.RELAY_URL || '').trim().replace(/\/+$/, '');
const RELAY_SECRET = String(process.env.RELAY_SECRET || '').trim();

async function pushToRelay(endpoint, body) {
  if (!RELAY_URL) {
    return;
  }

  try {
    await fetch(`${RELAY_URL}/relay${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(RELAY_SECRET ? { 'x-relay-secret': RELAY_SECRET } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (_err) {
    // Relay nicht erreichbar – lokalen Betrieb nicht blockieren
  }
}
const clientCounts = {
  screen: 0,
  admin: 0,
};

function updateClientCounts() {
  if (!ioInstance) {
    return clientCounts;
  }

  let screen = 0;
  let admin = 0;

  for (const socket of ioInstance.of('/').sockets.values()) {
    if (socket.data?.role === 'screen') {
      screen += 1;
    } else if (socket.data?.role === 'admin') {
      admin += 1;
    }
  }

  clientCounts.screen = screen;
  clientCounts.admin = admin;
  return clientCounts;
}

// Map from socket.id → client name (nur benannte Screen-Clients)
const namedScreenClients = new Map();

function emitAdminStats() {
  if (!ioInstance) {
    return;
  }

  const counts = updateClientCounts();
  ioInstance.to('admins').emit('admin:stats', {
    connectedScreens: counts.screen,
    connectedAdmins: counts.admin,
  });
}

function emitClientList() {
  if (!ioInstance) {
    return;
  }

  ioInstance.to('admins').emit('admin:client-list', getScreenClients());
}

function setupSocket(io) {
  ioInstance = io;

  io.on('connection', (socket) => {
    socket.on('client:register', ({ role, name } = {}) => {
      const normalizedRole = role === 'screen' ? 'screen' : 'admin';
      socket.data.role = normalizedRole;
      socket.join(normalizedRole === 'screen' ? 'screens' : 'admins');

      if (normalizedRole === 'screen') {
        socket.emit('screen:update', getPublicScreenData());

        const clientName = typeof name === 'string' ? name.trim().slice(0, 100) : '';
        if (clientName) {
          socket.data.clientName = clientName;
          namedScreenClients.set(socket.id, clientName);
          upsertScreenClient(clientName);
          emitClientList();
        }
      }

      if (normalizedRole === 'admin') {
        // Aktuellen Client-Status an den neu verbundenen Admin schicken
        socket.emit('admin:client-list', getScreenClients());
      }

      emitAdminStats();
    });

    socket.on('disconnect', () => {
      const clientName = namedScreenClients.get(socket.id);
      if (clientName) {
        namedScreenClients.delete(socket.id);
        markScreenClientOffline(clientName);
        emitClientList();
      }
      emitAdminStats();
    });
  });
}

function broadcastScreenUpdate() {
  if (!ioInstance) {
    return;
  }

  const payload = getPublicScreenData({ includeStreams: true });
  ioInstance.to('screens').emit('screen:update', payload);
  ioInstance.to('admins').emit('admin:data-changed', { updatedAt: payload.generatedAt });
  emitAdminStats();

  // Synchron in die Cloud senden
  pushToRelay('/push', payload);
}

function forceSlide(slide) {
  if (!ioInstance) {
    return;
  }

  ioInstance.to('screens').emit('screen:force-slide', slide);
  pushToRelay('/force-slide', slide);
}

function reloadScreens() {
  if (!ioInstance) {
    return;
  }

  ioInstance.to('screens').emit('screen:reload');
  pushToRelay('/reload', {});
}

function getScreenClientCount() {
  return updateClientCounts().screen;
}

module.exports = {
  setupSocket,
  broadcastScreenUpdate,
  forceSlide,
  reloadScreens,
  getScreenClientCount,
  emitClientList,
};
