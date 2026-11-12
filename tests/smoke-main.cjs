// Electron-дым для SAMOT Launcher: открывает демо-клиент offscreen, считает console errors.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const report = { client: [], failed: [] };

function wire(win, bucket) {
  win.webContents.on('console-message', (_e, level, message) => {
    const text = String(message);
    if (text.includes('Security Warning') || text.includes('sandbox_bundle')) return;
    if (level >= 2) bucket.push(text);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    report.failed.push('crashed: ' + JSON.stringify(details));
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    report.failed.push('did-fail-load: ' + code + ' ' + desc);
  });
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => finish(), 3500);
  });
}

function finish() {
  console.log('=== SMOKE REPORT (SAMOT Launcher) ===');
  const real = report.client.filter((m) => !/partytown|site\.(js|css)/.test(m));
  console.log('[CLIENT] console errors: ' + real.length);
  real.forEach((m) => console.log('  - ' + m));
  const failed = report.failed.length || real.length;
  console.log(failed ? '\nSMOKE: FAIL' : '\nSMOKE: OK');
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(() => {
  const client = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, partition: 'persist:smoke-client' },
  });
  wire(client, report.client);
  client.loadFile(path.join(ROOT, 'src', 'index.html'), { query: { demo: 'user' } });
});

setTimeout(() => { console.log('SMOKE: TIMEOUT'); app.exit(2); }, 30000);