// Главный процесс Electron: окно + скачивание игры с прогрессом
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

// Убираем зависимость от видеокарты: лаунчер стабилен на слабых ПК и в VM
app.disableHardwareAcceleration();

// Chromium кэш — в свою папку userData (стабильно пишет, нет конфликтов с locked Файлами)
app.setPath('cache', path.join(app.getPath('userData'), 'chromium-cache'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

let mainWindow = null;
const STATE_FILE = path.join(app.getPath('userData'), 'install-state.json');
const LAUNCHER_SETTINGS_FILE = path.join(app.getPath('userData'), 'launcher-settings.json');
const OAUTH_PORT = 53099; // фиксированный порт для возврата после входа через Google

function readInstallMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && typeof raw === 'object' && raw.projects && typeof raw.projects === 'object') return raw.projects;
    return {}; // legacy {installed,...} без projectId — не показываем «установлено» у всех проектов
  } catch {
    return {};
  }
}

function writeInstallMap(projects) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ projects }, null, 2));
}

function setProjectInstall(projectId, state) {
  if (!projectId || typeof projectId !== 'number') return;
  const map = readInstallMap();
  map[projectId] = state;
  writeInstallMap(map);
}

function readInstallState(projectId) {
  const map = readInstallMap();
  const key = Number(projectId);
  if (Number.isFinite(key) && map[key]) return map[key];
  return { installed: false, version: null, path: null };
}

function createWindow(demoUser = false) {
  const fullscreen = !!readLauncherSettings().fullscreen;
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 760,
    minWidth: 1024,
    minHeight: 640,
    icon: path.join(__dirname, 'assets', 'iconClient.png'),
    frame: false,               // рамку рисуем сами (см. .titlebar в styles.css)
    backgroundColor: '#0b0e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('close', (e) => {
    if (isQuittingFromTray) return; // настоящий выход из трея — пропускаем
    const settings = readLauncherSettings();
    if (settings.trayOnClose) {
      e.preventDefault();
      mainWindow.hide();
      createTray();
      return;
    }
  });

  if (fullscreen) mainWindow.maximize();

  if (demoUser) {
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'), { query: { demo: 'user' } });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  }
}

// Временный предпросмотр: админка от лица владельца; закрыли её — открывается лаунчер от лица игрока
function createAdminPreviewWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'Админ-панель — предпросмотр (ДЕМО)',
    backgroundColor: '#0b0e17',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'admin', 'admin.html'), { query: { demo: 'admin' } });
  win.on('closed', () => createWindow(true));
  return win;
}

// ---------- Безопасное (зашифрованное) хранилище сессии key-value ----------
const SESSION_FILE = path.join(app.getPath('userData'), 'session.enc');
let safeStorageAvailable = false;

try {
  safeStorageAvailable = require('electron').safeStorage?.isEncryptionAvailable() || false;
} catch {
  safeStorageAvailable = false;
}

function readSessionMap() {
  if (!safeStorageAvailable) return {};
  try {
    if (!fs.existsSync(SESSION_FILE)) return {};
    const encrypted = fs.readFileSync(SESSION_FILE);
    const text = require('electron').safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(text || '{}');
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessionMap(map) {
  if (!safeStorageAvailable) return;
  try {
    fs.writeFileSync(SESSION_FILE, require('electron').safeStorage.encryptString(Buffer.from(JSON.stringify(map), 'utf8')));
  } catch { /* ignore */ }
}

ipcMain.handle('auth:session-read', (_event, key) => {
  const map = readSessionMap();
  return map[key] ?? null;
});

ipcMain.handle('auth:session-write', (_event, key, value) => {
  const map = readSessionMap();
  map[key] = value;
  writeSessionMap(map);
  return true;
});

ipcMain.handle('auth:session-clear', (_event, key) => {
  if (!key) {
    try { fs.rmSync(SESSION_FILE, { force: true }); } catch { /* уже нет */ }
    return true;
  }
  const map = readSessionMap();
  delete map[key];
  writeSessionMap(map);
  return true;
});

// ---------- Настройки самого лаунчера (папка игры, автозапуск, язык, тема) ----------
const DEFAULT_LAUNCHER_SETTINGS = {
  installPath: path.join(app.getPath('userData'), 'downloads'),
  autostart: false,
  fullscreen: true,
  trayOnClose: false,
  language: 'ru',
  theme: 'violet',
};

function readLauncherSettings() {
  try {
    return { ...DEFAULT_LAUNCHER_SETTINGS, ...JSON.parse(fs.readFileSync(LAUNCHER_SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_LAUNCHER_SETTINGS };
  }
}

function writeLauncherSettings(settings) {
  fs.writeFileSync(LAUNCHER_SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function syncAutostart(enabled) {
  try {
    // Windows: добавляет/убирает лаунчер из автозагрузки (HKCU\...\Run)
    app.setLoginItemSettings({ openAtLogin: !!enabled });
  } catch {
    /* не Windows / нет прав — просто пропускаем */
  }
}

// ---------- Сворачивание в трей ----------
let tray = null;
let isQuittingFromTray = false;

function createTray() {
  if (tray) return tray;
  const { nativeImage, Tray, Menu } = require('electron');
  try {
    const iconPath = path.join(__dirname, 'assets', 'iconClient.ico');
    const img = nativeImage.createFromPath(iconPath);
    tray = new Tray(img);
    const ctx = Menu.buildFromTemplate([
      { label: 'Открыть лаунчер', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: 'Выход', click: () => { isQuittingFromTray = true; app.quit(); } },
    ]);
    tray.setToolTip('SAMOT Launcher');
    tray.setContextMenu(ctx);
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (e) {
    console.warn('tray init failed', e);
    return null;
  }
  return tray;
}

function destroyTray() {
  if (tray) { try { tray.destroy(); } catch { /* уже закрыт */ } tray = null; }
}

// ---------- Настройки лаунчера ----------
ipcMain.handle('settings:get', () => readLauncherSettings());

ipcMain.handle('settings:set', (_event, patch) => {
  const next = { ...readLauncherSettings(), ...(patch || {}) };
  writeLauncherSettings(next);
  if (patch && 'autostart' in patch) syncAutostart(next.autostart);
  return next;
});

// ---------- Полноэкранный режим ----------
ipcMain.handle('window:set-fullscreen', (_event, enabled) => {
  if (mainWindow) {
    if (enabled) mainWindow.maximize();
    else mainWindow.unmaximize();
  }
  const next = { ...readLauncherSettings(), fullscreen: !!enabled };
  writeLauncherSettings(next);
  return next;
});

ipcMain.handle('settings:choose-install-path', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Папка для установки игры',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return readLauncherSettings();
  const next = { ...readLauncherSettings(), installPath: res.filePaths[0] };
  writeLauncherSettings(next);
  return next;
});

// ---------- Вход через Google (OAuth в системном браузере + локальный callback) ----------
let oauthServer = null;

function closeOauthServer() {
  try { oauthServer?.close(); } catch { /* уже закрыт */ }
  oauthServer = null;
}

ipcMain.handle('auth:google-start', async (event) => {
  closeOauthServer();
  const { createServer } = require('http');
  const sender = event.sender;

  oauthServer = createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${OAUTH_PORT}`);
      if (url.pathname === '/callback' && url.searchParams.get('code')) {
        const code = url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Вход выполнен</title><style>body{font-family:sans-serif;color:#111;display:grid;place-items:center;min-height:100vh;background:#f4f4f6;text-align:center}</style></head><body><div><h1 style="color:#0b8e3f; font-size:2.4rem; margin:0 0 12px">Вход выполнен! ✅</h1><p style="color:#444">Эта вкладка закроется автоматически. Можно вернуться в лаунчер.</p></div><script>setTimeout(function(){try{window.close();}catch(e){}},700);</script></body></html>');
        sender.send('auth:google-code', { code });
        closeOauthServer();
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    } catch {
      res.writeHead(500);
      res.end();
    }
  });

  await new Promise((resolve, reject) => {
    oauthServer.once('error', reject);
    oauthServer.listen(OAUTH_PORT, '127.0.0.1', resolve);
  });

  // если пользователь не вернётся — закрываем сервер через 5 минут
  setTimeout(closeOauthServer, 5 * 60 * 1000);
  return { port: OAUTH_PORT };
});

ipcMain.handle('auth:google-open', (_event, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); });

// ---------- Скачивание файла с редиректами и прогрессом ----------
async function downloadWithRedirects(url, destPath, onProgress, projectId) {
  await waitWhilePaused(projectId);

  // --- Докачка с места обрыва: .part рядом с финальным файлом,
  // доверяем ему только если он был скачан с нашей же ссылки ---
  const partPath = destPath + '.part';
  const metaPath = partPath + '.meta';
  let have = 0;
  try { have = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0; } catch {}
  if (have > 0) {
    let okMeta = false;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      okMeta = meta && meta.url === url;
    } catch {}
    if (!okMeta) { try { fs.unlinkSync(partPath); } catch {}; try { fs.unlinkSync(metaPath); } catch {}; have = 0; }
  }

  return new Promise((resolve, reject) => {
    const doRequest = (target, depth) => {
      if (depth > 6) return reject(new Error('Слишком много редиректов'));
      const client = target.startsWith('https://') ? https : http;
      const headers = have > 0 ? { Range: 'bytes=' + have + '-' } : {};
      client
        .get(target, { headers }, (res) => {
          const status = res.statusCode || 0;

          // Редирект? (Range переносим на следующий запрос)
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.resume();
            const next = new URL(res.headers.location, target).toString();
            return doRequest(next, depth + 1);
          }

          if (have > 0 && status === 200) {
            // сервер проигнорировал Range — качаем заново
            have = 0;
            try { fs.unlinkSync(partPath); } catch {}
            try { fs.unlinkSync(metaPath); } catch {}
          } else if (have > 0 && status === 416) {
            // невалидный диапазон — с нуля этим же хостом
            have = 0;
            try { fs.unlinkSync(partPath); } catch {}
            try { fs.unlinkSync(metaPath); } catch {}
            res.resume();
            return doRequest(target, depth);
          } else if (status !== 200 && status !== 206) {
            res.resume();
            return reject(new Error(`Сервер ответил ${status}`));
          }

          try { fs.writeFileSync(metaPath, JSON.stringify({ url })); } catch {}
          trackResponse(projectId, res);

          const len = parseInt(res.headers['content-length'] || '0', 10);
          const total = have > 0 ? have + len : len;
          let received = have;
          const startedAt = Date.now();

          const out = fs.createWriteStream(partPath, { flags: have > 0 ? 'a' : 'w' });
          res.on('data', (chunk) => {
            received += chunk.length;
            const elapsed = (Date.now() - startedAt) / 1000;
            onProgress({
              received,
              total,
              percent: total > 0 ? Math.floor((received / total) * 100) : null,
              speedBps: elapsed > 0 ? received / elapsed : 0,
            });
          });
          res.pipe(out);
          out.on('finish', () => out.close(() => {
            try { fs.renameSync(partPath, destPath); } catch (e) { return reject(e); }
            try { fs.unlinkSync(metaPath); } catch {}
            resolve(destPath);
          }));
          out.on('error', reject);
        })
        .on('error', reject);
    };
    doRequest(url, 0);
  });
}

function fileNameFromUrl(url) {
  try {
    const base = path.basename(new URL(url).pathname);
    return base && base.includes('.') ? base : 'game-setup.exe';
  } catch {
    return 'game-setup.exe';
  }
}

// ---------- IPC ----------
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('game:get-all-install-states', () => readInstallMap());

ipcMain.handle('game:download', async (event, { url, version, projectId }) => {
  if (!url) throw new Error('URL для скачивания не задан (см. админку → Настройки)');

  const installRoot = readLauncherSettings().installPath;
  const downloadsDir = path.join(installRoot, 'MyGame');
  fs.mkdirSync(downloadsDir, { recursive: true });
  const destPath = path.join(downloadsDir, fileNameFromUrl(url));

  await downloadWithRedirects(url, destPath, (p) => {
    event.sender.send('game:progress', p);
  }, projectId);

  const stat = fs.statSync(destPath);
  const state = {
    installed: true,
    version: version || null,
    path: destPath,
    size: stat.size,
    downloadedAt: new Date().toISOString(),
  };
  setProjectInstall(projectId, state);
  return state;
});


// ---------- Манифест-игра: установка/проверка (streaming download + SHA-256 verify) ----------
function safeSlug(s) {
  const v = String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return v || '';
}

function gameDirFor(projectId, slug) {
  const base = readLauncherSettings().installPath || path.join(app.getPath('userData'), 'games');
  const key = safeSlug(slug) || String(projectId || 'shared').replace(/[^a-zA-Z0-9_-]/g, '_') || 'shared';
  return path.join(base, key);
}

// Одноразовая миграция: перенести игру из %APPDATA%\<app>\game-install\<pid> в каталог из настроек

function ensureGameDir(projectId, slug) {
  const dir = gameDirFor(projectId, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle('game:migrate-install-dir', async (_event, arg) => {
  const projectId = arg && typeof arg === 'object' ? arg.projectId : arg;
  const slug = arg && typeof arg === 'object' ? arg.slug : undefined;
  const pid = String(Number(projectId) || projectId || '');
  const base = readLauncherSettings().installPath || path.join(app.getPath('userData'), 'games');
  const target = gameDirFor(projectId, slug);
  const candidates = [
    path.join(base, String(Number(pid) || pid)),
    path.join(base, String(Number(pid) || Number(pid)) || String(pid)),
    path.join(app.getPath('userData'), 'game-install', String(Number(pid) || pid)),
  ];
  let moved = null;
  if (fs.existsSync(target)) {
    moved = target; // уже на месте
  } else {
    for (const src of candidates) {
      if (!src || !fs.existsSync(src)) continue;
      try { fs.cpSync(src, target, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); moved = target; console.log('[migrate]', src, '→', target); break; } catch (e) { console.warn('[migrate] failed', src, e?.message || e); }
    }
  }
  // обновить install-state path
  try {
    const map = readInstallMap();
    const key = Number(projectId) || projectId;
    if (map[key]) { map[key] = { ...map[key], path: target }; writeInstallMap(map); }
    if (map[String(key)]) { map[String(key)] = { ...map[String(key)], path: target }; writeInstallMap(map); }
  } catch { /* not critical */ }
  return { ok: true, moved, target };
});

ipcMain.handle('game:install-dir', (_event, arg) => { const projectId = arg && typeof arg === 'object' ? arg.projectId : arg; const slug = arg && typeof arg === 'object' ? arg.slug : undefined; return { path: ensureGameDir(projectId, slug) }; });

ipcMain.handle('game:uninstall-game', async (_event, arg) => {
  const projectId = arg && typeof arg === 'object' ? arg.projectId : arg;
  const slug = arg && typeof arg === 'object' ? arg.slug : undefined;
  const pid = Number(projectId) || projectId;
  const base = readLauncherSettings().installPath || path.join(app.getPath('userData'), 'games');
  const key = safeSlug(slug) || String(pid || 'shared').replace(/[^a-zA-Z0-9_-]/g, '_') || 'shared';
  const dirs = [path.join(base, key), path.join(app.getPath('userData'), 'game-install', key)];
  const removed = [];
  for (const dir of dirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); removed.push(dir); } catch {}
  }
  const map = readInstallMap();
  delete map[key];
  delete map[String(pid)];
  delete map[Number(pid)];
  writeInstallMap(map);
  return { ok: true, removed };
});

// SHA-256 of a file (hex)
function sha256File(absPath) {
  const crypto = require('crypto');
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(absPath);
    stream.on('error', reject);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

ipcMain.handle('game:verify-cache', async (_event, arg) => {
  const manifest = arg && typeof arg === 'object' && 'manifest' in arg ? arg.manifest : arg;
  const projectId = arg && typeof arg === 'object' && 'manifest' in arg ? arg.projectId : undefined;
  const slug = arg && typeof arg === 'object' && 'manifest' in arg ? arg.slug : (arg && typeof arg === 'object' ? arg.slug : undefined);
  if (!manifest || !Array.isArray(manifest.files)) return { ok: false, error: 'invalid manifest' };
  const root = ensureGameDir(projectId, slug);
  const report = [];
  for (const f of manifest.files) {
    const abs = path.join(root, f.path);
    if (!fs.existsSync(abs)) { report.push({ path: f.path, ok: false, missing: true, size: 0, expectedSize: f.size }); continue; }
    const stat = fs.statSync(abs);
    const sha = await sha256File(abs);
    const ok = sha.toLowerCase() === String(f.sha256).toLowerCase();
    report.push({ path: f.path, ok, size: stat.size, expectedSize: f.size, sha256: sha });
  }
  const missing = report.filter((r) => r.missing).length;
  const corrupt = report.filter((r) => !r.ok && !r.missing).length;
  return { ok: corrupt === 0 && missing === 0, total: report.length, missing, corrupt, report };
});

// Пауза/продолжение скачивания (по projectId). Стримы ответа можно
// реально останавливать (response.pause()), поэтому байты перестают течь.
const pausedDownloads = new Set();
const activeResponses = new Map(); // key -> Set<response>

const pidKey = (pid) => String(pid == null ? '' : pid);

function waitWhilePaused(projectId) {
  const key = pidKey(projectId);
  return new Promise((resolve) => {
    const tick = () => {
      if (!pausedDownloads.has(key)) return resolve();
      setTimeout(tick, 200);
    };
    tick();
  });
}

function trackResponse(projectId, res) {
  const key = pidKey(projectId);
  if (!key) return;
  if (!activeResponses.has(key)) activeResponses.set(key, new Set());
  const set = activeResponses.get(key);
  set.add(res);
  res.on('close', () => { const s = activeResponses.get(key); if (s) s.delete(res); });
  if (pausedDownloads.has(key)) { try { res.pause(); } catch {} }
}

ipcMain.handle('game:toggle-pause', (_event, arg) => {
  const pid = arg && typeof arg === 'object' ? arg.projectId : arg;
  const key = pidKey(pid);
  if (!key) return { ok: false, paused: false };
  const now = !pausedDownloads.has(key);
  if (now) pausedDownloads.add(key); else pausedDownloads.delete(key);
  const streams = activeResponses.get(key);
  if (streams) for (const res of streams) { try { now ? res.pause() : res.resume(); } catch {} }
  return { ok: true, paused: now };
});
ipcMain.handle('game:pause-state', (_event, arg) => {
  const pid = arg && typeof arg === 'object' ? arg.projectId : arg;
  return { paused: pausedDownloads.has(pidKey(pid)) };
});

// Манифест-загрузка: скачать недостающие/сбитые файлы
async function downloadOneWithVerify(url, destPath, f, event, doneBytesAcc, totalBytes, downloadedCount, totalFiles, projectId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await waitWhilePaused(projectId);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      // --- Докачка с места обрыва (переживает перезапуск лаунчера) ---
      // .part хранится на диске; доверяем ему только если рядом лежит .part.meta
      // с теми же size/sha256, что и в текущем манифесте. Иначе — с нуля.
      const partPath = destPath + '.part';
      const metaPath = partPath + '.meta';
      const expectedSha = String(f?.sha256 || '').toLowerCase();
      const expectedSize = Number(f?.size) > 0 ? Number(f.size) : 0;
      let have = 0;
      try { have = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0; } catch {}
      if (!have) { try { fs.unlinkSync(metaPath); } catch {} } // осиротевшая мета
      let trusted = !!(expectedSize && expectedSha);
      if (trusted) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          trusted = meta && String(meta.sha256 || '').toLowerCase() === expectedSha && Number(meta.size) === expectedSize;
        } catch { trusted = false; }
      }
      if (have > expectedSize || (have > 0 && !trusted)) {
        try { fs.unlinkSync(partPath); } catch {}
        try { fs.unlinkSync(metaPath); } catch {}
        have = 0;
      }
      const alreadyComplete = trusted && expectedSize > 0 && have === expectedSize;
      if (!alreadyComplete) {
        try { fs.writeFileSync(metaPath, JSON.stringify({ sha256: expectedSha, size: expectedSize })); } catch {}
      }
      // ----------------------------------------------------------------

      if (alreadyComplete) {
        // Пак/файл уже докачан в прошлый раз (например, лаунчер закрыли до очистки) — сразу к проверке SHA
        if (event) try {
          event.sender.send('game:progress', { path: f.path, ok: true, totalBytes, doneBytes: doneBytesAcc.value + expectedSize, currentFile: downloadedCount + 1, totalFiles });
        } catch {}
      } else {
        let received = 0;
        let effectiveResume = (trusted && have > 0 && have < expectedSize) ? have : 0;
        const r = await new Promise((resolve, reject) => {
          const follow = (target, depth) => {
            const m = target.startsWith('http:') ? require('http') : require('https');
            const headers = effectiveResume > 0 ? { Range: 'bytes=' + effectiveResume + '-' } : {};
            m.get(target, { headers }, (res) => {
              const sc = res.statusCode || 0;
              const loc = res.headers.location;
              if ([301, 302, 303, 307, 308].includes(sc) && loc) {
                res.resume();
                if (depth >= 6) return reject(new Error('redirect limit'));
                follow(new URL(loc, target).toString(), depth + 1);
                return;
              }
              if (effectiveResume > 0 && sc === 200) {
                // сервер проигнорировал Range — начинаем заново этим же ответом
                try { fs.unlinkSync(partPath); } catch {}
                effectiveResume = 0;
              } else if (effectiveResume > 0 && sc === 416) {
                // диапазон невалиден (файл на сервере сменился) — заново
                try { fs.unlinkSync(partPath); } catch {}
                try { fs.unlinkSync(metaPath); } catch {}
                effectiveResume = 0;
                res.resume();
                follow(target, depth);
                return;
              } else if (sc !== 200 && sc !== 206) {
                res.resume();
                return reject(new Error('HTTP ' + sc));
              }
              resolve(res);
            }).on('error', reject);
          };
          follow(url, 0);
        });
        trackResponse(projectId, r);
        received = effectiveResume;
        const out = fs.createWriteStream(partPath, { flags: effectiveResume > 0 ? 'a' : 'w' });
        await new Promise((resolve, reject) => {
          r.on('data', (chunk) => {
            received += chunk.length;
            out.write(chunk);
            if (event) try {
              event.sender.send('game:progress', { path: f.path, ok: true, totalBytes, doneBytes: doneBytesAcc.value + received, currentFile: downloadedCount + 1, totalFiles });
            } catch {}
          });
          r.on('end', () => out.end(() => resolve()));
          r.on('error', reject);
          out.on('error', reject);
        });
      }
      const sha = await sha256File(partPath);
      if (sha.toLowerCase() !== expectedSha) {
        try { fs.unlinkSync(partPath); } catch {}
        try { fs.unlinkSync(metaPath); } catch {}
        if (attempt === 3) return { ok: false, error: 'SHA-256 mismatch (attempt ' + attempt + ')' };
        await sleep(500 * attempt);
        continue;
      }
      fs.renameSync(partPath, destPath);
      try { fs.unlinkSync(metaPath); } catch {}
      return { ok: true };
    } catch (err) {
      // Сеть упала / обрыв — НЕ удаляем .part/.meta: при следующей попытке
      // (или после перезапуска лаунчера) докачка пойдёт с места обрыва.
      if (attempt === 3) return { ok: false, error: String(err?.message || err) };
      await sleep(500 * attempt);
    }
  }
  return { ok: false, error: 'unknown' };
}

// =====================================================
//  PACK-МАНИФЕСТ (--packs) — скачиваем только нужные паки, распаковываем точечно
// =====================================================
function sha256Buf(buf) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function downloadManifestPack(event, manifest, baseUrl, projectId, slug) {
  const root = ensureGameDir(projectId, slug);
  const stateFile = path.join(root, '.install-state.json');
  let state = { version: manifest.version || null, files: [], packs: [] };
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* свежая установка */ }

  const failures = [];
  const total = manifest.files.length;
  const totalBytes = manifest.files.reduce((a, x) => a + Number(x.size || 0), 0);
  const filesState = () => state.files || [];

  // 1) найти битые/отсутствующие файлы
  const stale = [];
  for (const f of manifest.files) {
    const abs = path.join(root, f.path);
    let ok = false;
    if (fs.existsSync(abs)) {
      const rec = filesState().find((x) => x.path === f.path && x.sha256 === f.sha256);
      if (rec) {
        try {
          const sha = await sha256File(abs);
          if (sha.toLowerCase() === String(f.sha256).toLowerCase()) ok = true;
        } catch { /* считаем битым */ }
      }
    }
    if (!ok) stale.push(f);
  }

  const doneAcc = { value: totalBytes - stale.reduce((a, x) => a + Number(x.size || 0), 0) };

  if (!stale.length) {
    state.version = manifest.version || state.version;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    if (projectId) {
      setProjectInstall(Number(projectId) || projectId, {
        installed: true,
        version: manifest.version || null,
        path: ensureGameDir(projectId),
        size: totalBytes,
        downloadedAt: new Date().toISOString(),
        entryPoint: manifest.entryPoint || null,
      });
    }
    event.sender.send('game:progress', { ok: true, skipped: true, currentFile: total, totalFiles: total, totalBytes, doneBytes: totalBytes });
    return { ok: true, failures: [], downloaded: 0, total, alreadyUpToDate: true };
  }

  // 2) какие паки нужны
  const staleSet = new Set(stale.map((f) => f.path));
  const neededPackIds = [...new Set(stale.map((f) => f.pack))];
  const packsNeeded = (manifest.packs || []).filter((p) => neededPackIds.includes(p.id));

  let downloaded = 0;
  const packTotal = packsNeeded.length;
  let packIndex = 0;

  for (const pack of packsNeeded) {
    packIndex++;
    await waitWhilePaused(projectId);
    const packUrl = new URL(pack.id, baseUrl).toString();
    // Кладём пак во временное имя БЕЗ .part — служебный .part функция дописывает сама
    const tmpPath = path.join(root, '.pack-' + pack.id);
    const legacyTmpPath = tmpPath + '.part';

    // Лаунчер могли закрыть уже ПОСЛЕ докачки пака (или до старта докачки):
    // ищем готовый/переименованный пак и пропускаем сеть, если SHA совпадает.
    let packFile = tmpPath;
    let preReady = null;
    for (const cand of [tmpPath, legacyTmpPath]) {
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).size === Number(pack.size || 0)) {
          const sha = await sha256File(cand);
          if (sha.toLowerCase() === String(pack.sha256 || '').toLowerCase()) { preReady = cand; break; }
        }
      } catch { /* считаем, что пака нет */ }
    }

    if (preReady) {
      if (preReady !== tmpPath) {
        try { fs.renameSync(preReady, tmpPath); } catch { packFile = preReady; }
      }
      try { event.sender.send('game:progress', { path: pack.id, ok: true, pack: pack.id, packIndex, packTotal, totalBytes, doneBytes: doneAcc.value + Number(pack.size || 0), currentFile: downloaded + 1, totalFiles: total }); } catch {}
    }

    const res = preReady
      ? { ok: true }
      : await downloadOneWithVerify(packUrl, tmpPath, { path: pack.id, sha256: pack.sha256, size: pack.size }, event, doneAcc, totalBytes, downloaded, total, projectId);
    if (!res.ok) { failures.push({ path: pack.id, error: res.error }); continue; }

    // 3) распаковать только битые файлы из пака
    try {
      const zip = new AdmZip(packFile);
      for (const f of manifest.files) {
        if (!staleSet.has(f.path)) continue;
        if (f.pack !== pack.id) continue;
        const entry = zip.getEntry(f.path);
        if (!entry) { failures.push({ path: f.path, error: 'pack не содержит файл (' + f.path + ')' }); continue; }
        const buf = entry.getData();
        const sha = sha256Buf(buf);
        if (sha.toLowerCase() !== String(f.sha256 || '').toLowerCase()) {
          failures.push({ path: f.path, error: 'SHA-256 не совпал после распаковки' });
          continue;
        }
        const abs = path.join(root, f.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, buf);
        state.files = filesState().filter((x) => x.path !== f.path);
        state.files.push(f);
        downloaded++;
        doneAcc.value += Number(f.size || 0);
        try { event.sender.send('game:progress', { path: f.path, ok: true, pack: pack.id, packIndex, packTotal, totalBytes, doneBytes: doneAcc.value, currentFile: downloaded, totalFiles: total }); } catch {}
      }
      state.packs = (state.packs || []).filter((x) => x.id !== pack.id);
      state.packs.push({ id: pack.id, sha256: pack.sha256, files: pack.files || 0 });
    } catch (err) {
      failures.push({ path: pack.id, error: String(err?.message || err) });
    } finally {
      // Удаляем временный пак целиком (и старые .part-варианты, если остались)
      for (const t of [packFile, tmpPath, tmpPath + '.part', tmpPath + '.part.meta']) {
        try { fs.unlinkSync(t); } catch {}
      }
    }
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }

  state.version = manifest.version || state.version;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  if (failures.length === 0 && projectId) {
    setProjectInstall(Number(projectId) || projectId, {
      installed: true,
      version: manifest.version || null,
      path: ensureGameDir(projectId, slug),
      size: totalBytes,
      downloadedAt: new Date().toISOString(),
      entryPoint: manifest.entryPoint || null,
    });
  }
  return { ok: failures.length === 0, failures, downloaded, total, packMode: true };
}

ipcMain.handle('game:download-manifest', async (event, { manifest, baseUrl, projectId, slug }) => {
  if (manifest && Array.isArray(manifest.packs) && manifest.packs.length) {
    if (!baseUrl) throw new Error('baseUrl не задан');
    return downloadManifestPack(event, manifest, baseUrl, projectId, slug);
  }
  if (!manifest || !Array.isArray(manifest.files) || !baseUrl) throw new Error('Некорректные параметры');
  const root = ensureGameDir(projectId, slug);
  const stateFile = path.join(root, '.install-state.json');
  let state = { version: manifest.version || null, files: [] };
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* fresh */ }

  const failures = [];
  const total = manifest.files.length;
  let downloaded = 0;

  const doneBytesAcc = { value: 0 };
  const totalBytesAcc = manifest.files.reduce((a, x) => a + Number(x.size || 0), 0);
  for (const f of manifest.files) {
    await waitWhilePaused(projectId);
    const abs = path.join(root, f.path);
    const asset = f.assetName || String(f.path).replace(/\\/g, '_').replace(/\//g, '__');
    // уже на диске и хэш совпадает?
    let needDownload = true;
    if (fs.existsSync(abs) && state.files.find((x) => x.path === f.path && x.sha256 === f.sha256)) {
      try {
        const sha = await sha256File(abs);
        if (sha.toLowerCase() === String(f.sha256).toLowerCase()) needDownload = false;
      } catch { needDownload = true; }
    }
    if (!needDownload) {
      downloaded++;
      doneBytesAcc.value += Number(f.size || 0);
      event.sender.send('game:progress', { path: f.path, ok: true, skipped: true, totalBytes: totalBytesAcc, doneBytes: doneBytesAcc.value, currentFile: downloaded, totalFiles: total });
      continue;
    }
    const url = new URL(asset, baseUrl).toString();
    const res = await downloadOneWithVerify(url, abs, f, event, doneBytesAcc, totalBytesAcc, downloaded, total, projectId);
    if (!res.ok) {
      failures.push({ path: f.path, error: res.error });
      continue;
    }
    doneBytesAcc.value += Number(f.size || 0);
    state.files = state.files.filter((x) => x.path !== f.path);
    state.files.push({ ...f });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    downloaded++;
  }

  state.version = manifest.version || state.version;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  if (failures.length === 0 && projectId) {
    setProjectInstall(Number(projectId) || projectId, {
      installed: true,
      version: (manifest && manifest.version) || null,
      path: ensureGameDir(projectId, slug),
      downloadedAt: new Date().toISOString(),
    });
  }
  return { ok: failures.length === 0, failures, downloaded, total };
});

ipcMain.handle('game:play', async (_event, arg) => {
  const projectId = arg && typeof arg === 'object' ? arg.projectId : arg;
  const slug = arg && typeof arg === 'object' ? arg.slug : undefined;
  const state = readInstallState(projectId);
  let legacy = null;
  if (!state.installed) { try { const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); if (raw && raw.path) legacy = raw; } catch {} }
  const effective = state.installed ? state : (legacy || state);
  if (!effective.installed || !effective.path || !fs.existsSync(effective.path)) {
    return { ok: false, error: 'Файл игры не найден. Скачайте её заново.' };
  }
  // pack-режим: запускаем точку входа из манифеста
  if (effective.entryPoint && effective.path) {
    const exe = path.join(effective.path, effective.entryPoint);
    if (fs.existsSync(exe) && /\.exe$/i.test(exe)) {
      const err = await shell.openPath(exe);
      return err ? { ok: false, error: err } : { ok: true };
    }
  }
  // .exe/.msi — запускаем (установщик или игра), остальное — показываем в папке
  if (/\.(exe|msi)$/i.test(effective.path)) {
    const err = await shell.openPath(effective.path);
    return err ? { ok: false, error: err } : { ok: true };
  }
  shell.showItemInFolder(effective.path);
  return { ok: true };
});

ipcMain.handle('game:reveal', (_event, arg) => {
  const projectId = arg && typeof arg === 'object' ? arg.projectId : arg;
  const slug = arg && typeof arg === 'object' ? arg.slug : undefined;
  const state = readInstallState(projectId);
  if (state.path && fs.existsSync(state.path)) return shell.showItemInFolder(state.path);
  // legacy fallback
  try { const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); if (raw && raw.path && fs.existsSync(raw.path)) return shell.showItemInFolder(raw.path); } catch {}
  shell.openPath(readLauncherSettings().installPath);
});

// ---------- Авто-обновление клиента ----------
// Открыть ссылку во внешнем браузере (не показывать в UI)
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// ---------- Windows Toast: доступно обновление ----------
ipcMain.on('app:notify-update', (event, { version }) => {
  const { Notification } = require('electron');
  try {
    const n = new Notification({
      title: 'SAMOT Launcher',
      body: 'Доступно обновление до v' + (version || '?') + '. Нажмите, чтобы открыть лаунчер.',
      icon: path.join(__dirname, 'assets', 'iconClient.png'),
      silent: false,
    });
    n.on('click', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
    n.show();
  } catch (e) {
    console.error('notify-update failed', e);
  }
});

// Скачать свежий установщик и запустить его в тихом режиме, затем выйти.
// NSIS /S: текущая версия будет молча заменена новой.
ipcMain.handle('update:download-and-run', async (event, url, expectedSha256) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Некорректный URL обновления');
  const tmp = path.join(app.getPath('temp'), `samot-update-${Date.now()}.exe`);
  await downloadWithRedirects(url, tmp, (p) => {
    try { event.sender.send('update:progress', p); } catch { /* окно могло закрыться */ }
  });
  if (expectedSha256 && String(expectedSha256).trim()) {
    const actual = await sha256File(tmp);
    if (String(actual).toLowerCase() !== String(expectedSha256).trim().toLowerCase()) {
      try { fs.unlinkSync(tmp); } catch {}
      throw new Error('SHA-256 обновления не совпадает — установка отменена');
    }
  }
  const child = spawn(tmp, ['/S'], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 1000);
  return { ok: true };
});

ipcMain.handle('app:pick-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Куда скачать игру',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

// ---------- Согласие (safeStorage, надёжное persist-хранилище) ----------
const CONSENT_FILE = path.join(app.getPath('userData'), 'consent.json');

ipcMain.handle('consent:read', () => {
  try { return JSON.parse(fs.readFileSync(CONSENT_FILE, 'utf8')); } catch { return {}; }
});

ipcMain.handle('consent:write', (_e, email) => {
  if (!email || typeof email !== 'string') return { ok: false };
  try {
    const obj = fs.existsSync(CONSENT_FILE) ? JSON.parse(fs.readFileSync(CONSENT_FILE, 'utf8')) : {};
    obj[String(email).toLowerCase()] = { at: Date.now(), version: 1 };
    fs.writeFileSync(CONSENT_FILE, JSON.stringify(obj), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

ipcMain.handle('consent:clear', () => {
  try { fs.unlinkSync(CONSENT_FILE); } catch {}
  return { ok: true };
});

app.whenReady().then(() => {
  syncAutostart(readLauncherSettings().autostart);
  if (process.argv.includes('--tour')) createAdminPreviewWindow();
  else createWindow(process.argv.includes('--demo-user'));
});
app.on('window-all-closed', () => {
  // если трей включён — приложение остаётся жить в трее
  if (readLauncherSettings().trayOnClose) return;
  app.quit();
});
ipcMain.on('app:quit', () => { isQuittingFromTray = true; app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
