const fs = require('fs');
const path = require('path');

let Database;

try {
  Database = require('better-sqlite3');
} catch (_error) {
  ({ DatabaseSync: Database } = require('node:sqlite'));
}

const resolvedDbPath = path.resolve(
  process.env.DB_PATH || path.join(__dirname, 'data', 'infoscreen.db')
);

fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

const db = new Database(resolvedDbPath);
if (typeof db.pragma === 'function') {
  db.pragma('journal_mode = WAL');
} else {
  db.exec('PRAGMA journal_mode = WAL;');
}

if (typeof db.transaction !== 'function') {
  db.transaction = (handler) => {
    return (...args) => {
      db.exec('BEGIN');
      try {
        const result = handler(...args);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch (_rollbackError) {
          // ignore rollback errors
        }
        throw error;
      }
    };
  };
}

db.exec(`
  CREATE TABLE IF NOT EXISTS event_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS program_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_at TEXT NOT NULL DEFAULT '',
    end_at TEXT DEFAULT '',
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    location TEXT DEFAULT '',
    category TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    highlight INTEGER DEFAULT 0,
    visible INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    text TEXT DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal',
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    title TEXT DEFAULT '',
    caption TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'image',
    active INTEGER DEFAULT 1,
    duration INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    background_color TEXT DEFAULT '',
    text_color TEXT DEFAULT '',
    layout TEXT NOT NULL DEFAULT 'center',
    image_paths TEXT DEFAULT '[]',
    active INTEGER DEFAULT 1,
    duration INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slide_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slide_type TEXT NOT NULL,
    reference_id INTEGER,
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    repeat_every INTEGER DEFAULT 0
  );
`);

// Migration: stream_url Spalte zur media-Tabelle hinzufügen
try {
  db.exec("ALTER TABLE media ADD COLUMN stream_url TEXT NOT NULL DEFAULT ''");
} catch (_error) {
  // Spalte existiert bereits
}

// Migration: screen_clients Tabelle anlegen
db.exec(`
  CREATE TABLE IF NOT EXISTS screen_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    online INTEGER DEFAULT 0,
    last_seen TEXT,
    created_at TEXT NOT NULL
  );
`);

const defaultSettings = {
  event_name: 'Herzlich Willkommen',
  event_subtitle: 'DLRG-Jugend Schleswig-Holstein',
  event_date: '',
  slide_duration: '12',
  logo_path: '',
};

const insertDefaultSetting = db.prepare(
  'INSERT OR IGNORE INTO event_settings (key, value) VALUES (?, ?)'
);

for (const [key, value] of Object.entries(defaultSettings)) {
  insertDefaultSetting.run(key, value);
}

function nowIso() {
  return new Date().toISOString();
}

function toBooleanInt(value) {
  return value ? 1 : 0;
}

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function toLocalDateTimeString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function normalizeTimeValue(value) {
  if (value == null || value === '') {
    return '';
  }

  if (value instanceof Date) {
    return `${padNumber(value.getHours())}:${padNumber(value.getMinutes())}`;
  }

  const match = String(value).trim().match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return '';
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) {
    return '';
  }

  return `${padNumber(hours)}:${padNumber(minutes)}`;
}

function normalizeProgramDateTimeValue(value) {
  if (value == null || value === '') {
    return '';
  }

  if (value instanceof Date) {
    return toLocalDateTimeString(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelDate = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(excelDate.getTime()) ? '' : toLocalDateTimeString(excelDate);
  }

  const text = String(value).trim();
  if (!text) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    return text;
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text)) {
    return text.slice(0, 16).replace(' ', 'T');
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T00:00`;
  }

  const germanDateTime = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s+|,?\s*)(\d{1,2}):(\d{2})$/);
  if (germanDateTime) {
    const [, day, month, year, hours, minutes] = germanDateTime;
    const normalizedYear = year.length === 2 ? `20${year}` : year;
    return `${normalizedYear}-${padNumber(month)}-${padNumber(day)}T${padNumber(hours)}:${padNumber(minutes)}`;
  }

  const germanDateOnly = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (germanDateOnly) {
    const [, day, month, year] = germanDateOnly;
    const normalizedYear = year.length === 2 ? `20${year}` : year;
    return `${normalizedYear}-${padNumber(month)}-${padNumber(day)}T00:00`;
  }

  return '';
}

function resolveDatePart(value, referenceDate = '') {
  if (value == null || value === '') {
    return '';
  }

  const directDateTime = normalizeProgramDateTimeValue(value);
  if (directDateTime) {
    return directDateTime.slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const germanDate = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\.?$/);
  if (germanDate) {
    const [, day, month, year] = germanDate;
    const reference = normalizeProgramDateTimeValue(referenceDate)
      ? new Date(normalizeProgramDateTimeValue(referenceDate))
      : new Date();
    const normalizedYear = year ? (year.length === 2 ? `20${year}` : year) : String(reference.getFullYear());
    return `${normalizedYear}-${padNumber(month)}-${padNumber(day)}`;
  }

  const weekdayMap = {
    montag: 1,
    dienstag: 2,
    mittwoch: 3,
    donnerstag: 4,
    freitag: 5,
    samstag: 6,
    sonntag: 0,
  };

  const weekdayKey = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!(weekdayKey in weekdayMap)) {
    return '';
  }

  const anchorValue = normalizeProgramDateTimeValue(referenceDate);
  const anchorDate = anchorValue ? new Date(anchorValue) : new Date();
  const baseDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const targetDay = weekdayMap[weekdayKey];
  const diff = (targetDay - baseDate.getDay() + 7) % 7;
  baseDate.setDate(baseDate.getDate() + diff);
  return `${baseDate.getFullYear()}-${padNumber(baseDate.getMonth() + 1)}-${padNumber(baseDate.getDate())}`;
}

function combineProgramDayTime(dayValue, timeValue, referenceDate = '') {
  const directDateTime = normalizeProgramDateTimeValue(dayValue) || normalizeProgramDateTimeValue(timeValue);
  if (directDateTime) {
    const normalizedTime = normalizeTimeValue(timeValue);
    if (normalizedTime && normalizeProgramDateTimeValue(dayValue)) {
      return `${normalizeProgramDateTimeValue(dayValue).slice(0, 10)}T${normalizedTime}`;
    }
    return directDateTime;
  }

  const datePart = resolveDatePart(dayValue, referenceDate);
  const timePart = normalizeTimeValue(timeValue) || '00:00';
  return datePart ? `${datePart}T${timePart}` : '';
}

function formatProgramDateLabel(startAt) {
  const normalized = normalizeProgramDateTimeValue(startAt);
  if (!normalized) {
    return '';
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatProgramTimeLabel(startAt, endAt) {
  const normalizedStart = normalizeProgramDateTimeValue(startAt);
  if (!normalizedStart) {
    return '';
  }

  const startDate = new Date(normalizedStart);
  if (Number.isNaN(startDate.getTime())) {
    return '';
  }

  const startText = startDate.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const normalizedEnd = normalizeProgramDateTimeValue(endAt);
  if (!normalizedEnd) {
    return startText;
  }

  const endDate = new Date(normalizedEnd);
  if (Number.isNaN(endDate.getTime())) {
    return startText;
  }

  const endText = endDate.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${startText}–${endText}`;
}

function decorateProgramItem(item, referenceDate = '') {
  const startAt = normalizeProgramDateTimeValue(item.start_at) || combineProgramDayTime(item.day, item.time, referenceDate);
  const endAt = normalizeProgramDateTimeValue(item.end_at);

  return {
    ...item,
    start_at: startAt,
    end_at: endAt,
    day: formatProgramDateLabel(startAt),
    time: formatProgramTimeLabel(startAt, endAt),
  };
}

function ensureProgramItemsSchema() {
  const columns = db.prepare('PRAGMA table_info(program_items)').all().map((column) => column.name);
  if (columns.includes('start_at') && columns.includes('end_at') && !columns.includes('day') && !columns.includes('time')) {
    return;
  }

  const settings = getSettings();
  const referenceDate = settings.event_date || '';
  const legacyRows = db.prepare('SELECT * FROM program_items').all();

  db.exec(`
    DROP TABLE IF EXISTS program_items_migrated;

    CREATE TABLE program_items_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_at TEXT NOT NULL DEFAULT '',
      end_at TEXT DEFAULT '',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      location TEXT DEFAULT '',
      category TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      highlight INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const insertMigratedItem = db.prepare(`
    INSERT INTO program_items_migrated (
      id, start_at, end_at, title, description, location, category, icon, highlight, visible, sort_order, created_at, updated_at
    ) VALUES (
      @id, @start_at, @end_at, @title, @description, @location, @category, @icon, @highlight, @visible, @sort_order, @created_at, @updated_at
    )
  `);

  const tx = db.transaction((items) => {
    items.forEach((item) => insertMigratedItem.run(item));
  });

  tx(
    legacyRows.map((row) => ({
      id: row.id,
      start_at: normalizeProgramDateTimeValue(row.start_at) || combineProgramDayTime(row.day, row.time, referenceDate),
      end_at: normalizeProgramDateTimeValue(row.end_at),
      title: row.title || 'Neuer Programmpunkt',
      description: row.description || '',
      location: row.location || '',
      category: row.category || '',
      icon: row.icon || '',
      highlight: row.highlight || 0,
      visible: row.visible == null ? 1 : row.visible,
      sort_order: row.sort_order || 0,
      created_at: row.created_at || nowIso(),
      updated_at: row.updated_at || row.created_at || nowIso(),
    }))
  );

  db.exec(`
    DROP TABLE program_items;
    ALTER TABLE program_items_migrated RENAME TO program_items;
  `);
}

ensureProgramItemsSchema();
db.prepare('UPDATE program_items SET sort_order = 0 WHERE COALESCE(sort_order, 0) != 0').run();

function normalizeStoredFileList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((entry) => String(entry)).slice(0, 4);
  }

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map((entry) => String(entry)).slice(0, 4) : [];
  } catch (_error) {
    return [];
  }
}

function ensureCustomSlidesSchema() {
  const columns = db.prepare('PRAGMA table_info(custom_slides)').all().map((column) => column.name);
  if (!columns.includes('image_paths')) {
    db.exec("ALTER TABLE custom_slides ADD COLUMN image_paths TEXT DEFAULT '[]'");
  }
}

function decorateCustomSlide(item) {
  const images = normalizeStoredFileList(item.image_paths);
  return {
    ...item,
    image_paths: images,
    images,
  };
}

ensureCustomSlidesSchema();

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM event_settings').all();
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

function updateSettings(payload) {
  const upsert = db.prepare(`
    INSERT INTO event_settings (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run({ key, value: value == null ? '' : String(value) });
    }
  });

  tx(Object.entries(payload || {}));
  return getSettings();
}

function withEffectiveProgramEnd(items) {
  return items.map((item, index) => {
    const startAt = normalizeProgramDateTimeValue(item.start_at);
    const explicitEndAt = normalizeProgramDateTimeValue(item.end_at);
    const nextStartAt = normalizeProgramDateTimeValue(items[index + 1]?.start_at);

    let effectiveEndAt = explicitEndAt;
    if (!effectiveEndAt && startAt) {
      if (nextStartAt && nextStartAt.slice(0, 10) === startAt.slice(0, 10)) {
        effectiveEndAt = nextStartAt;
      } else {
        const fallbackEnd = new Date(startAt);
        fallbackEnd.setMinutes(fallbackEnd.getMinutes() + 90);
        effectiveEndAt = toLocalDateTimeString(fallbackEnd);
      }
    }

    return {
      ...item,
      effective_end_at: effectiveEndAt || '',
    };
  });
}

function isProgramItemOnCurrentDay(item, now = new Date()) {
  const startAt = normalizeProgramDateTimeValue(item.start_at);
  if (!startAt) {
    return true;
  }

  const effectiveEndAt = normalizeProgramDateTimeValue(item.effective_end_at || item.end_at) || startAt;
  const startDate = new Date(startAt);
  const endDate = new Date(effectiveEndAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return true;
  }

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const nextDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return startDate < nextDayStart && endDate >= dayStart;
}

function isCurrentOrFutureProgramItem(item, now = new Date()) {
  const startAt = normalizeProgramDateTimeValue(item.start_at);
  if (!startAt) {
    return true;
  }

  const effectiveEndAt = normalizeProgramDateTimeValue(item.effective_end_at || item.end_at) || startAt;
  const endDate = new Date(effectiveEndAt);
  if (Number.isNaN(endDate.getTime())) {
    return true;
  }

  return endDate >= now;
}

function getProgramItems(includeHidden = true, options = {}) {
  const { currentAndFutureOnly = false, currentDayOnly = false } = options;
  const whereClause = includeHidden ? '' : 'WHERE visible = 1';
  const referenceDate = getSettings().event_date || '';

  let items = db
    .prepare(
      `SELECT * FROM program_items ${whereClause}
       ORDER BY COALESCE(start_at, '') ASC,
                COALESCE(end_at, '') ASC,
                id ASC`
    )
    .all()
    .map((item) => decorateProgramItem(item, referenceDate));

  items = withEffectiveProgramEnd(items);

  if (currentDayOnly) {
    items = items.filter((item) => isProgramItemOnCurrentDay(item));
  }

  if (currentAndFutureOnly) {
    items = items.filter((item) => isCurrentOrFutureProgramItem(item));
  }

  return items;
}

function getNotices(includeInactive = true) {
  const whereClause = includeInactive ? '' : 'WHERE active = 1';
  return db
    .prepare(
      `SELECT * FROM notices ${whereClause} ORDER BY CASE priority WHEN 'hoch' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, updated_at DESC, id DESC`
    )
    .all();
}

function getMedia(includeInactive = true) {
  const whereClause = includeInactive ? '' : 'WHERE active = 1';
  return db
    .prepare(`SELECT * FROM media ${whereClause} ORDER BY created_at DESC, id DESC`)
    .all();
}

function getCustomSlides(includeInactive = true) {
  const whereClause = includeInactive ? '' : 'WHERE active = 1';
  return db
    .prepare(`SELECT * FROM custom_slides ${whereClause} ORDER BY created_at DESC, id DESC`)
    .all()
    .map((item) => decorateCustomSlide(item));
}

function buildAutoQueue({ persist = false, currentAndFutureOnly = false, currentDayOnly = false } = {}) {
  const items = [];
  let sortOrder = 1;

  const programItems = getProgramItems(false, { currentAndFutureOnly, currentDayOnly });
  const highlightedProgram = programItems.filter((item) => item.highlight === 1);
  const notices = getNotices(false);
  const mediaItems = getMedia(false);
  const customSlides = getCustomSlides(false);

  items.push({ slide_type: 'welcome', reference_id: null, enabled: 1, sort_order: sortOrder++, repeat_every: 0 });

  if (programItems.length) {
    items.push({ slide_type: 'overview', reference_id: null, enabled: 1, sort_order: sortOrder++, repeat_every: 0 });
  }

  (highlightedProgram.length ? highlightedProgram : programItems).forEach((item) => {
    items.push({ slide_type: 'program', reference_id: item.id, enabled: 1, sort_order: sortOrder++, repeat_every: 0 });
  });

  notices.forEach((item) => {
    items.push({
      slide_type: 'notice',
      reference_id: item.id,
      enabled: 1,
      sort_order: sortOrder++,
      repeat_every: item.priority === 'hoch' ? 4 : 0,
    });
  });

  mediaItems.forEach((item) => {
    items.push({ slide_type: 'media', reference_id: item.id, enabled: 1, sort_order: sortOrder++, repeat_every: 0 });
  });

  customSlides.forEach((item) => {
    items.push({ slide_type: 'custom', reference_id: item.id, enabled: 1, sort_order: sortOrder++, repeat_every: 0 });
  });

  if (persist) {
    const clearQueue = db.prepare('DELETE FROM slide_queue');
    const insertQueueItem = db.prepare(`
      INSERT INTO slide_queue (slide_type, reference_id, enabled, sort_order, repeat_every)
      VALUES (@slide_type, @reference_id, @enabled, @sort_order, @repeat_every)
    `);

    const tx = db.transaction(() => {
      clearQueue.run();
      items.forEach((item) => insertQueueItem.run(item));
    });

    tx();
  }

  return items;
}

function getQueue(includeDisabled = true, options = {}) {
  const { currentAndFutureOnly = false, currentDayOnly = false } = options;

  let rows = db
    .prepare(
      `SELECT * FROM slide_queue ${includeDisabled ? '' : 'WHERE enabled = 1'} ORDER BY sort_order ASC, id ASC`
    )
    .all();

  if (!rows.length && !includeDisabled) {
    rows = buildAutoQueue({ currentAndFutureOnly, currentDayOnly });
  }

  return rows;
}

function getPublicScreenData() {
  const settings = getSettings();
  const programItems = getProgramItems(false, { currentAndFutureOnly: true, currentDayOnly: true });

  return {
    settings,
    programItems,
    notices: getNotices(false),
    media: getMedia(false),
    customSlides: getCustomSlides(false),
    queue: [],
    generatedAt: nowIso(),
  };
}

function getDashboardStats() {
  return {
    programCount: db.prepare('SELECT COUNT(*) AS count FROM program_items').get().count,
    activeNoticeCount: db.prepare('SELECT COUNT(*) AS count FROM notices WHERE active = 1').get().count,
    mediaCount: db.prepare('SELECT COUNT(*) AS count FROM media WHERE active = 1').get().count,
    customSlideCount: db.prepare('SELECT COUNT(*) AS count FROM custom_slides WHERE active = 1').get().count,
  };
}

function upsertScreenClient(name) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO screen_clients (name, online, last_seen, created_at)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(name) DO UPDATE SET online = 1, last_seen = excluded.last_seen
  `).run(name, now, now);
}

function markScreenClientOffline(name) {
  db.prepare(
    'UPDATE screen_clients SET online = 0, last_seen = ? WHERE name = ?'
  ).run(nowIso(), name);
}

function getScreenClients() {
  return db.prepare('SELECT * FROM screen_clients ORDER BY name ASC').all();
}

function deleteScreenClient(id) {
  return db.prepare('DELETE FROM screen_clients WHERE id = ?').run(id);
}

module.exports = {
  db,
  nowIso,
  toBooleanInt,
  normalizeProgramDateTimeValue,
  combineProgramDayTime,
  getSettings,
  updateSettings,
  getProgramItems,
  getNotices,
  getMedia,
  getCustomSlides,
  getQueue,
  buildAutoQueue,
  getPublicScreenData,
  getDashboardStats,
  upsertScreenClient,
  markScreenClientOffline,
  getScreenClients,
  deleteScreenClient,
};
