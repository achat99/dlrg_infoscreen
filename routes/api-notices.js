const express = require('express');
const { requireAuth } = require('../auth');
const { db, nowIso, toBooleanInt, getNotices } = require('../db');
const { broadcastScreenUpdate } = require('../socket');

module.exports = function createNoticesRouter() {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json(getNotices(true));
  });

  router.post('/', (req, res) => {
    const timestamp = nowIso();
    const result = db.prepare(`
      INSERT INTO notices (type, title, text, priority, active, created_at, updated_at)
      VALUES (@type, @title, @text, @priority, @active, @created_at, @updated_at)
    `).run({
      type: req.body?.type || 'info',
      title: req.body?.title || 'Neuer Hinweis',
      text: req.body?.text || '',
      priority: req.body?.priority || 'normal',
      active: req.body?.active === false ? 0 : 1,
      created_at: timestamp,
      updated_at: timestamp,
    });

    res.status(201).json({ success: true, id: result.lastInsertRowid });
    broadcastScreenUpdate();
  });

  router.put('/:id/toggle', (req, res) => {
    const item = db.prepare('SELECT active FROM notices WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Hinweis nicht gefunden' });
    }

    const active = typeof req.body?.active === 'boolean' ? toBooleanInt(req.body.active) : item.active ? 0 : 1;
    db.prepare('UPDATE notices SET active = ?, updated_at = ? WHERE id = ?').run(active, nowIso(), req.params.id);

    res.json({ success: true, active });
    broadcastScreenUpdate();
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM notices WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Hinweis nicht gefunden' });
    }

    db.prepare(`
      UPDATE notices
      SET type = @type,
          title = @title,
          text = @text,
          priority = @priority,
          active = @active,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: Number(req.params.id),
      type: req.body?.type ?? existing.type,
      title: req.body?.title ?? existing.title,
      text: req.body?.text ?? existing.text,
      priority: req.body?.priority ?? existing.priority,
      active: req.body?.active == null ? existing.active : toBooleanInt(req.body.active),
      updated_at: nowIso(),
    });

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM notices WHERE id = ?').run(req.params.id);
    if (!result.changes) {
      return res.status(404).json({ error: 'Hinweis nicht gefunden' });
    }

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  return router;
};
