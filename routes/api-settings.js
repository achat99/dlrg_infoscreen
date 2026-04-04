const express = require('express');
const { requireAuth } = require('../auth');
const { getSettings, updateSettings } = require('../db');
const { broadcastScreenUpdate, reloadScreens } = require('../socket');

module.exports = function createSettingsRouter({ logoUpload }) {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json(getSettings());
  });

  router.put('/', (req, res) => {
    const allowedKeys = ['event_name', 'event_subtitle', 'event_date', 'slide_duration'];
    const payload = {};

    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        payload[key] = req.body[key];
      }
    }

    const settings = updateSettings(payload);
    res.json({ success: true, settings });
    broadcastScreenUpdate();
  });

  router.post('/logo', logoUpload, (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }

    const logoPath = `/uploads/${req.file.filename}`;
    updateSettings({ logo_path: logoPath });

    res.json({ success: true, logoPath });
    broadcastScreenUpdate();
    reloadScreens();
  });

  return router;
};
