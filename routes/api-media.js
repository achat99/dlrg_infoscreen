const fs = require('fs');
const path = require('path');
const express = require('express');
const { requireAuth } = require('../auth');
const { db, nowIso, toBooleanInt, getMedia } = require('../db');
const { broadcastScreenUpdate } = require('../socket');
const streamManager = require('../stream-manager');

module.exports = function createMediaRouter({ mediaUpload }) {
  const router = express.Router();
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));

  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json(getMedia(true));
  });

  router.post('/', mediaUpload, (req, res) => {
    const isStream = req.body?.type === 'stream';

    if (isStream) {
      const streamUrl = String(req.body?.stream_url || '').trim();
      if (!streamUrl || !/^(https?|rtmps?|rtsps?):\/\/.+/.test(streamUrl)) {
        return res.status(400).json({ error: 'Gültige Stream-URL erforderlich' });
      }

      const result = db.prepare(`
        INSERT INTO media (filename, original_name, title, caption, type, active, duration, stream_url, created_at)
        VALUES (@filename, @original_name, @title, @caption, @type, @active, @duration, @stream_url, @created_at)
      `).run({
        filename: '',
        original_name: '',
        title: req.body?.title || 'Externer Stream',
        caption: req.body?.caption || '',
        type: 'stream',
        active: req.body?.active === false || req.body?.active === 'false' ? 0 : 1,
        duration: req.body?.duration ? Number(req.body.duration) : null,
        stream_url: streamUrl,
        created_at: nowIso(),
      });

      const newId = result.lastInsertRowid;
      if (streamManager.isRtmpOrRtsp(streamUrl) && (req.body?.active === true || req.body?.active === 'true' || req.body?.active == null)) {
        streamManager.start(newId, streamUrl);
      }
      res.status(201).json({ success: true, id: newId });
      broadcastScreenUpdate();
      return;
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }

    const result = db.prepare(`
      INSERT INTO media (filename, original_name, title, caption, type, active, duration, stream_url, created_at)
      VALUES (@filename, @original_name, @title, @caption, @type, @active, @duration, @stream_url, @created_at)
    `).run({
      filename: req.file.filename,
      original_name: req.file.originalname,
      title: req.body?.title || req.file.originalname,
      caption: req.body?.caption || '',
      type: req.body?.type || 'image',
      active: req.body?.active === false ? 0 : 1,
      duration: req.body?.duration ? Number(req.body.duration) : null,
      stream_url: '',
      created_at: nowIso(),
    });

    res.status(201).json({ success: true, id: result.lastInsertRowid });
    broadcastScreenUpdate();
  });

  router.put('/:id/toggle', (req, res) => {
    const item = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Medium nicht gefunden' });
    }

    const active = typeof req.body?.active === 'boolean' ? toBooleanInt(req.body.active) : item.active ? 0 : 1;
    db.prepare('UPDATE media SET active = ? WHERE id = ?').run(active, req.params.id);

    if (item.type === 'stream' && streamManager.isRtmpOrRtsp(item.stream_url || '')) {
      if (active) {
        streamManager.start(Number(req.params.id), item.stream_url);
      } else {
        streamManager.stop(Number(req.params.id));
      }
    }

    res.json({ success: true, active });
    broadcastScreenUpdate();
  });

  router.post('/:id/stream/start', (req, res) => {
    const item = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!item || item.type !== 'stream') {
      return res.status(404).json({ error: 'Stream nicht gefunden' });
    }
    const url = item.stream_url || '';
    if (!streamManager.isRtmpOrRtsp(url)) {
      return res.status(400).json({ error: 'Nur RTMP/RTSP-Streams können manuell gestartet werden' });
    }
    streamManager.start(Number(req.params.id), url);
    res.json({ success: true });
  });

  router.post('/:id/stream/stop', (req, res) => {
    streamManager.stop(Number(req.params.id));
    res.json({ success: true });
  });

  router.get('/:id/stream/status', (req, res) => {
    res.json(streamManager.getStatus(Number(req.params.id)));
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Medium nicht gefunden' });
    }

    const newType = req.body?.type ?? existing.type;
    let newStreamUrl = existing.stream_url || '';
    if (newType === 'stream') {
      const candidateUrl = String(req.body?.stream_url ?? existing.stream_url ?? '').trim();
      if (!candidateUrl || !/^(https?|rtmps?|rtsps?):\/\/.+/.test(candidateUrl)) {
        return res.status(400).json({ error: 'Gültige Stream-URL erforderlich' });
      }
      newStreamUrl = candidateUrl;
      // Laufenden Stream neu starten wenn URL sich geändert hat
      if (streamManager.isRtmpOrRtsp(newStreamUrl) && newStreamUrl !== existing.stream_url) {
        const currentStatus = streamManager.getStatus(Number(req.params.id));
        if (currentStatus.status === 'running' || currentStatus.status === 'starting') {
          streamManager.start(Number(req.params.id), newStreamUrl);
        }
      }
    } else if (req.body?.stream_url != null) {
      newStreamUrl = '';
    }

    db.prepare(`
      UPDATE media
      SET title = @title,
          caption = @caption,
          type = @type,
          active = @active,
          duration = @duration,
          stream_url = @stream_url
      WHERE id = @id
    `).run({
      id: Number(req.params.id),
      title: req.body?.title ?? existing.title,
      caption: req.body?.caption ?? existing.caption,
      type: newType,
      active: req.body?.active == null ? existing.active : toBooleanInt(req.body.active),
      duration: req.body?.duration == null ? existing.duration : Number(req.body.duration),
      stream_url: newStreamUrl,
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

    if (item.type === 'stream') {
      streamManager.stop(Number(req.params.id));
    }

    const filePath = path.join(uploadDir, item.filename);
    if (filePath !== uploadDir && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  return router;
};
