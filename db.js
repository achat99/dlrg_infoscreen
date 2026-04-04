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
    time TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    location TEXT DEFAULT '',
    category TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    day TEXT DEFAULT '',
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

function getProgramItems(includeHidden = true) {
  const whereClause = includeHidden ? '' : 'WHERE visible = 1';
  return db
    .prepare(
      `SELECT * FROM program_items ${whereClause} ORDER BY COALESCE(day, ''), sort_order ASC, time ASC, id ASC`
    )
    .all();
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
    .all();
}

function buildAutoQueue({ persist = false } = {}) {
  const items = [];
  let sortOrder = 1;

  const programItems = getProgramItems(false);
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

function getQueue(includeDisabled = true) {
  let rows = db
    .prepare(
      `SELECT * FROM slide_queue ${includeDisabled ? '' : 'WHERE enabled = 1'} ORDER BY sort_order ASC, id ASC`
    )
    .all();

  if (!rows.length && !includeDisabled) {
    rows = buildAutoQueue();
  }

  return rows;
}

function getPublicScreenData() {
  const settings = getSettings();

  return {
    settings,
    programItems: getProgramItems(false),
    notices: getNotices(false),
    media: getMedia(false),
    customSlides: getCustomSlides(false),
    queue: getQueue(false),
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

module.exports = {
  db,
  nowIso,
  toBooleanInt,
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
};
