const fs = require('fs');
const path = require('path');
const express = require('express');
const { requireAuth } = require('../auth');
const { db, nowIso, toBooleanInt, getCustomSlides } = require('../db');
const { broadcastScreenUpdate } = require('../socket');

function parseStoredImages(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean).map((entry) => String(entry)).slice(0, 4);
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map((entry) => String(entry)).slice(0, 4) : [];
  } catch (_error) {
    return [];
  }
}

module.exports = function createSlidesRouter({ slideUpload } = {}) {
  const router = express.Router();
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
  const runSlideUpload = typeof slideUpload === 'function' ? slideUpload : (_req, _res, next) => next();

  function getUploadedImages(files = []) {
    return files
      .filter((file) => String(file.mimetype || '').startsWith('image/'))
      .map((file) => file.filename)
      .slice(0, 4);
  }

  function deleteUploadedImages(fileNames = []) {
    fileNames.filter(Boolean).forEach((fileName) => {
      const filePath = path.join(uploadDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  }

  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json(getCustomSlides(true));
  });

  router.post('/', runSlideUpload, (req, res) => {
    const invalidFiles = (req.files || []).filter((file) => !String(file.mimetype || '').startsWith('image/'));
    if (invalidFiles.length) {
      deleteUploadedImages((req.files || []).map((file) => file.filename));
      return res.status(400).json({ error: 'Für Custom Slides sind nur Bilder erlaubt' });
    }

    const images = getUploadedImages(req.files || []);
    const result = db.prepare(`
      INSERT INTO custom_slides (title, content, background_color, text_color, layout, image_paths, active, duration, created_at)
      VALUES (@title, @content, @background_color, @text_color, @layout, @image_paths, @active, @duration, @created_at)
    `).run({
      title: req.body?.title || 'Neuer Slide',
      content: req.body?.content || '',
      background_color: req.body?.background_color || '',
      text_color: req.body?.text_color || '',
      layout: req.body?.layout || 'center',
      image_paths: JSON.stringify(images),
      active: req.body?.active === false || req.body?.active === 'false' ? 0 : 1,
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

  router.put('/:id', runSlideUpload, (req, res) => {
    const existing = db.prepare('SELECT * FROM custom_slides WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Slide nicht gefunden' });
    }

    const invalidFiles = (req.files || []).filter((file) => !String(file.mimetype || '').startsWith('image/'));
    if (invalidFiles.length) {
      deleteUploadedImages((req.files || []).map((file) => file.filename));
      return res.status(400).json({ error: 'Für Custom Slides sind nur Bilder erlaubt' });
    }

    const existingImages = parseStoredImages(existing.image_paths);
    const uploadedImages = getUploadedImages(req.files || []);
    const nextImages = uploadedImages.length ? uploadedImages : existingImages;

    db.prepare(`
      UPDATE custom_slides
      SET title = @title,
          content = @content,
          background_color = @background_color,
          text_color = @text_color,
          layout = @layout,
          image_paths = @image_paths,
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
      image_paths: JSON.stringify(nextImages),
      active: req.body?.active == null ? existing.active : toBooleanInt(req.body.active === 'false' ? false : req.body.active),
      duration: req.body?.duration == null || req.body?.duration === '' ? existing.duration : Number(req.body.duration),
    });

    if (uploadedImages.length) {
      deleteUploadedImages(existingImages.filter((fileName) => !uploadedImages.includes(fileName)));
    }

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  router.delete('/:id', (req, res) => {
    const item = db.prepare('SELECT * FROM custom_slides WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Slide nicht gefunden' });
    }

    db.prepare('DELETE FROM custom_slides WHERE id = ?').run(req.params.id);
    deleteUploadedImages(parseStoredImages(item.image_paths));

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  return router;
};
