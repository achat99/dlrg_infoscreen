const express = require('express');
const { requireAuth } = require('../auth');
const { db, buildAutoQueue, getQueue } = require('../db');
const { broadcastScreenUpdate, forceSlide } = require('../socket');

module.exports = function createQueueRouter() {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json(getQueue(true));
  });

  router.put('/', (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const clearQueue = db.prepare('DELETE FROM slide_queue');
    const insertQueueItem = db.prepare(`
      INSERT INTO slide_queue (slide_type, reference_id, enabled, sort_order, repeat_every)
      VALUES (@slide_type, @reference_id, @enabled, @sort_order, @repeat_every)
    `);

    const tx = db.transaction((nextItems) => {
      clearQueue.run();
      nextItems.forEach((item, index) => {
        insertQueueItem.run({
          slide_type: item.slide_type,
          reference_id: item.reference_id ?? null,
          enabled: item.enabled === false ? 0 : 1,
          sort_order: item.sort_order ?? index + 1,
          repeat_every: item.repeat_every ?? 0,
        });
      });
    });

    tx(items);
    res.json({ success: true, queue: getQueue(true) });
    broadcastScreenUpdate();
  });

  router.post('/auto-generate', (_req, res) => {
    const queue = buildAutoQueue({ persist: true });
    res.json({ success: true, queue });
    broadcastScreenUpdate();
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
