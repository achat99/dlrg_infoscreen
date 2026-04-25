const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const hlsBaseDir = path.resolve(
  process.env.STREAM_HLS_DIR || path.join(__dirname, 'data', 'streams')
);

fs.mkdirSync(hlsBaseDir, { recursive: true });

// Map<id, { process, status, error, url, startedAt }>
const activeStreams = new Map();

function isRtmpOrRtsp(url) {
  return /^rtmp[se]?:\/\//i.test(url) || /^rtsps?:\/\//i.test(url);
}

function getHlsDir(id) {
  return path.join(hlsBaseDir, String(id));
}

function getHlsUrl(id) {
  return `/stream-hls/${id}/index.m3u8`;
}

function start(id, url) {
  stop(id);

  const hlsDir = getHlsDir(id);
  fs.mkdirSync(hlsDir, { recursive: true });

  const outputFile = path.join(hlsDir, 'index.m3u8');

  const isRtsp = /^rtsps?:\/\//i.test(url);
  const args = [
    '-loglevel', 'warning',
    ...(isRtsp ? ['-rtsp_transport', 'tcp'] : []),
    '-i', url,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    // Main-Profil: kompatibel mit fMP4 und nutzt Hardware-Decoder auf Pi 4B
    '-profile:v', 'main',
    '-level', '4.0',
    // 25 fps – reduziert Dekodieraufwand, reicht für Infoscreen-Streams
    '-r', '25',
    // Feste GOP-Größe: muss zur Segmentlänge passen (25fps × 6s = 150)
    '-g', '150',
    '-sc_threshold', '0',
    '-b:v', '4000k',
    '-maxrate', '4000k',
    '-bufsize', '8000k',
    // Seitenverhältnis erhalten, Breite automatisch (gerade Zahl, Pflicht für H.264)
    '-vf', 'scale=-2:720',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'hls',
    '-hls_time', '6',
    '-hls_list_size', '5',
    // fMP4-Segmente statt MPEG-TS: Chromium nutzt damit den nativen Hardware-Decoder
    // (MPEG-TS wird von HLS.js in JS geparsert → kein Hardware-Decode → Flackern)
    '-hls_segment_type', 'fmp4',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(hlsDir, 'seg%03d.m4s'),
    outputFile,
  ];

  let proc;
  const state = {
    process: null,
    status: 'starting',
    error: null,
    url,
    startedAt: new Date().toISOString(),
  };
  activeStreams.set(id, state);

  try {
    proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    state.process = proc;
  } catch (spawnError) {
    state.status = 'error';
    state.error = 'FFmpeg konnte nicht gestartet werden.';
    return state;
  }

  let stderrBuffer = '';
  proc.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop();
    for (const line of lines) {
      if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
        state.error = line.trim();
      }
      if (state.status === 'starting' && (line.includes('frame=') || line.includes('Opening'))) {
        state.status = 'running';
      }
    }
  });

  proc.on('error', (err) => {
    if (err.code === 'ENOENT') {
      state.status = 'error';
      state.error = 'FFmpeg nicht gefunden. Bitte FFmpeg installieren (brew install ffmpeg).';
    } else {
      state.status = 'error';
      state.error = err.message;
    }
    state.process = null;
  });

  proc.on('exit', (code) => {
    if (state.status !== 'stopped') {
      state.status = code === 0 ? 'stopped' : 'error';
      if (!state.error && code !== 0) {
        state.error = `FFmpeg beendet mit Code ${code}`;
      }
    }
    state.process = null;
  });

  // Nach 3s prüfen ob der Prozess noch läuft → als "running" markieren
  setTimeout(() => {
    if (activeStreams.get(id) === state && state.status === 'starting' && state.process) {
      state.status = 'running';
    }
  }, 3000);

  return state;
}

function stop(id) {
  const state = activeStreams.get(id);
  if (!state) return;

  state.status = 'stopped';
  if (state.process) {
    state.process.kill('SIGTERM');
    state.process = null;
  }
  activeStreams.delete(id);

  const hlsDir = getHlsDir(id);
  try {
    fs.rmSync(hlsDir, { recursive: true, force: true });
  } catch (_error) {
    // ignore cleanup errors
  }
}

function getStatus(id) {
  const state = activeStreams.get(id);
  if (!state) return { status: 'stopped', error: null, startedAt: null };
  return { status: state.status, error: state.error, startedAt: state.startedAt };
}

function stopAll() {
  for (const id of [...activeStreams.keys()]) {
    stop(id);
  }
}

module.exports = { start, stop, getStatus, stopAll, isRtmpOrRtsp, getHlsUrl, hlsBaseDir };
