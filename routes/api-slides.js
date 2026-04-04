const express = require('express');
const { requireAuth } = require('../auth');
const { db, nowIso, toBooleanInt, getCustomSlides } = require('../db');
const { broadcastScreenUpdate } = require('../socket');

module.exports = function createSlidesRouter() {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json(getCustomSlides(true));
  });

  router.post('/', (req, res) => {
    const result = db.prepare(`
      INSERT INTO custom_slides (title, content, background_color, text_color, layout, active, duration, created_at)
      VALUES (@title, @content, @background_color, @text_color, @layout, @active, @duration, @created_at)
    `).run({
      title: req.body?.title || 'Neuer Slide',
      content: req.body?.content || '',
      background_color: req.body?.background_color || '',
      text_color: req.body?.text_color || '',
      layout: req.body?.layout || 'center',
      active: req.body?.active === false ? 0 : 1,
      duration: req.body?.duration ? Number(req.body.duration) : null,
      created_at: nowIso(),
    });

    res.status(201).json({ success: true, id: result.lastInsertRowid });
    broadcastScreenUpdate();
  });

  router.put('/:id/toggle', (req, res) => {
    const item = db.prepare('SELECT active FROM custom_slides WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Slide nicht gefunden' });
    }

    const active = typeof req.body?.active === 'boolean' ? toBooleanInt(req.body.active) : item.active ? 0 : 1;
    db.prepare('UPDATE custom_slides SET active = ? WHERE id = ?').run(active, req.params.id);

    res.json({ success: true, active });
    broadcastScreenUpdate();
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM custom_slides WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Slide nicht gefunden' });
    }

    db.prepare(`
      UPDATE custom_slides
      SET title = @title,
          content = @content,
          background_color = @background_color,
          text_color = @text_color,
          layout = @layout,
          active = @active,
          duration = @duration
      WHERE id = @id
    `).run({
      id: Number(req.params.id),
      title: req.body?.title ?? existing.title,
      content: req.body?.content ?? existing.content,
      background_color: req.body?.background_color ?? existing.background_color,
      text_color: req.body?.text_color ?? existing.text_color,
      layout: req.body?.layout ?? existing.layout,
      active: req.body?.active == null ? existing.active : toBooleanInt(req.body.active),
      duration: req.body?.duration == null ? existing.duration : Number(req.body.duration),
    });

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM custom_slides WHERE id = ?').run(req.params.id);
    if (!result.changes) {
      return res.status(404).json({ error: 'Slide nicht gefunden' });
    }

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  return router;
};
