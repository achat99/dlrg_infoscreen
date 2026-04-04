const express = require('express');
const XLSX = require('xlsx');
const { requireAuth } = require('../auth');
const { db, nowIso, toBooleanInt, getProgramItems } = require('../db');
const { broadcastScreenUpdate } = require('../socket');

function normalizeString(value) {
  return String(value ?? '').trim();
}

function parseBoolean(value, defaultValue = false) {
  if (value == null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'ja', 'yes', 'y', 'x'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'nein', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function normalizeImportedProgramItem(item = {}) {
  return {
    day: normalizeString(item.day || item.Day || item.Tag || item.Datum),
    time: normalizeString(item.time || item.Time || item.Uhrzeit || item.Zeit),
    title: normalizeString(item.title || item.Title || item.Titel || item.Programmpunkt) || 'Ohne Titel',
    description: normalizeString(item.description || item.Description || item.Beschreibung || item.Details),
    location: normalizeString(item.location || item.Location || item.Ort || item['Ort / Bühne'] || item.Bühne),
    category: normalizeString(item.category || item.Category || item.Kategorie),
    icon: normalizeString(item.icon || item.Icon || item['Icon (optional)'] || item.Emoji),
    highlight: parseBoolean(item.highlight || item.Highlight || item['Highlight (ja/nein)'], false),
    visible: parseBoolean(item.visible || item.Sichtbar || item['Sichtbar (ja/nein)'] || item.Aktiv, true),
  };
}

function buildProgramSignature(item) {
  return [item.day, item.time, item.title, item.location]
    .map((value) => normalizeString(value).toLowerCase())
    .join('|');
}

function getExistingSignatureMap() {
  return new Map(getProgramItems(true).map((item) => [buildProgramSignature(item), item]));
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames.includes('Programm') ? 'Programm' : workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('Keine Tabellenblätter in der Excel-Datei gefunden');
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  const items = rows
    .map((row) => normalizeImportedProgramItem(row))
    .filter((item) => item.title || item.time || item.location || item.description);

  return { sheetName, items };
}

module.exports = function createProgramRouter({ excelUpload } = {}) {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json(getProgramItems(true));
  });

  router.post('/import/preview', excelUpload, (req, res) => {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Bitte eine Excel-Datei auswählen' });
    }

    const { sheetName, items } = parseWorkbook(req.file.buffer);
    if (!items.length) {
      return res.status(400).json({ error: 'Keine importierbaren Programmpunkte gefunden' });
    }

    const existingBySignature = getExistingSignatureMap();
    const previewItems = items.map((item, index) => {
      const existingItem = existingBySignature.get(buildProgramSignature(item));
      return {
        ...item,
        importIndex: index + 1,
        status: existingItem ? 'existing' : 'new',
        existingId: existingItem?.id ?? null,
      };
    });

    return res.json({
      success: true,
      sheetName,
      totalCount: previewItems.length,
      newCount: previewItems.filter((item) => item.status === 'new').length,
      existingCount: previewItems.filter((item) => item.status === 'existing').length,
      items: previewItems,
    });
  });

  router.post('/import', (req, res) => {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: 'Keine Importdaten übergeben' });
    }

    const insertStmt = db.prepare(`
      INSERT INTO program_items (time, title, description, location, category, icon, day, highlight, visible, sort_order, created_at, updated_at)
      VALUES (@time, @title, @description, @location, @category, @icon, @day, @highlight, @visible, @sort_order, @created_at, @updated_at)
    `);

    const importItems = db.transaction((items) => {
      const existingBySignature = getExistingSignatureMap();
      let nextSortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextSortOrder FROM program_items').get().nextSortOrder;
      const insertedIds = [];
      let importedCount = 0;
      let skippedCount = 0;

      items.forEach((rawItem) => {
        const item = normalizeImportedProgramItem(rawItem);
        const signature = buildProgramSignature(item);

        if (existingBySignature.has(signature)) {
          skippedCount += 1;
          return;
        }

        const timestamp = nowIso();
        const result = insertStmt.run({
          time: item.time,
          title: item.title,
          description: item.description,
          location: item.location,
          category: item.category,
          icon: item.icon,
          day: item.day,
          highlight: toBooleanInt(item.highlight),
          visible: toBooleanInt(item.visible),
          sort_order: nextSortOrder++,
          created_at: timestamp,
          updated_at: timestamp,
        });

        insertedIds.push(result.lastInsertRowid);
        importedCount += 1;
        existingBySignature.set(signature, { id: result.lastInsertRowid, ...item });
      });

      return { importedCount, skippedCount, insertedIds };
    });

    const result = importItems(rawItems);
    res.json({ success: true, ...result });
    if (result.importedCount > 0) {
      broadcastScreenUpdate();
    }
  });

  router.post('/', (req, res) => {
    const timestamp = nowIso();
    const nextSortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextSortOrder FROM program_items').get().nextSortOrder;
    const stmt = db.prepare(`
      INSERT INTO program_items (time, title, description, location, category, icon, day, highlight, visible, sort_order, created_at, updated_at)
      VALUES (@time, @title, @description, @location, @category, @icon, @day, @highlight, @visible, @sort_order, @created_at, @updated_at)
    `);

    const result = stmt.run({
      time: req.body?.time || '',
      title: req.body?.title || 'Neuer Programmpunkt',
      description: req.body?.description || '',
      location: req.body?.location || '',
      category: req.body?.category || '',
      icon: req.body?.icon || '',
      day: req.body?.day || '',
      highlight: toBooleanInt(req.body?.highlight),
      visible: req.body?.visible === false ? 0 : 1,
      sort_order: req.body?.sort_order ?? nextSortOrder,
      created_at: timestamp,
      updated_at: timestamp,
    });

    res.status(201).json({ success: true, id: result.lastInsertRowid });
    broadcastScreenUpdate();
  });

  router.put('/reorder', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

    const updateSortOrder = db.prepare('UPDATE program_items SET sort_order = ? , updated_at = ? WHERE id = ?');
    const tx = db.transaction((itemIds) => {
      itemIds.forEach((id, index) => {
        updateSortOrder.run(index + 1, nowIso(), id);
      });
    });

    tx(ids);
    res.json({ success: true });
    broadcastScreenUpdate();
  });

  router.put('/:id/visibility', (req, res) => {
    const item = db.prepare('SELECT visible FROM program_items WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Programmpunkt nicht gefunden' });
    }

    const visible = typeof req.body?.visible === 'boolean' ? toBooleanInt(req.body.visible) : item.visible ? 0 : 1;
    db.prepare('UPDATE program_items SET visible = ?, updated_at = ? WHERE id = ?').run(visible, nowIso(), req.params.id);

    res.json({ success: true, visible });
    broadcastScreenUpdate();
  });

  router.put('/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM program_items WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Programmpunkt nicht gefunden' });
    }

    db.prepare(`
      UPDATE program_items
      SET time = @time,
          title = @title,
          description = @description,
          location = @location,
          category = @category,
          icon = @icon,
          day = @day,
          highlight = @highlight,
          visible = @visible,
          sort_order = @sort_order,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: Number(req.params.id),
      time: req.body?.time ?? existing.time,
      title: req.body?.title ?? existing.title,
      description: req.body?.description ?? existing.description,
      location: req.body?.location ?? existing.location,
      category: req.body?.category ?? existing.category,
      icon: req.body?.icon ?? existing.icon,
      day: req.body?.day ?? existing.day,
      highlight: req.body?.highlight == null ? existing.highlight : toBooleanInt(req.body.highlight),
      visible: req.body?.visible == null ? existing.visible : toBooleanInt(req.body.visible),
      sort_order: req.body?.sort_order ?? existing.sort_order,
      updated_at: nowIso(),
    });

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM program_items WHERE id = ?').run(req.params.id);
    if (!result.changes) {
      return res.status(404).json({ error: 'Programmpunkt nicht gefunden' });
    }

    res.json({ success: true });
    broadcastScreenUpdate();
  });

  return router;
};
