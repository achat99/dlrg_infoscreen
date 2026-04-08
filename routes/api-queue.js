const express = require('express');
const { requireAuth } = require('../auth');
const { forceSlide } = require('../socket');

module.exports = function createQueueRouter() {
  const router = express.Router();

  router.use(requireAuth);

  const removedMessage = { error: 'Die Queue-Funktion wurde entfernt. Die Screen-Rotation läuft jetzt automatisch.' };

  router.get('/', (_req, res) => {
    res.status(410).json(removedMessage);
  });

  router.put('/', (_req, res) => {
    res.status(410).json(removedMessage);
  });

  router.post('/auto-generate', (_req, res) => {
    res.status(410).json(removedMessage);
  });

  router.post('/preview', (req, res) => {
    if (!req.body?.slide_type && !req.body?.type) {
      return res.status(400).json({ error: 'Slide-Daten fehlen' });
    }

    forceSlide(req.body);
    res.json({ success: true });
  });

  return router;
};
