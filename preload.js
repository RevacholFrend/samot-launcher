// Мост между рендерером и главным процессом (contextIsolation: true)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  // окно
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  maximize: () => ipcRenderer.send('window:maximize'),

  // приложение / игра
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getInstallState: () => ipcRenderer.invoke('game:get-all-install-states'),
  getAllInstallStates: () => ipcRenderer.invoke('game:get-all-install-states'),
  downloadGame: (url, version, projectId, slug) =>
    ipcRenderer.invoke('game:download', { url, version, projectId, slug }),
  playGame: (projectId, slug) => ipcRenderer.invoke('game:play', { projectId, slug }),
  revealGame: (projectId, slug) => ipcRenderer.invoke('game:reveal', { projectId, slug }),
  uninstallGame: (projectId, slug) => ipcRenderer.invoke('game:uninstall-game', { projectId, slug }),

  // настройки лаунчера
  getLauncherSettings: () => ipcRenderer.invoke('settings:get'),
  setLauncherSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseInstallPath: () => ipcRenderer.invoke('settings:choose-install-path'),
  setFullscreen: (enabled) => ipcRenderer.invoke('window:set-fullscreen', enabled),
  setTrayOnClose: (enabled) => ipcRenderer.invoke('settings:set', { trayOnClose: !!enabled }),
  quitApp: () => ipcRenderer.send('app:quit'),
  settingsGet: () => ipcRenderer.invoke('settings:get'),

  // вход через Google
  googleSignInStart: () => ipcRenderer.invoke('auth:google-start'),
  googleSignInOpen: (url) => ipcRenderer.invoke('auth:google-open', url),
  // манифест-игра (Steam-подобная загрузка)
  installDir: () => ipcRenderer.invoke('game:install-dir'),
  migrateInstallDir: (projectId, slug) => ipcRenderer.invoke('game:migrate-install-dir', { projectId, slug }),
  consentRead: () => ipcRenderer.invoke('consent:read'),
  consentWrite: (email) => ipcRenderer.invoke('consent:write', email),
  consentClear: () => ipcRenderer.invoke('consent:clear'),
  verifyCache: (manifest, projectId, slug) => ipcRenderer.invoke('game:verify-cache', { manifest, projectId, slug }),
  downloadManifest: (manifest, baseUrl, projectId, slug) => ipcRenderer.invoke('game:download-manifest', { manifest, baseUrl, projectId, slug }),
  togglePauseDownload: (projectId) => ipcRenderer.invoke('game:toggle-pause', { projectId }),
  pauseState: (projectId) => ipcRenderer.invoke('game:pause-state', { projectId }),

  onGoogleCode: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('auth:google-code', listener);
    return () => ipcRenderer.removeListener('auth:google-code', listener);
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // уведомление Windows о новом апгрейде
  notifyUpdate: (version) => ipcRenderer.send('app:notify-update', { version: String(version || '') }),
  // авто-обновление клиента
  downloadAndRunUpdate: (url, sha256) => ipcRenderer.invoke('update:download-and-run', url, sha256),
  onUpdateProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },

  // безопасное хранилище сессии (через safeStorage на стороне main)
  sessionRead: (key) => ipcRenderer.invoke('auth:session-read', key),
  sessionWrite: (key, value) => ipcRenderer.invoke('auth:session-write', key, value),
  sessionClear: (key) => ipcRenderer.invoke('auth:session-clear', key),

  // прогресс скачивания: cb({ received, total, percent, speedBps })
  onDownloadProgress: (cb) => {
    const listener = (_e, data) => {
      const received = Number(data?.doneBytes ?? data?.received ?? 0);
      const total = Number(data?.totalBytes ?? data?.total ?? 0);
      const percent = total > 0 ? Math.round((received / total) * 100) : (Number(data?.percent ?? 0));
      cb({ received, total, percent, speedBps: Number(data?.speedBps ?? 0) });
    };
    ipcRenderer.on('game:progress', listener);
    return () => ipcRenderer.removeListener('game:progress', listener);
  },
});
