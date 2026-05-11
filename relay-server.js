/**
 * Relay-Server – laeuft in der Cloud.
 *
 * Aufgaben:
 *   1. Empfaengt Screen-Daten vom lokalen Infoscreen-Server per HTTP-Push.
 *   2. Verteilt die Daten via Socket.IO an alle angebundenen Remote-Screens.
 *   3. Bedient die Screen-Seite (/screen) und proxied Uploads/HLS-Segmente
 *      vom lokalen Server, damit entfernte Clients keine direkte Verbindung
 *      zum lokalen Netzwerk benoetigen.
 *
 * Konfiguration (Umgebungsvariablen):
 *   PORT               Listening-Port (Standard: 3000)
 *   RELAY_SECRET       Gemeinsames Geheimnis zwischen lokalem Server und Relay
 *   LOCAL_SERVER_URL   Oeffentliche URL des lokalen Servers fuer Asset-Proxy
 *                      Beispiel: http://192.168.1.10:3000
 */

require('dotenv').config();

const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 3000);
const RELAY_SECRET = String(process.env.RELAY_SECRET || '').trim();
const LOCAL_SERVER_URL = String(process.env.LOCAL_SERVER_URL || '').trim().replace(/\/+$/, '');

// Letzter empfangener Screen-Payload (In-Memory)
let latestScreenData = null;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));

// ─── Screen-Frontend ──────────────────────────────────────────────────────────

const screenDir = path.join(__dirname, 'public', 'screen');

app.get('/', (_req, res) => res.redirect('/screen'));
app.get('/screen', (_req, res) => res.sendFile(path.join(screenDir, 'index.html')));
app.use('/screen/assets', express.static(screenDir));

// ─── Asset-Proxy (Uploads & HLS-Segmente) ────────────────────────────────────
//
// Entfernte Screens rufen /uploads/... und /stream-hls/... beim Relay ab.
// Der Relay leitet die Anfrage an den lokalen Server weiter.
// -> Der lokale Server muss nur fuer den Relay erreichbar sein,
//    nicht direkt fuer die Internet-Clients.

function proxyToLocal(req, res) {
  if (!LOCAL_SERVER_URL) {
    res.status(503).json({
      error: 'LOCAL_SERVER_URL ist nicht gesetzt – Asset-Proxy nicht verfuegbar.',
    });
    return;
  }

  const targetUrl = `${LOCAL_SERVER_URL}${req.originalUrl}`;
  const mod = targetUrl.startsWith('https') ? https : http;

  const proxyReq = mod.get(targetUrl, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
      'Content-Length': proxyRes.headers['content-length'] || '',
      'Cache-Control': proxyRes.headers['cache-control'] || '',
    });
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Verbindung zum lokalen Server fehlgeschlagen.' });
    }
  });

  proxyReq.setTimeout(10000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Timeout beim Proxy zum lokalen Server.' });
    }
  });
}

app.use('/uploads', proxyToLocal);
app.use('/stream-hls', proxyToLocal);

// ─── Authentifizierungs-Middleware fuer Push-Endpunkte ────────────────────────

function requireRelaySecret(req, res, next) {
  if (!RELAY_SECRET) {
    // Kein Secret konfiguriert – Warnung ausgeben, aber weiterarbeiten
    return next();
  }

  const provided = req.headers['x-relay-secret'];
  if (provided !== RELAY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: x-relay-secret fehlt oder falsch.' });
  }

  return next();
}

// ─── Push-Endpunkte (werden vom lokalen Server aufgerufen) ────────────────────

// Vollstaendiger Screen-Daten-Push (z. B. nach Programmänderung)
app.post('/relay/push', requireRelaySecret, (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Kein gueltiger Payload.' });
  }

  latestScreenData = payload;
  io.to('screens').emit('screen:update', payload);

  const screenCount = [...io.of('/').sockets.values()].filter(
    (s) => s.data?.role === 'screen'
  ).length;

  return res.json({ success: true, remoteScreens: screenCount });
});

// Sofortiger Folien-Vorschau-Push
app.post('/relay/force-slide', requireRelaySecret, (req, res) => {
  const slide = req.body;
  if (!slide || typeof slide !== 'object') {
    return res.status(400).json({ error: 'Kein gueltiger Slide-Payload.' });
  }

  io.to('screens').emit('screen:force-slide', slide);
  return res.json({ success: true });
});

// Alle Remote-Screens neu laden
app.post('/relay/reload', requireRelaySecret, (_req, res) => {
  io.to('screens').emit('screen:reload');
  return res.json({ success: true });
});

// ─── Public API fuer Screen-Clients ──────────────────────────────────────────

// Initiales Laden der Screen-Daten (wird von screen.js beim Start aufgerufen)
app.get('/api/public/screen-data', (req, res) => {
  if (!latestScreenData) {
    return res.status(503).json({
      error: 'Noch keine Daten vom lokalen Server empfangen. Bitte warten.',
    });
  }
  return res.json(latestScreenData);
});

// Status-Endpunkt
app.get('/relay/status', (req, res) => {
  const sockets = [...io.of('/').sockets.values()];
  res.json({
    status: 'ok',
    lastUpdate: latestScreenData?.generatedAt ?? null,
    remoteScreens: sockets.filter((s) => s.data?.role === 'screen').length,
    totalConnections: sockets.length,
    localServerUrl: LOCAL_SERVER_URL || '(nicht konfiguriert)',
  });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.on('client:register', ({ role } = {}) => {
    const normalizedRole = role === 'screen' ? 'screen' : 'other';
    socket.data.role = normalizedRole;

    if (normalizedRole === 'screen') {
      socket.join('screens');
      // Sofort letzten bekannten Stand senden, falls vorhanden
      if (latestScreenData) {
        socket.emit('screen:update', latestScreenData);
      }
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[relay] Server lauscht auf http://localhost:${PORT}`);

  if (!RELAY_SECRET) {
    console.warn('[relay] WARNUNG: RELAY_SECRET ist nicht gesetzt – Push-Endpunkte sind ungesichert!');
  }

  if (!LOCAL_SERVER_URL) {
    console.warn('[relay] WARNUNG: LOCAL_SERVER_URL ist nicht gesetzt – Asset-Proxy (Uploads/HLS) nicht verfuegbar.');
  }
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => { server.close(); process.exit(0); });
