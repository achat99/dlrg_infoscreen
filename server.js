require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const cors = require('cors');
const { Server } = require('socket.io');

require('./db');

const { login, logout, authCheck, requirePageAuth } = require('./auth');
const { setupSocket } = require('./socket');
const createSettingsRouter = require('./routes/api-settings');
const createProgramRouter = require('./routes/api-program');
const createNoticesRouter = require('./routes/api-notices');
const createMediaRouter = require('./routes/api-media');
const createSlidesRouter = require('./routes/api-slides');
const createQueueRouter = require('./routes/api-queue');
const createPublicRouter = require('./routes/api-public');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = Number(process.env.PORT || 3000);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
const adminDir = path.join(__dirname, 'public', 'admin');
const screenDir = path.join(__dirname, 'public', 'screen');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'video/mp4',
      'video/webm',
    ]);

    if (allowedMimeTypes.has(file.mimetype)) {
      return cb(null, true);
    }

    return cb(new Error('Dateityp nicht erlaubt'));
  },
});

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowedMimeTypes = new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
    ]);

    if (allowedMimeTypes.has(file.mimetype) || ['.xlsx', '.xls'].includes(extension)) {
      return cb(null, true);
    }

    return cb(new Error('Bitte eine Excel-Datei (.xlsx oder .xls) hochladen'));
  },
});

setupSocket(io);

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'replace-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

app.get('/', (_req, res) => {
  res.redirect('/screen');
});

app.get('/admin/login', (_req, res) => {
  res.sendFile(path.join(adminDir, 'login.html'));
});

const adminPages = {
  '/admin': 'index.html',
  '/admin/settings': 'settings.html',
  '/admin/program': 'program.html',
  '/admin/notices': 'notices.html',
  '/admin/media': 'media.html',
  '/admin/slides': 'slides.html',
  '/admin/queue': 'queue.html',
};

for (const [routePath, fileName] of Object.entries(adminPages)) {
  app.get(routePath, requirePageAuth, (_req, res) => {
    res.sendFile(path.join(adminDir, fileName));
  });
}

app.get('/screen', (_req, res) => {
  res.sendFile(path.join(screenDir, 'index.html'));
});

app.use('/admin/assets', express.static(adminDir));
app.use('/screen/assets', express.static(screenDir));
app.use('/uploads', express.static(uploadDir));

app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/auth/check', authCheck);

app.use('/api/settings', createSettingsRouter({ logoUpload: upload.single('logo') }));
app.use('/api/program', createProgramRouter({ excelUpload: excelUpload.single('file') }));
app.use('/api/notices', createNoticesRouter());
app.use('/api/media', createMediaRouter({ mediaUpload: upload.single('file') }));
app.use('/api/slides', createSlidesRouter());
app.use('/api/queue', createQueueRouter());
app.use('/api/public', createPublicRouter());

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }

  if (err) {
    return res.status(400).json({ error: err.message || 'Unbekannter Fehler' });
  }

  return res.status(500).json({ error: 'Interner Serverfehler' });
});

server.listen(port, () => {
  console.log(`Infoscreen server listening on http://localhost:${port}`);
});
