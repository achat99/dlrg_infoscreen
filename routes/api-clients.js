const express = require('express');
const { requireAuth } = require('../auth');
const { getScreenClients, deleteScreenClient } = require('../db');
const { emitClientList, reloadScreenByName, reloadScreens } = require('../socket');

const router = express.Router();

// GET /api/clients — alle jemals gesehenen Screen-Clients
router.get('/', requireAuth, (_req, res) => {
  res.json(getScreenClients());
});

// POST /api/clients/:id/reload — einzelnes System neu laden
router.post('/:id/reload', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Ungültige ID' });
  }

  const client = getScreenClients().find((entry) => entry.id === id);
  if (!client) {
    return res.status(404).json({ error: 'Client nicht gefunden' });
  }

  reloadScreenByName(client.name);
  return res.json({ ok: true, target: client.name });
});

// POST /api/clients/reload-all — alle aktuell verbundenen Screens neu laden
router.post('/reload-all', requireAuth, (_req, res) => {
  reloadScreens();
  return res.json({ ok: true });
});

// DELETE /api/clients/:id — Client dauerhaft entfernen
router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Ungültige ID' });
  }

  const result = deleteScreenClient(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Client nicht gefunden' });
  }

  emitClientList();
  res.json({ ok: true });
});

module.exports = router;
