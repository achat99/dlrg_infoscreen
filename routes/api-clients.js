const express = require('express');
const { requireAuth } = require('../auth');
const { getScreenClients, deleteScreenClient } = require('../db');
const { emitClientList } = require('../socket');

const router = express.Router();

// GET /api/clients — alle jemals gesehenen Screen-Clients
router.get('/', requireAuth, (_req, res) => {
  res.json(getScreenClients());
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
