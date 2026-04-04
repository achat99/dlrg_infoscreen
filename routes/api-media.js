const fs = require('fs');
const path = require('path');
const express = require('express');
const { requireAuth } = require('../auth');
const { db, nowIso, toBooleanInt, getMedia } = require('../db');
const { broadcastScreenUpdate } = require('../socket');

module.exports = function createMediaRouter({ mediaUpload }) {
  const router = express.Router();
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));

  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json(getMedia(true));
  });

  router.post('/', mediaUpload, (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }

    const result = db.prepare(`
      INSERT INTO media (filename, original_name, title, caption, type, active, duration, created_at)
      VALUES (@filename, @original_name, @title, @caption, @type, @active, @duration, @created_at)
    `).run({
      filename: req.file.filename,
      original_name: req.file.originalname,
      title: req.body?.title || req.file.originalname,
      caption: req.body?.caption || '',
      type: req.body?.type || 'image',
      active: req.body?.active === false ? 0 : 1,
      duration: req.body?.duration ? Number(req.body.duration) : null,
      created_at: nowIso(),
    });

    res.status(201).json({ success: true, id: result.lastInsertRowid });
    broadcastScreenUpdate();
  });

  router.put('/:id/toggle', (req, res) => {
    const item = db.prepare('SELECT active FROM media WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Medium nicht gefunden' });
    }

    const active = typeof req.body?.active === 'boolean' ? toBooleanInt(req.body.active) : item.active ? 0 : 1;
    db.prepare('UPDATE media SET active = ? WHERE id = ?').run(active, req.params.id);

    res.json({ success: true, active });
    broadcastScreenUpdate();
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Medium nicht gefunden' });
    }

    db.prepare(`
      UPDATE media
      SET title = @title,
          caption = @caption,
          type = @type,
          active = @active,
          duration = @duration
      WHERE id = @id
    `).run({
      id: Number(req.params.id),
      title: req.body?.title ?? existing.title,
      caption: req.body?.caption ?? existing.caption,
      type: req.body?.type ?? existing.type,
      active: req.body?.active == null ? existing.active : toBooleanInt(req.body.active),
      duration: req.body?.duration == null ? existing.duration : Number(req.body.duration),
    });

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  router.delete('/:id', (req, res) => {
    const item = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Medium nicht gefunden' });
    }

    db.prepare('DELETE FROM media WHERE id = ?').run(req.params.id);

    const filePath = path.join(uploadDir, item.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  return router;
};
