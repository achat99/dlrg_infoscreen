const express = require('express');
const XLSX = require('xlsx');
const { requireAuth } = require('../auth');
const { db, nowIso, toBooleanInt, getSettings, getProgramItems, normalizeProgramDateTimeValue, combineProgramDayTime } = require('../db');
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
  const settings = getSettings();
  const referenceDate = settings.event_date || '';

  const rawStartAt = item.start_at || item.startAt || item.Start || item.Beginn || item['Beginn (Datum/Uhrzeit)'] || item['Beginn Datum/Uhrzeit'];
  const rawEndAt = item.end_at || item.endAt || item.Ende || item.Bis || item['Ende (Datum/Uhrzeit)'] || item['Ende Datum/Uhrzeit'];
  const legacyDay = normalizeString(item.day || item.Day || item.Tag || item.Datum);
  const legacyTime = normalizeString(item.time || item.Time || item.Uhrzeit || item.Zeit);

  const startAt = normalizeProgramDateTimeValue(rawStartAt) || combineProgramDayTime(legacyDay, legacyTime, referenceDate);
  const endAt = normalizeProgramDateTimeValue(rawEndAt) || combineProgramDayTime(startAt ? startAt.slice(0, 10) : '', rawEndAt, startAt || referenceDate);

  return {
    start_at: startAt,
    end_at: endAt,
    title: normalizeString(item.title || item.Title || item.Titel || item.Programmpunkt) || 'Ohne Titel',
    description: normalizeString(item.description || item.Description || item.Beschreibung || item.Details),
    location: normalizeString(item.location || item.Location || item.Ort || item['Ort / Bühne'] || item.Bühne),
    category: normalizeString(item.category || item.Category || item.Kategorie),
    icon: normalizeString(item.icon || item.Icon || item['Icon (optional)'] || item.Emoji),
    highlight: parseBoolean(item.highlight || item.Highlight || item['Highlight (ja/nein)'], false),
    visible: parseBoolean(item.visible || item.Sichtbar || item['Sichtbar (ja/nein)'] || item.Aktiv, true),
  };
}

function validateProgramItem(item = {}) {
  if (!item.start_at) {
    return 'Bitte einen gültigen Beginn mit Datum und Uhrzeit angeben';
  }

  if (item.end_at && item.end_at < item.start_at) {
    return 'Das Ende darf nicht vor dem Beginn liegen';
  }

  return '';
}

function buildProgramSignature(item) {
  return [item.start_at, item.end_at, item.title, item.location]
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
    .filter((item) => item.title || item.start_at || item.end_at || item.location || item.description);

  return { sheetName, items };
}

module.exports = function createProgramRouter({ excelUpload } = {}) {
  const router = express.Router();

  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json(getProgramItems(true));
  });

  router.get('/import/template', (_req, res) => {
    const workbook = XLSX.utils.book_new();
    const demoRows = [
      {
        Beginn: '25.04.2026 18:00',
        Ende: '25.04.2026 19:00',
        Titel: 'Anreise & Anmeldung',
        Beschreibung: 'Check-in am Empfang und Ausgabe der Unterlagen',
        Ort: 'Foyer',
        Kategorie: 'Organisation',
        'Icon (optional)': '🧭',
        'Highlight (ja/nein)': 'ja',
        'Sichtbar (ja/nein)': 'ja',
      },
      {
        Beginn: '26.04.2026 09:30',
        Ende: '26.04.2026 10:00',
        Titel: 'Begrüßung',
        Beschreibung: 'Offizieller Start des Veranstaltungstages',
        Ort: 'Hauptbühne',
        Kategorie: 'Bühne',
        'Icon (optional)': '🎤',
        'Highlight (ja/nein)': 'nein',
        'Sichtbar (ja/nein)': 'ja',
      },
      {
        Beginn: '26.04.2026 14:00',
        Ende: '26.04.2026 15:30',
        Titel: 'Rettungsstaffel',
        Beschreibung: 'Wettkampf im Schwimmbecken',
        Ort: 'Schwimmhalle',
        Kategorie: 'Wettkampf',
        'Icon (optional)': '🏊',
        'Highlight (ja/nein)': 'ja',
        'Sichtbar (ja/nein)': 'ja',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(demoRows);
    worksheet['!cols'] = [
      { wch: 20 },
      { wch: 20 },
      { wch: 28 },
      { wch: 46 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 20 },
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Programm');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="demo-programm-import.xlsx"');
    return res.send(buffer);
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
      const validationError = validateProgramItem(item);
      const existingItem = validationError ? null : existingBySignature.get(buildProgramSignature(item));
      return {
        ...item,
        importIndex: index + 1,
        status: validationError ? 'invalid' : existingItem ? 'existing' : 'new',
        validationError,
        existingId: existingItem?.id ?? null,
      };
    });

    return res.json({
      success: true,
      sheetName,
      totalCount: previewItems.length,
      newCount: previewItems.filter((item) => item.status === 'new').length,
      existingCount: previewItems.filter((item) => item.status === 'existing').length,
      invalidCount: previewItems.filter((item) => item.status === 'invalid').length,
      items: previewItems,
    });
  });

  router.post('/import', (req, res) => {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: 'Keine Importdaten übergeben' });
    }

    const insertStmt = db.prepare(`
      INSERT INTO program_items (start_at, end_at, title, description, location, category, icon, highlight, visible, sort_order, created_at, updated_at)
      VALUES (@start_at, @end_at, @title, @description, @location, @category, @icon, @highlight, @visible, @sort_order, @created_at, @updated_at)
    `);

    const importItems = db.transaction((items) => {
      const existingBySignature = getExistingSignatureMap();
      const insertedIds = [];
      let importedCount = 0;
      let skippedCount = 0;

      items.forEach((rawItem) => {
        const item = normalizeImportedProgramItem(rawItem);
        const validationError = validateProgramItem(item);
        if (validationError) {
          skippedCount += 1;
          return;
        }

        const signature = buildProgramSignature(item);
        if (existingBySignature.has(signature)) {
          skippedCount += 1;
          return;
        }

        const timestamp = nowIso();
        const result = insertStmt.run({
          start_at: item.start_at,
          end_at: item.end_at,
          title: item.title,
          description: item.description,
          location: item.location,
          category: item.category,
          icon: item.icon,
          highlight: toBooleanInt(item.highlight),
          visible: toBooleanInt(item.visible),
          sort_order: 0,
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
    const item = normalizeImportedProgramItem(req.body);
    const validationError = validateProgramItem(item);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const timestamp = nowIso();
    const stmt = db.prepare(`
      INSERT INTO program_items (start_at, end_at, title, description, location, category, icon, highlight, visible, sort_order, created_at, updated_at)
      VALUES (@start_at, @end_at, @title, @description, @location, @category, @icon, @highlight, @visible, @sort_order, @created_at, @updated_at)
    `);

    const result = stmt.run({
      start_at: item.start_at,
      end_at: item.end_at,
      title: item.title || 'Neuer Programmpunkt',
      description: item.description || '',
      location: item.location || '',
      category: item.category || '',
      icon: item.icon || '',
      highlight: toBooleanInt(item.highlight),
      visible: req.body?.visible === false ? 0 : 1,
      sort_order: 0,
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

    const nextItem = normalizeImportedProgramItem({ ...existing, ...req.body });
    const validationError = validateProgramItem(nextItem);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    db.prepare(`
      UPDATE program_items
      SET start_at = @start_at,
          end_at = @end_at,
          title = @title,
          description = @description,
          location = @location,
          category = @category,
          icon = @icon,
          highlight = @highlight,
          visible = @visible,
          sort_order = @sort_order,
          updated_at = @updated_at
      WHERE id = @id
    `).run({
      id: Number(req.params.id),
      start_at: nextItem.start_at,
      end_at: nextItem.end_at,
      title: nextItem.title,
      description: nextItem.description,
      location: nextItem.location,
      category: nextItem.category,
      icon: nextItem.icon,
      highlight: req.body?.highlight == null ? existing.highlight : toBooleanInt(req.body.highlight),
      visible: req.body?.visible == null ? existing.visible : toBooleanInt(req.body.visible),
      sort_order: 0,
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
