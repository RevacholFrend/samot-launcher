// =====================================================
//  SAMOT LAUNCHER — логика клиента
//  Мультипроектность • Проверки при старте • Офлайн-режим • Помнить устройство
// =====================================================
'use strict';

// ---------- Кольцевой буфер логов (уходит в баг-репорт) ----------
const LOG_BUFFER = [];
function logLine(level, parts) {
  try {
    const msg = parts.map((a) => {
      if (a == null) return String(a);
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    LOG_BUFFER.push(new Date().toISOString() + ' [' + level + '] ' + msg);
    if (LOG_BUFFER.length > 120) LOG_BUFFER.shift();
  } catch { /* never break the app for logging */ }
}
const _origConsoleError = console.error.bind(console);
const _origConsoleWarn = console.warn.bind(console);
console.error = (...args) => { logLine('ERROR', args); _origConsoleError(...args); };
console.warn = (...args) => { logLine('WARN', args); _origConsoleWarn(...args); };
const _origConsoleLog = console.log.bind(console);
console.log = (...args) => { logLine('INFO', args); _origConsoleLog(...args); };
window.addEventListener('error', (e) => {
  logLine('ERROR', [(e && e.message) || 'window error']);
  // страховка: если старт умер где угодно, не оставляем сплэш висеть
  try {
    const splash = document.querySelector('#splash-screen');
    const main = document.querySelector('#main-screen');
    const auth = document.querySelector('#auth-screen');
    if (splash && !splash.classList.contains('hidden') && main?.classList.contains('hidden') && auth?.classList.contains('hidden')) {
      splash.classList.add('hidden');
      auth.classList.remove('hidden');
    }
  } catch { /* окружение ещё не разобрано HTML */ }
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason;
  logLine('ERROR', ['unhandledrejection:', (r && (r.stack || r.message)) || String(r)]);
});

const CFG = window.APP_CONFIG;

// ---------- Память сессии с тумблером «Запомнить устройство» ----------
// Простой key-value adapter поверх localStorage — работает везде, включая файл:// в Electron.
// Флаг sb_remember читается при каждом обращении — переключение мгновенное.
const rememberStorage = (() => {
  const mem = new Map();
  const enabled = () => localStorage.getItem('sb_remember') !== '0';

  return {
    getItem(k) {
      return enabled() ? localStorage.getItem(k) : (mem.get(k) ?? null);
    },
    setItem(k, v) {
      if (enabled()) localStorage.setItem(k, v);
      else mem.set(k, String(v));
    },
    removeItem(k) {
      // адресно: удаляем ТОЛЬКО запрошенный ключ — иначе параллельные рефреши
      // (несколько окон одного приложения) выбивают сессию целиком
      try { localStorage.removeItem(k); } catch { /* ignore */ }
      mem.delete(k);
    },
  };
})();

const { createClient } = window.supabase;
const sb = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { storage: rememberStorage, persistSession: true, autoRefreshToken: true, flowType: 'pkce' },
});

// ---------- Временный предпросмотр (?demo=user) ----------
const DEMO_USER = new URLSearchParams(window.location.search).get('demo') === 'user';
const DEMO_DATA = {
  settings: {
    game_name: 'SuperTuxKart', game_version: '1.4.0',
    download_url: 'https://example.com/SuperTuxKart-1.4.0-Setup.exe',
    download_available: 'true',
    update_notes: '— Новый контент: карта «Пустынный каньон»\n— Балансировка бустов и грибов\n— Онлайн-чемпионаты каждые выходные',
    maintenance: 'false', min_launcher_version: '1.0.0',
    media_card: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1200&q=80',
    media_screenshots: JSON.stringify([
      'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=1600&q=80',
      'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?auto=format&fit=crop&w=1600&q=80',
    ]),
    media_release_date: 'Май 2025',
    media_languages: 'RU · EN · DE · FR · ES · PT · ещё 15',
    media_developer: 'Команда SuperTuxKart',
    media_developer_contact: 'hello@supertuxkart.net · https://supertuxkart.net · github.com/supertuxkart',
    media_long_description: '<p><b>SuperTuxKart</b> — безумный аркадный kart-гонщик, где грибы решают исход заезда, а синяя «звёздка» превращает тебя в неуязвимого призрака.</p><p>Гонись по трассам от ледяных пиков до пустынных каньонов, собирай турбо-грибы, обгоняй друзей в локальном или сетевом мультиплеере. Каждый уикенд — онлайн-чемпионат «Гран-при грибов» с таблицей результатов.</p><p>Собрано добровольцами со всего мира и распространяется бесплатно под GPLv3.</p>',
  },
  projects: [{ id: 1, name: 'SuperTuxKart', slug: 'supertuxkart', tagline: 'Аркадные гонки: бешеный дрифт и грибы', logo: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=128&q=80', color: '#ff6b1a' }],
  news: [
    { id: 3, project_id: 1, title: 'Турнир «Гран-при грибов»', tag: 'Турнир', excerpt: 'Приз — 50 000 внутриигровых очков. Регистрация открыта.', body: 'Еженедельный онлайн-чемпионат стартует 22 ноября. Формат: 3 заезда по 3 круга, лучшие 8 гонщиков проходят в финал. Награды получают все участники первой десятки.', image_url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1600&q=80', published_at: new Date(Date.now() - 86400000).toISOString(), active: true },
    { id: 2, project_id: 1, title: 'Патч 1.4 «Пустынный каньон»', tag: 'Патчнот', excerpt: 'Новая карта, баланс грибов, буст на старте.', body: 'Изменения: добавлена карта «Пустынный каньон» с узкими ущельями и боковой трассой через скалы; буст теперь тратится ровно 2 секунды; красный гриб слегка дольше кружит цель; исправлен краш на 4-м круге Ледяного перевала.', image_url: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1600&q=80', published_at: new Date(Date.now() - 3 * 86400000).toISOString(), active: true },
    { id: 1, project_id: 1, title: 'Сезон 3: карты и питомцы', tag: 'Анонс', excerpt: 'Зимний сезон, два новых персонажа и 3 новых трасссы.', body: 'Зимний сезон стартует 1 декабря: ледяные трассы, санки-питомцы и застывшие бусты. Подписывайтесь, чтобы не пропустить закрытый бета-заезд сервера SuperTuxKart Online.', image_url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1600&q=80', published_at: new Date(Date.now() - 5 * 86400000).toISOString(), active: true },
  ],
};

// ---------- i18n ----------
const I18N = {
  ru: {
    tagline: 'Твой мир. Твоя игра. Твой лаунчер.',
    hf1: 'Новости и баннеры прямо в лаунчере',
    hf2: 'Скачивание и обновление игры в один клик',
    hf3: 'Оффлайн-кеш новостей и баннеров',
    tab_login: 'Вход', tab_register: 'Регистрация',
    btn_login: 'Войти', btn_register: 'Создать аккаунт',
    remember_me: 'Запомнить это устройство', or: 'или', google_btn: 'Войти через Google',
    footnote: 'Данные хранятся в вашей собственной базе Supabase.<br />Пароль никогда не покидает её в открытом виде.',
    all_news: 'Все новости', refresh: 'Обновить', projects: 'Проекты', sb_subtitle: 'game launcher',
    notes_label: 'Заметки к обновлению', reveal: 'Открыть папку с игрой',
    settings_title: 'Настройки', sp_app: 'Приложение', sp_install: 'Установка игры',
    autostart: 'Запускать вместе с Windows', language: 'Язык', theme: 'Цветовая схема',
    install_path: 'Куда скачивать игру', browse: 'Обзор…',
    ready: 'Готов к работе', news_updating: 'Обновление новостной ленты…',
    news_updated: 'Новости обновлены', news_error: 'Новости недоступны',
    downloading: 'Скачивание', play: 'Запустить игру', update_to: 'Обновить до', download: 'Скачать игру',
    quit_title: 'Идёт загрузка', quit_text: 'Файлы игры скачиваются. Если закрыть лаунчер сейчас, загрузка прервётся и придётся начать заново.',
    quit_stay: 'Остаться', quit_anyway: 'Всё равно закрыть',
  },
  en: {
    tagline: 'Your world. Your game. Your launcher.',
    hf1: 'News and banners right in the launcher',
    hf2: 'One-click game download and updates',
    hf3: 'Offline news and banner cache',
    tab_login: 'Sign in', tab_register: 'Sign up',
    btn_login: 'Sign in', btn_register: 'Create account',
    remember_me: 'Remember this device', or: 'or', google_btn: 'Sign in with Google',
    footnote: 'Data lives in your own Supabase.<br />Your password never leaves it in plain text.',
    all_news: 'All news', refresh: 'Refresh', projects: 'Projects', sb_subtitle: 'game launcher',
    notes_label: 'Patch notes', reveal: 'Open game folder',
    settings_title: 'Settings', sp_app: 'Application', sp_install: 'Game installation',
    autostart: 'Launch at Windows startup', language: 'Language', theme: 'Color theme',
    install_path: 'Where to install the game', browse: 'Browse…',
    ready: 'Ready', news_updating: 'Refreshing news feed…',
    news_updated: 'News updated', news_error: 'News unavailable',
    downloading: 'Downloading', play: 'Launch game', update_to: 'Update to', download: 'Download game',
    quit_title: 'Download in progress', quit_text: 'Game files are being downloaded. If you close the launcher now, the download will be interrupted and start over.',
    quit_stay: 'Stay', quit_anyway: 'Close anyway',
  },
};
let currentLang = 'ru';
const t = (k) => (I18N[currentLang] && I18N[currentLang][k]) ?? I18N.ru[k] ?? k;

function applyI18n(lang) {
  currentLang = I18N[lang] ? lang : 'ru';
  document.documentElement.lang = currentLang;
  $$('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
  refreshDynamicTexts();
}

function refreshDynamicTexts() {
  renderActionButton();
  setNewsStatus(lastNewsStatusText || t('ready'));
  if (!state.downloading) setStatus(t('ready'), false);
}

// ---------- Темы оформления ----------
const THEMES = (window.THEME_CONFIG && window.THEME_CONFIG.THEMES) || {
  violet: { label: 'Фиолет', accent: '#7c5cff', accent2: '#00e0c6', grad: 'linear-gradient(135deg,#7c5cff 0%,#4f8cff 100%)', swatch: ['#7c5cff', '#4f8cff'] },
};
const DEFAULT_THEME = (window.THEME_CONFIG && window.THEME_CONFIG.DEFAULT_THEME) || Object.keys(THEMES)[0];
let currentTheme = DEFAULT_THEME;
const FIRST_THEME = THEMES[DEFAULT_THEME] ? DEFAULT_THEME : Object.keys(THEMES)[0];

function applyTheme(themeId, persist = true) {
  const th = THEMES[themeId] || THEMES[FIRST_THEME];
  currentTheme = THEMES[themeId] ? themeId : FIRST_THEME;
  const style = document.documentElement.style;
  style.setProperty('--accent', th.accent);
  style.setProperty('--accent-2', th.accent2);
  style.setProperty('--accent-grad', th.grad);
  // цвет проекта, если задан (перекрывает тему акцентом проекта)
  if (state.project?.color) {
    style.setProperty('--project-accent', state.project.color);
  }
  $$('#theme-swatches .swatch').forEach((s) => s.classList.toggle('active', s.dataset.theme === currentTheme));
  if (persist && window.launcher?.setLauncherSettings) {
    window.launcher.setLauncherSettings({ theme: currentTheme }).catch(() => {});
  }
}

function renderSwatches() {
  const wrap = $('#theme-swatches');
  wrap.innerHTML = '';
  Object.entries(THEMES).forEach(([id, th]) => {
    const btn = document.createElement('button');
    btn.className = 'swatch' + (id === currentTheme ? ' active' : '');
    btn.dataset.theme = id;
    btn.title = th.label;
    btn.style.background = th.grad;
    btn.addEventListener('click', () => applyTheme(id));
    wrap.appendChild(btn);
  });
}

// ---------- Утилиты ----------
function btnDisableSelf(selector, disabled, label) {
  const btn = $(selector);
  if (!btn) return;
  btn.disabled = !!disabled;
  if (label) btn.textContent = label;
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function timeAgo(iso) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return currentLang === 'en' ? 'today' : 'сегодня';
  if (days === 1) return currentLang === 'en' ? 'yesterday' : 'вчера';
  if (days < 30) return currentLang === 'en' ? `${days}d ago` : `${days} дн. назад`;
  return d.toLocaleDateString(currentLang === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function timeNow() {
  return new Date().toLocaleTimeString(currentLang === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function cmpSemver(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4300);
}

function friendlyAuthError(message) {
  const m = String(message || '').toLowerCase();
  if (m.includes('invalid login')) return 'Неверный email или пароль.';
  if (m.includes('already registered')) return 'Этот email уже зарегистрирован.';
  if (m.includes('email not confirmed')) return 'Email не подтверждён. Проверьте почту.';
  if (m.includes('password')) return 'Пароль слишком простой — минимум 6 символов.';
  if (m.includes('network') || m.includes('fetch')) return 'Нет связи с сервером. Проверьте интернет.';
  if (m.includes('redirect')) return 'Неверный адрес возврата. Проверьте настройки Redirect URLs в Supabase.';
  if (m.includes('refresh')) return 'Сессия истекла — войдите снова.';
  return message || 'Что-то пошло не так.';
}

// ---------- Статус-бар ----------
let lastNewsStatusText = null;
function setStatus(text, busy = false) {
  $('#sb-left').textContent = text;
}
function setNewsStatus(text) {
  lastNewsStatusText = text;
  $('#sb-right').textContent = text;
  const pill = $('#pill-news');
  if (pill) pill.textContent = '📰 ' + (state.news.length || '—');
}

// ---------- Состояние ----------
const state = {
  user: null,
  view: 'home',        // home | game
  homeSlides: [],
  homeNews: [],
  homeIndex: 0,
  homeTimer: null,
  project: null,           // выбранный проект
  projects: [],            // все проекты
  settings: {},
  news: [],
  installByProject: {},
  liveProgress: null,
  install: { installed: false, version: null, path: null },
  downloading: false,
  downloadingPid: null,
  demoPaused: false,
  offline: false,
  cacheChecked: false,
  banned: null,
};
const SELECTED_KEY = 'samot_selected_project';

// =====================================================
//  СПЛЭШ / STARTUP CHECKS
// =====================================================
const splash = $('#splash');
const splashFill = $('#splash-fill');
const splashStatus = $('#splash-status');
let splashStopped = false;

function splashStep(text, pct) {
  splashStatus.textContent = text;
  splashFill.style.width = Math.max(3, Math.min(100, pct)) + '%';
}

async function hideSplash() {
  if (splashStopped) return;
  splashStopped = true;
  splash.style.transition = 'opacity .4s ease, transform .4s ease';
  splash.style.opacity = '0';
  splash.style.transform = 'scale(.96)';
  setTimeout(() => { splash.classList.add('hidden'); }, 420);
}

// Быстрая проверка доступности Supabase/Auth — с таймаутом
async function checkSupabaseReachable(timeoutMs = 4000) {
  return Promise.race([
    fetch(`${CFG.SUPABASE_URL}/rest/v1/`, { method: 'HEAD' })
      .then((r) => r.ok || r.status === 401 || r.status === 400)
      .catch(() => false),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

// =====================================================
//  ОКНО
// =====================================================
$('#btn-min').addEventListener('click', () => window.launcher.minimize());
$('#btn-max').addEventListener('click', () => window.launcher.maximize());
$('#btn-close').addEventListener('click', () => {
  if (state.downloading) $('#quit-modal').classList.remove('hidden');
  else window.launcher.close();
});
$('#btn-quit-stay').addEventListener('click', () => $('#quit-modal').classList.add('hidden'));
$('#btn-quit-anyway').addEventListener('click', () => { $('#quit-modal').classList.add('hidden'); window.launcher.close(); });
$('#quit-modal').addEventListener('click', (e) => { if (e.target.id === 'quit-modal') $('#quit-modal').classList.add('hidden'); });
$('#news-modal-close').addEventListener('click', () => $('#news-modal').classList.add('hidden'));
$('#news-modal').addEventListener('click', (e) => { if (e.target.id === 'news-modal') $('#news-modal').classList.add('hidden'); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#news-modal').classList.add('hidden'); $('#quit-modal').classList.add('hidden'); $('#settings-panel').classList.add('hidden'); }
});

// =====================================================
//  ВХОД / РЕГИСТРАЦИЯ
// =====================================================
const authScreen = $('#auth-screen');
const mainScreen = $('#main-screen');

$('#remember-me').checked = localStorage.getItem('sb_remember') !== '0';

$$('.auth-tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    $$('.auth-tab').forEach((tEl) => tEl.classList.toggle('active', tEl === tab));
    $('#login-form').classList.toggle('hidden', tab.dataset.tab !== 'login');
    $('#register-form').classList.toggle('hidden', tab.dataset.tab !== 'register');
  })
);

function saveRememberFlag() {
  localStorage.setItem('sb_remember', $('#remember-me').checked ? '1' : '0');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-submit');
  const errEl = $('#login-error');
  errEl.textContent = '';
  saveRememberFlag();
  btn.disabled = true;
  btn.textContent = t('btn_login') + '…';

  const { error } = await sb.auth.signInWithPassword({
    email: $('#login-email').value.trim(),
    password: $('#login-password').value,
  });

  btn.disabled = false;
  btn.textContent = t('btn_login');
  if (error) { errEl.textContent = friendlyAuthError(error.message); return; }
  await enterApp();
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#register-submit');
  const errEl = $('#register-error');
  errEl.textContent = '';
  saveRememberFlag();
  btn.disabled = true;
  btn.textContent = t('btn_register') + '…';

  const { data, error } = await sb.auth.signUp({
    email: $('#reg-email').value.trim(),
    password: $('#reg-password').value,
    options: { data: { nickname: $('#reg-nickname').value.trim() } },
  });

  btn.disabled = false;
  btn.textContent = t('btn_register');
  if (error) { errEl.textContent = friendlyAuthError(error.message); return; }
  if (data.session) {
    await enterApp();
  } else {
    $('.auth-tab[data-tab="login"]').click();
    toast(currentLang === 'en' ? 'Account created! Confirm your email, then sign in.' : 'Аккаунт создан! Подтвердите email по письму, затем войдите.');
  }
});

$('#btn-google').addEventListener('click', async () => {
  const btn = $('#btn-google');
  saveRememberFlag();
  btn.disabled = true;

  try {
    if (window.launcher?.googleSignInStart) {
      // перенаправление через системный браузер + loopback-порт
      const { port } = await window.launcher.googleSignInStart();
      const redirectTo = `http://127.0.0.1:${port}/callback`;

      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;

      const off = window.launcher.onGoogleCode(async ({ code }) => {
        off();
        try {
          const { error: exErr } = await sb.auth.exchangeCodeForSession(code);
          if (exErr) throw exErr;
          toast(currentLang === 'en' ? 'Signed in!' : 'Вход выполнен!');
          btn.disabled = false;
          await enterApp();
        } catch (err) {
          toast(friendlyAuthError(err?.message), true);
          btn.disabled = false;
        }
      });
      await window.launcher.googleSignInOpen(data.url);
    } else {
      // браузерное окружение: Google сам перенаправит на эту страницу с ?code=
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (error) throw error;
    }
  } catch (err) {
    toast(friendlyAuthError(err?.message), true);
    btn.disabled = false;
  }
});

$('#btn-logout').addEventListener('click', async () => {
  state.banned = null; $('#ban-screen')?.classList.add('hidden');
  if (DEMO_USER) { toast('Это временный предпросмотр. Окно можно просто закрыть.'); return; }
  await sb.auth.signOut();
  state.user = null;
  mainScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
});

async function reloadCurrentProject() {
  if (!state.project) return;
  if (DEMO_USER) {
    // демо не ходит в сервер: настройки/новости берём из DEMO_DATA
    renderGamePanel();
    renderNewsList();
    refreshCurrentInstall();
    renderActionButton();
    paintSidebarProgress();
    renderProjectPill();
    setStatus(t('ready'));
    return;
  }
  setStatus(t('news_updating'), true);
  await Promise.all([loadSettings(state.project.id), loadNews(state.project.id)]);
  renderGamePanel();
  renderNewsList();
  refreshCurrentInstall();
  renderActionButton();
  paintSidebarProgress();
  renderProjectPill();
  setStatus(t('ready'));
}

// =====================================================
//  ГЛАВНАЯ (Home)
// =====================================================
function showView(view) {
  state.view = view === 'game' ? 'game' : 'home';
  $('#main-pane-home').classList.toggle('hidden', state.view !== 'home');
  $('#main-pane-game').classList.toggle('hidden', state.view !== 'game');
  $('#btn-home').classList.toggle('active', state.view === 'home');
}

async function loadHomeData() {
  state.homeSlides = [];
  state.homeNews = [];
  const ids = state.projects.map((p) => p.id);
  if (DEMO_USER) {
    const banner = 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1920&q=80';
    state.homeSlides = state.projects.map((p) => ({ id: p.id, name: p.name, tagline: p.tagline || '', cfg: {}, banner, ctaKind: 'project' }));
    state.homeNews = (DEMO_DATA.news || []).slice(0, 3);
    return;
  }
  try {
    // 1) Проекты с флажком media_show_home
    if (ids.length) {
      const { data: rows, error } = await sb.from('settings')
        .select('project_id,key,value')
        .in('project_id', ids)
        .in('key', ['media_show_home', 'media_banner', 'media_home_sort']);
      if (!error) {
        const by = {};
        (rows || []).forEach((r) => { (by[r.project_id] = by[r.project_id] || {})[r.key] = r.value; });
        state.homeSlides = state.projects
          .map((p) => ({ id: p.id, name: p.name, tagline: p.tagline || '', cfg: by[p.id] || {} }))
          .filter((s) => String(s.cfg.media_show_home || '').toLowerCase() === 'true' && /^https?:\/\//i.test(s.cfg.media_banner || ''))
          .sort((a, b) => (Number(a.cfg.media_home_sort) || 10) - (Number(b.cfg.media_home_sort) || 10))
          .map((s) => ({ id: s.id, name: s.name, tagline: s.tagline, banner: s.cfg.media_banner, ctaKind: 'project' }));
      }
    }
    // 2) Featured-слайды (официальные постеры SAMOT — флайеры/акции/фесты)
    const { data: featured, error: fErr } = await sb.rpc('list_featured_slides');
    if (!fErr && Array.isArray(featured)) {
      const featuredSlides = featured.slice(0, 10).map((f) => ({
        id: 'f_' + f.id,
        kind: 'featured',
        name: f.title,
        tagline: f.tagline || '',
        banner: f.image_url,
        ctaLabel: f.cta_label || 'Смотреть',
        ctaUrl: f.cta_url || '',
        sort: f.sort ?? 0,
      }));
      state.homeSlides = [...state.homeSlides, ...featuredSlides];
    }
    // 3) Новости в карусели (проектные и бренд/события — помечаются carousel=true)
    const { data: carouselNews } = await sb.from('news')
      .select('*')
      .eq('active', true)
      .eq('carousel', true)
      .lte('published_at', new Date().toISOString())
      .order('published_at', { ascending: false })
      .limit(6);
    if (Array.isArray(carouselNews)) {
      const newsSlides = carouselNews.map((n) => ({
        id: 'n_' + n.id,
        kind: 'news',
        news: n,
        name: n.title,
        tagline: n.excerpt || '',
        banner: n.image_url || '',
        ctaUrl: n.cta_url || '',
        sort: 0,
      }));
      state.homeSlides = [...state.homeSlides, ...newsSlides];
    }
    const { data: news, error: nErr } = await sb.from('news')
      .select('*')
      .eq('active', true)
      .eq('home', true)
      .lte('published_at', new Date().toISOString())
      .order('published_at', { ascending: false })
      .limit(8);
    if (!nErr) state.homeNews = news || [];
  } catch { /* тихо: Главная останется пустой */ }
}

function currentHomeSlide() { return state.homeSlides[state.homeIndex] || null; }

function goToHomeSlide(i) {
  const slides = state.homeSlides;
  if (!slides.length) return;
  state.homeIndex = ((i % slides.length) + slides.length) % slides.length;
  const s = slides[state.homeIndex];
  $('#home-hero-img').src = s.banner;
  $('#home-hero-img').addEventListener('error', () => { $('#home-hero-img').style.visibility = 'hidden'; }, { once: true });
  $('#home-hero-name').textContent = s.name;
  $('#home-hero-tagline').textContent = s.tagline || '';
  $('#home-hero-cta').textContent = (s.kind === 'featured' && s.ctaLabel) ? s.ctaLabel : (s.kind === 'news' ? (s.ctaUrl ? 'Подробнее' : 'Читать') : 'Перейти к проекту');
  $$('#home-hero-dots .home-hero-dot').forEach((d, j) => d.classList.toggle('active', j === state.homeIndex));
}

function renderHomeHero() {
  const dots = $('#home-hero-dots');
  dots.innerHTML = '';
  clearInterval(state.homeTimer);
  const slides = state.homeSlides;
  if (!slides.length) {
    $('#home-hero-img').removeAttribute('src');
    $('#home-hero-name').textContent = 'SAMOT';
    $('#home-hero-tagline').textContent = 'Добавьте баннер проекту в админке и отметьте «Показывать на Главной».';
    $('#home-hero-cta').textContent = 'К проектам';
    return;
  }
  $('#home-hero-cta').textContent = 'Перейти к проекту';
  slides.forEach((_, i) => {
    const d = document.createElement('button');
    d.className = 'home-hero-dot' + (i === 0 ? ' active' : '');
    d.title = 'Слайд ' + (i + 1);
    d.addEventListener('click', () => goToHomeSlide(i));
    dots.appendChild(d);
  });
  state.homeIndex = 0;
  goToHomeSlide(0);
  if (slides.length > 1) state.homeTimer = setInterval(() => goToHomeSlide(state.homeIndex + 1), 6500);
}

function renderHomeNews() {
  const list = $('#home-news-list');
  const empty = $('#home-news-empty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', state.homeNews.length > 0);
  state.homeNews.forEach((n) => {
    const btn = document.createElement('button');
    btn.className = 'home-news-item';
    const kindTag = n.kind === 'samot' ? 'SAMOT' : (n.kind === 'event' ? 'Событие' : (n.tag || 'Новости'));
    const thumb = n.image_url ? '<img src="' + escapeHtml(n.image_url) + '" alt="" onerror="this.style.display=&quot;none&quot;" />' : '';
    btn.innerHTML = thumb +
      '<span class="hn-body">' +
        '<span class="hn-tag">' + escapeHtml(kindTag) + '</span>' +
        '<span class="hn-title">' + escapeHtml(n.title || '') + '</span>' +
        '<span class="hn-date">' + timeAgo(n.published_at) + '</span>' +
      '</span>';
    btn.addEventListener('click', () => openNewsModal(n));
    list.appendChild(btn);
  });
}

function renderHome() {
  renderHomeHero();
  renderHomeNews();
}

function openHomeSlide(s) {
  if (!s) return;
  if (s.kind === 'featured') {
    const url = s.ctaUrl;
    if (url && window.launcher?.openExternal) { window.launcher.openExternal(url); }
    else if (url) { window.open(url, '_blank', 'noopener'); }
    return;
  }
  if (s.kind === 'news') {
    const n = s.news;
    if (s.ctaUrl && /^https?:\/\//i.test(s.ctaUrl)) {
      if (window.launcher?.openExternal) { window.launcher.openExternal(s.ctaUrl); }
      else { window.open(s.ctaUrl, '_blank', 'noopener'); }
      return;
    }
    if (n) openNewsModal(n);
    return;
  }
  selectProject(s.id);
}

$('#btn-home').addEventListener('click', () => showView('home'));
$('#home-hero-prev').addEventListener('click', () => goToHomeSlide(state.homeIndex - 1));
$('#home-hero-next').addEventListener('click', () => goToHomeSlide(state.homeIndex + 1));
$('#home-hero-cta').addEventListener('click', (e) => { e.stopPropagation(); const s = currentHomeSlide(); if (s) openHomeSlide(s); else showView('game'); });
$('#home-hero-slide').addEventListener('click', () => { const s = currentHomeSlide(); if (s) openHomeSlide(s); });
$('#home-news-refresh').addEventListener('click', async () => { await loadHomeData(); renderHome(); });

// =====================================================
//  ПРОЕКТЫ
// =====================================================
function sortedProjects(list) {
  // приоритет для проектов, по которым есть данные — чтобы пустые не лезли вперёд
  return [...list].sort((a, b) => (a.id || 0) - (b.id || 0));
}

function renderProjectList() {
  const wrap = $('#project-list');
  wrap.innerHTML = '';

  if (!state.projects.length) {
    const empty = document.createElement('div');
    empty.className = 'project-empty';
    empty.textContent = currentLang === 'en' ? 'No projects yet' : 'Проектов пока нет';
    wrap.appendChild(empty);
    return;
  }

  // де-фокус: слоя данных может не быть у нового проекта — всё равно показываем
  for (const p of sortedProjects(state.projects)) {
    const btn = document.createElement('button');
    btn.className = 'project-item' + (state.project && state.project.id === p.id ? ' active' : '');
    btn.dataset.id = p.id;

    const logo = document.createElement('div');
    logo.className = 'project-logo';
    if (p.logo && /^https?:\/\//.test(p.logo)) {
      const img = document.createElement('img');
      img.src = p.logo;
      img.alt = p.name;
      logo.appendChild(img);
    } else {
      logo.textContent = p.logo || '🎮';
    }

    const meta = document.createElement('div');
    meta.className = 'project-meta';
    meta.innerHTML = `<b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.tagline || '')}</span>`;

    btn.appendChild(logo);
    btn.appendChild(meta);
    btn.addEventListener('click', () => selectProject(p.id));
    wrap.appendChild(btn);
  }
  paintSidebarProgress();
}

async function selectProject(id, silent = false) {
  state.project = state.projects.find((p) => p.id === id) || null;
  localStorage.setItem(SELECTED_KEY, String(id));
  renderProjectList();
  await reloadCurrentProject();
  showView('game');
  if (!silent) setStatus(t('ready'));
}

function renderProjectPill() {
  const pill = $('#pill-project');
  if (!state.project) { pill.textContent = '◈ —'; return; }
  const icon = state.project.logo && !/^https?:/.test(state.project.logo) ? state.project.logo + ' ' : '◈ ';
  pill.textContent = icon + state.project.name;
}

function readCache(pid) {
  try { return JSON.parse(localStorage.getItem('samot_cache_' + pid) || 'null'); } catch { return null; }
}
function writeCache(pid, payload) {
  try { localStorage.setItem('samot_cache_' + pid, JSON.stringify(payload)); } catch { /* ignore */ }
}

function refreshCurrentInstall() {
  const pid = state.project && state.project.id;
  state.install = (pid && state.installByProject[pid]) || { installed: false, version: null, path: null };
}

function paintSidebarProgress() {
  $$('#project-list .project-item').forEach((btn) => {
    const pid = Number(btn.dataset.id);
    const st = state.installByProject[pid];
    const live = state.liveProgress && state.liveProgress.pid === pid ? state.liveProgress.pct : null;
    // плавная заливка: 0–100 % при скачивании, 100 % когда готово к работе
    const pct = st && st.installed ? 100 : (live == null ? 0 : live);
    btn.style.setProperty('--fill', Math.min(100, Math.max(0, pct)) + '%');
    btn.classList.toggle('is-installed', !!(st && st.installed));
  });
}

function parseMediaShots(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    if (Array.isArray(a)) return a.map((x) => (typeof x === 'string' ? x : (x && x.url))).filter((u) => /^https?:\/\//i.test(String(u || '')));
  } catch { /* не JSON — игнорируем */ }
  return [];
}

function renderGallery(s) {
  const main = $('#gallery-img');
  const thumbs = $('#gallery-thumbs');
  const empty = $('#gallery-empty');
  let shots = parseMediaShots(s.media_screenshots);
  if (!shots.length && s.game_image_url) shots = [s.game_image_url];
  thumbs.innerHTML = '';
  empty.classList.toggle('hidden', shots.length > 0);
  main.classList.toggle('hidden', shots.length === 0);
  const show = (i) => {
    state.galleryIndex = ((i % shots.length) + shots.length) % shots.length;
    main.src = shots[state.galleryIndex];
    $$('#gallery-thumbs .gallery-thumb').forEach((t, j) => t.classList.toggle('active', j === state.galleryIndex));
  };
  shots.forEach((u, i) => {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'gallery-thumb' + (i === 0 ? ' active' : '');
    t.innerHTML = '<img loading="lazy" alt="" src="' + escapeHtml(u) + '" />';
    t.addEventListener('click', () => show(i));
    thumbs.appendChild(t);
  });
  clearInterval(state.galleryTimer);
  state.galleryIndex = 0;
  if (shots.length) show(0);
  if (shots.length > 1) {
    state.galleryTimer = setInterval(() => show(state.galleryIndex + 1), 4500);
  }
}

function renderMediaPanel() {
  const s = state.settings;
  const art = $('#media-card-img');
  if (art) art.src = s.media_card || s.game_image_url || '../assets/logoClient.svg';
  $('#info-desc').textContent = (state.project && state.project.tagline) || '—';
  $('#info-release').textContent = s.media_release_date || '—';
  $('#info-langs').textContent = s.media_languages || '—';
  $('#info-dev').textContent = s.media_developer || '—';
  const descRaw = String(s.media_long_description || '').trim();
  $('#desc-body').innerHTML = descRaw ? renderNewsBodySafe(descRaw) : '<em>Описание пока не добавлено.</em>';
  renderGallery(s);
}

$('#btn-developer').addEventListener('click', () => {
  const s = state.settings;
  $('#dev-modal-name').textContent = s.media_developer || 'Разработчик не указан';
  $('#dev-modal-body').textContent = s.media_developer_contact || 'Контактная информация не указана.';
  $('#dev-modal').classList.remove('hidden');
});
const closeDevModal = () => $('#dev-modal').classList.add('hidden');
$('#dev-modal-close').addEventListener('click', closeDevModal);
$('#dev-modal-ok').addEventListener('click', closeDevModal);
$('#dev-modal').addEventListener('click', (e) => { if (e.target.id === 'dev-modal') closeDevModal(); });

$('#desc-toggle').addEventListener('click', () => {
  const body = $('#desc-body');
  const card = $('#desc-toggle').closest('.desc-card');
  const nowHidden = body.classList.toggle('hidden');
  card.classList.toggle('open', !nowHidden);
  $('#desc-toggle').setAttribute('aria-expanded', String(!nowHidden));
});

// =====================================================
//  АВТО-ОБНОВЛЕНИЕ ДАННЫХ — раз в минуту подтягивать
//  настройки/новости/Главную (иначе изменения в админке
//  «не доходят» до уже открытого клиента)
// =====================================================
function scheduleDataRefresh() {
  clearInterval(state.refreshTimer);
  if (DEMO_USER) return; // демо не опрашивает сервер
  state.refreshTimer = setInterval(async () => {
    try {
      await Promise.all([loadSettings(state.project?.id), loadNews(state.project?.id)]);
      renderGamePanel();
      renderNewsList();
      renderProjectPill();
      await loadHomeData();
      renderHome();
      paintSidebarProgress();
    } catch { /* тихо: не показываем игроку ошибки фоновой синхронизации */ }
  }, 60000);
}

// =====================================================
//  ЗАГРУЗКА ДАННЫХ
// =====================================================
async function loadAll() {
  // проекты
  splashStep(currentLang === 'en' ? 'Loading projects…' : 'Загружаем проекты…', 45);
  let projects = null, projErr = null;
  if (!DEMO_USER) {
    const r1 = await sb.from('projects').select('id,name,slug,tagline,logo,color,is_hidden,approved').eq('is_hidden', false).order('id', { ascending: true });
    if (r1.error && /approved/i.test(String(r1.error.message))) {
      const r2 = await sb.from('projects').select('id,name,slug,tagline,logo,color,is_hidden').eq('is_hidden', false).order('id', { ascending: true });
      projects = (r2.data || []).map((p) => ({ ...p, approved: true }));
      projErr = r2.error;
    } else { projects = r1.data; projErr = r1.error; }
  }

  let projectsToUse = DEMO_USER ? DEMO_DATA.projects : (projects || []).filter((p) => !p.is_hidden && p.approved !== false);
  state.projects = projectsToUse;
  // миграция каталогов игры в slug-имена (один раз на каждом старте, идемпотентно)
  for (const p of state.projects) {
    if (p && p.id && p.slug) {
      try { await window.launcher?.migrateInstallDir?.(p.id, p.slug); } catch { /* миграция не критична */ }
    }
  }

  if (projErr) {
    state.offline = true;
    toast(currentLang === 'en'
      ? 'Cannot reach server — offline demo data'
      : 'Сервер недоступен — показаны офлайн-данные', true);
  }

  // выбор проекта
  const savedPid = parseInt(localStorage.getItem(SELECTED_KEY) || '0', 10);
  const chosen = state.projects.find((p) => p.id === savedPid) || state.projects[0] || null;
  state.project = chosen;

  splashStep(currentLang === 'en' ? 'Loading news…' : 'Загружаем новости…', 75);
  if (state.project) {
    if (DEMO_USER) {
      // демо: сервер не опрашиваем — берём из DEMO_DATA
      state.settings = { ...DEMO_DATA.settings };
      state.news = [...DEMO_DATA.news];
    } else {
      // кэш есть в localStorage — используем при сомнениях
      const cached = readCache(state.project.id);
      const results = await Promise.all([
        loadSettings(state.project.id),
        loadNews(state.project.id),
      ]);
      if (!results[0] && cached?.settings) {
        state.settings = { ...cached.settings };
        state.offline = true;
      }
      if (!results[1] && cached?.news) {
        state.news = [...cached.news];
        state.offline = true;
      }
    }
  }

  renderProjectList();
  renderNewsList();
  renderGamePanel();
  renderProjectPill();
  await loadHomeData();
  await loadWarnings();
  renderHome();
  showView(state.view || 'home');
  state.installByProject = DEMO_USER ? {} : await window.launcher.getAllInstallStates();
  refreshCurrentInstall();
  paintSidebarProgress();
  renderActionButton();
  scheduleDataRefresh();
  setStatus(t('ready'));
  setNewsStatus(lastNewsStatusText || `${t('news_updated')} · ${timeNow()}`);

  // подсказка о новой версии лаунчера
  const minVer = state.settings.min_launcher_version;
  const outdated = minVer && cmpSemver(CFG.LAUNCHER_VERSION, minVer) < 0;
  $('#launcher-outdated').classList.toggle('hidden', !outdated);
  if (outdated) $('#min-launcher-ver').textContent = 'v' + minVer;
}

async function loadSettings(pid) {
  if (!pid) return false;
  const { data, error } = await sb.from('settings').select('key,value').eq('project_id', pid);
  if (error) { toast('Не удалось получить настройки с сервера.', true); return false; }
  state.settings = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return true;
}

async function loadNews(pid) {
  if (!pid) return false;
  const { data, error } = await sb
    .from('news')
    .select('*')
    .eq('active', true)
    .eq('project_id', pid)
    .lte('published_at', new Date().toISOString())
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(20);
  if (error) {
    state.news = [];
    setNewsStatus(t('news_error'));
    return false;
  }
  state.news = data || [];
  setNewsStatus(`${t('news_updated')} · ${timeNow()}`);
  return true;
}

// =====================================================
//  БАННЕРЫ / ЛЕНТА
// =====================================================
// (баннер-карусель новостей убрана — новости живут в ленте и на Главной)
function renderNewsList() {
  const list = $('#news-list');
  const empty = $('#news-empty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', state.news.length > 0);

  state.news.forEach((n) => {
    const btn = document.createElement('button');
    btn.className = 'news-item' + (n.pinned ? ' pinned' : '');
    const thumb = n.image_url
      ? `<img class="news-thumb" src="${escapeHtml(n.image_url)}" alt="" onerror="this.outerHTML='<div class=&quot;news-thumb fallback&quot;>📰</div>'" />`
      : '<div class="news-thumb fallback">📰</div>';
    btn.innerHTML = `
      ${thumb}
      <div class="news-meta">
        <div class="news-meta-top">
          ${n.pinned ? '<span class="pin-badge">📌 Закреплено</span>' : ''}
          <span class="tag" data-tag="${escapeHtml(n.tag)}">${escapeHtml(n.tag)}</span>
          <span class="news-date">${timeAgo(n.published_at)}</span>
        </div>
        </div>
        <h3>${escapeHtml(n.title)}</h3>
        <p>${escapeHtml(n.excerpt || '')}</p>
      </div>`;
    btn.addEventListener('click', () => openNewsModal(n));
    list.appendChild(btn);
  });
}

function renderNewsBodySafe(text) {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  if (!text) return '<em>Текст не добавлен.</em>';
  const norm = String(text).replace(/\\n/g, '\n');
  let out = esc(norm);
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, caption, url) => {
    const trimmed = String(url).trim();
    if (!/^https?:\/\//i.test(trimmed)) return esc(caption);
    return '<img class="news-inline-img" src="' + esc(trimmed) + '" alt="' + esc(caption) + '" style="max-width:100%; height:auto; border-radius:8px; margin:10px 0; display:block;" />';
  });
  out = out.replace(/\n/g, '<br>');
  return out;
}
function openNewsModal(n) {
  $('#modal-tag').textContent = n.tag || 'Анонс';
  $('#modal-tag').dataset.tag = n.tag || '';
  $('#modal-date').textContent = timeAgo(n.published_at);
  $('#modal-title').textContent = n.title || '';
  $('#modal-body').innerHTML = renderNewsBodySafe(n.body || n.excerpt);
  const img = $('#modal-image');
  if (n.image_url) { img.src = n.image_url; img.classList.remove('hidden'); }
  else { img.removeAttribute('src'); img.classList.add('hidden'); }
  $('#news-modal').classList.remove('hidden');
}

// =====================================================
//  КАРТОЧКА ИГРЫ / СКАЧИВАНИЕ
// =====================================================
function renderGamePanel() {
  const s = state.settings;
  const gameName = s.game_name || state.project?.name || 'SAMOT game';
  const downloadAvailable = String(s.download_available || 'true').toLowerCase() === 'true';
  $('#game-name').textContent = gameName;

  if (downloadAvailable) {
    $('#game-version').textContent = 'v' + (s.game_version || '0.0.0');
    $('#game-version').style.visibility = 'visible';
    $('#maintenance-box').style.display = '';
    $('#btn-action').style.display = '';
    $('#btn-reveal').style.display = '';
    $('#install-info').style.display = '';
    $('.download-progress').style.display = (state.downloading && state.downloadingPid === state.project?.id) ? '' : 'none';
  } else {
    // Скрыть версию и всё, что связано со скачиванием; оставить название и статус серверов
    $('#game-version').style.visibility = 'hidden';
    $('#maintenance-box').style.display = 'none';
    $('#btn-action').style.display = 'none';
    $('#btn-reveal').style.display = 'none';
    $('#btn-uninstall')?.classList.add('hidden');
    $('#install-info').style.display = 'none';
    $('.download-progress').style.display = 'none';
  }
  document.title = gameName + ' — SAMOT Launcher';

  const offline = $('#offline-banner');
  offline.classList.toggle('hidden', !state.offline);

  const minVer = s.min_launcher_version;
  const outdated = minVer && cmpSemver(CFG.LAUNCHER_VERSION, minVer) < 0;
  $('#launcher-outdated').classList.toggle('hidden', !outdated);
  if (outdated) $('#min-launcher-ver').textContent = 'v' + minVer;

  const maint = String(s.maintenance).toLowerCase() === 'true';
  $('#maintenance-box').classList.toggle('hidden', !maint);
  $('#btn-action').classList.toggle('hidden', maint);
  $('#btn-reveal').classList.toggle('hidden', maint);
  $('#btn-uninstall')?.classList.toggle('hidden', maint);
  renderMediaPanel();
}

function renderActionButton() {
  const btn = $('#btn-action');
  const activateAt = state.settings.release_activate_at;
  if (activateAt && new Date(activateAt) > new Date()) {
    const d = new Date(activateAt);
    btn.textContent = 'Новый релиз — ' + d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
    btn.disabled = true;
    btn.dataset.mode = 'wait';
    $('#install-info').textContent = 'Скачивание откроется ' + d.toLocaleString('ru-RU');
    return;
  }
  btn.disabled = false;
  const v = state.settings.game_version || '';
  const revealVisible = !!(state.install && state.install.installed);
  const revealBtn = $('#btn-reveal');
  const uninstallBtn = $('#btn-uninstall');
  if (revealBtn) revealBtn.classList.toggle('hidden', !revealVisible);
  if (uninstallBtn) uninstallBtn.classList.toggle('hidden', !revealVisible);
  if (state.install.installed && state.install.version === v) {
    btn.textContent = t('play');
    btn.dataset.mode = 'play';
    $('#install-info').textContent = currentLang === 'en'
      ? `Installed v${v}`
      : `Установлена версия ${v} · скачано ${new Date(state.install.downloadedAt || Date.now()).toLocaleDateString('ru-RU')}`;
  } else if (state.install.installed) {
    btn.textContent = `${t('update_to')} v${v}`;
    btn.dataset.mode = 'download';
    $('#install-info').textContent = currentLang === 'en'
      ? `Update available (installed v${state.install.version || '?'})`
      : `Установлена v${state.install.version || '?'} — доступно обновление.`;
  } else {
    btn.textContent = t('download');
    btn.dataset.mode = 'download';
    $('#install-info').textContent = '';
  }
}

$('#btn-action').addEventListener('click', async () => {
  const mode = $('#btn-action').dataset.mode || 'download';
  if (mode === 'play') {
    if (DEMO_USER) { toast('🎮 Демо: сейчас бы запустилась игра!'); return; }
    const res = await window.launcher.playGame(state.project?.id, state.project?.slug);
    if (!res.ok) toast(res.error || 'Не удалось запустить игру.', true);
    return;
  }
  startDownload();
});

$('#btn-reveal').addEventListener('click', () => {
  if (DEMO_USER) return toast('Демо-режим: файлов на диске нет.');
  window.launcher.revealGame(state.project?.id, state.project?.slug);
});

$('#btn-uninstall')?.addEventListener('click', async () => {
  const pid = state.project?.id;
  if (!pid) return;
  if (DEMO_USER) return toast('Демо-режим: файлов на диске нет.');
  const ok = await uiConfirm({ title: 'Удалить игру', message: 'Удалить скачанные файлы проекта «' + (state.project?.name || '') + '»? Это безопасно: их можно скачать заново.', okLabel: 'Удалить', danger: true });
  if (!ok) return;
  const res = await window.launcher.uninstallGame(pid, state.project?.slug);
  if (!res?.ok) { toast('Не удалось удалить: ' + (res?.error || 'неизвестная ошибка'), true); return; }
  state.install = { installed: false, version: null, path: null, size: null, downloadedAt: null };
  if (state.installByProject) state.installByProject[pid] = state.install;
  renderActionButton();
  refreshCurrentInstall();
  toast('Игра удалена.');
});
$('#btn-refresh').addEventListener('click', async () => { await reloadCurrentProject(); });

$('#btn-verify-cache')?.addEventListener('click', async () => {
  const raw = state.settings.game_manifest;
  if (!raw) { toast('Загрузка игры пока не настроена. Попробуйте позже.', true); return; }
  let manifest;
  try { manifest = JSON.parse(raw); } catch { toast('Манифест невалиден.', true); return; }
  if (!manifest || !Array.isArray(manifest.files)) { toast('Манифест без списка файлов.', true); return; }

  const summaryEl = $('#verify-summary');
  const listEl = $('#verify-list');
  const modal = $('#verify-modal');
  summaryEl.innerHTML = '<span style="color:#9ed9ff">Проверяю ' + manifest.files.length + ' файлов…</span>';
  listEl.innerHTML = '';
  modal.classList.remove('hidden');

  try {
    const res = await window.launcher.verifyCache(manifest, state.project?.id, state.project?.slug);
    const bad = (res.report || []).filter(r => !r.ok);
    summaryEl.innerHTML = '<span style="color:' + (res.ok ? '#7de6b2' : '#ffadc0') + '">'
      + escapeHtml(manifest.version ? 'Манифест v' + manifest.version + '.' : '')
      + ' Файлов: ' + res.total + ', повреждено/отсутствует: ' + (res.missing + res.corrupt)
      + (res.ok ? ' ✓ все в порядке' : ' — нужна докачка')
      + '</span>';
    listEl.innerHTML = (res.report || []).map((r) =>
      '<div style="display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid var(--border)">'
      + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(r.path) + '</span>'
      + '<b style="color:' + (r.ok ? '#7de6b2' : '#ffadc0') + ';white-space:nowrap">' + (r.missing ? 'нет' : (r.ok ? 'OK' : 'сбит')) + '</b>'
      + '</div>'
    ).join('');
    if (bad.length) {
      modal.classList.add('hidden');
      toast('Найдено файлов не в порядке: ' + bad.length + '. Начинаем докачку…');
      startDownload();
    }
  } catch (err) {
    summaryEl.innerHTML = '<span style="color:#ffadc0">Ошибка: ' + escapeHtml(String(err?.message || err)) + '</span>';
  }
});
// Кнопка паузы/плей в прогресс-борде: видна только во время скачивания
function setPauseButtonVisible(visible, paused) {
  const btn = $('#btn-pause-download');
  if (!btn) return;
  btn.classList.toggle('hidden', !visible);
  btn.classList.toggle('paused', !!paused);
  btn.textContent = paused ? '▶' : '❚❚';
  btn.title = paused ? 'Продолжить скачивание' : 'Пауза';
  btn.setAttribute('aria-label', btn.title);
}

$('#btn-pause-download')?.addEventListener('click', async () => {
  const pid = state.downloadingPid ?? state.project?.id;
  if (DEMO_USER) {
    state.demoPaused = !state.demoPaused;
    setPauseButtonVisible(true, state.demoPaused);
    setStatus(state.demoPaused ? 'Пауза' : t('downloading') + '…', true);
    return;
  }
  try {
    const res = await window.launcher.togglePauseDownload(pid);
    const paused = !!res?.paused;
    setPauseButtonVisible(true, paused);
    setStatus(paused ? 'Пауза' : t('downloading') + '…', true);
  } catch (err) {
    toast('Не удалось переключить паузу.', true);
  }
});

$('#verify-close')?.addEventListener('click', () => $('#verify-modal')?.classList.add('hidden'));


async function startDownload() {
  const url = state.settings.download_url;

  // МАНИФЕСТ-ЗАГРУЗКА: если настроен манифест — обновляем игру точечно
  if (state.settings.game_enabled === 'true' && state.settings.game_manifest && state.settings.game_owner && state.settings.game_repo && state.settings.game_tag) {
    try {
      const manifest = JSON.parse(state.settings.game_manifest);
      if (!manifest || !Array.isArray(manifest.files)) throw new Error('Файл с манифестом невалиден.');
      const btn = $('#btn-action');
      const prog = $('#download-progress');
      state.downloading = true;
      state.downloadingPid = state.project?.id;
      btn.disabled = true;
      btn.classList.add('hidden');
      prog.classList.remove('hidden');
      prog.style.display = '';
      setPauseButtonVisible(true, false);
      $('#dp-label').textContent = 'Обновляем игру…';
      $('#dp-fill').style.width = '5%';
      $('#dp-percent').textContent = 'проверяем…';
      const owner = state.settings.game_owner;
      const repo = state.settings.game_repo;
      const tag = state.settings.game_tag;
      const base = 'https://github.com/' + owner + '/' + repo + '/releases/download/' + tag + '/';

      const verify = await window.launcher.verifyCache(manifest, state.project?.id, state.project?.slug);
      if (verify.ok) {
        toast('Файлы игры актуальны. Обновление не требуется.');
        btn.disabled = false;
        btn.classList.remove('hidden');
        prog.classList.add('hidden');
        prog.style.display = 'none';
        setPauseButtonVisible(false, false);
        state.downloading = false;
      state.downloadingPid = null;
        return;
      }

      // Скачиваем отсутствующие/битые файлы; живой прогресс через IPC
      const pid = state.project?.id;
      const totalToFetch = (verify.report || []).filter((r) => !r.ok).length;
      const dlStart = Date.now();
      const updateEl = (received, total, percent) => {
        const p = Math.max(0, Math.min(100, Number(percent ?? 0)));
        const elapsed = Math.max(0.1, (Date.now() - dlStart) / 1000);
        const speedBps = received > 0 ? Math.round(received / elapsed) : 0;
        $('#dp-fill').style.width = p + '%';
        $('#dp-percent').textContent = p + '%';
        $('#dp-label').textContent = 'Обновление игры' + (totalToFetch ? ' (' + totalToFetch + ' файлов)' : '');
        $('#dp-received').textContent = (typeof fmtBytes === 'function' ? fmtBytes(received) : String(received)) + ' / ' + (total ? (typeof fmtBytes === 'function' ? fmtBytes(total) : String(total)) : '?');
        const speedEl = $('#dp-speed');
        if (speedEl) speedEl.textContent = (typeof fmtBytes === 'function' ? fmtBytes(speedBps) : String(speedBps)) + '/с';
        setStatus('Обновление: ' + p + '%', true);
        state.liveProgress = { pid, pct: p };
        paintSidebarProgress();
      };
      updateEl(0, 0, 0);
      const offProgress = window.launcher?.onDownloadProgress
        ? window.launcher.onDownloadProgress((ev) => {
            const r = Number(ev?.received ?? 0);
            const t = Number(ev?.total ?? 0);
            const pct = t ? Math.round((r / t) * 100) : 0;
            updateEl(r, t, pct);
          })
        : null;
      try {
        const result = await window.launcher.downloadManifest(manifest, base, state.project?.id, state.project?.slug);
        // ничего не возвращаем: общий блок книги ниже разберётся с установкой
        void result;
        updateEl(1, 1, 100);
        state.liveProgress = null;
        paintSidebarProgress();
      } finally {
        if (typeof offProgress === 'function') offProgress();
      }

      const manifestInstall = { installed: true, version: manifest.version || state.settings.game_version || '', path: '', downloadedAt: new Date().toISOString() };
      if (state.project?.id) state.installByProject[state.project.id] = manifestInstall;
      refreshCurrentInstall();
      paintSidebarProgress();
      state.downloading = false;
      state.downloadingPid = null;
      prog.classList.add('hidden');
      prog.style.display = 'none';
      setPauseButtonVisible(false, false);
      btn.classList.remove('hidden');
      btn.disabled = false;
      renderActionButton();
      setStatus(t('ready'));
      toast('Игра обновлена.');
      return;
    } catch (err) {
      console.warn('manifest update failed; falling back to legacy download', err);
      state.downloading = false;
      state.downloadingPid = null;
      { const pEl = $('#download-progress'); if (pEl) { pEl.classList.add('hidden'); pEl.style.display = 'none'; } }
      setPauseButtonVisible(false, false);
      $('#btn-action')?.classList.remove('hidden');
      $('#btn-action').disabled = false;
      toast('Не удалось обновить игру через манифест. Пробуем классическое скачивание.', true);
    }
  }
  if (DEMO_USER) {
    if (state.downloading) return;
    state.downloading = true;
    state.downloadingPid = state.project?.id;
    const btn = $('#btn-action');
    const prog = $('#download-progress');
    state.demoPaused = false;
    btn.disabled = true;
    btn.classList.add('hidden');
    prog.classList.remove('hidden');
    prog.style.display = '';
    setPauseButtonVisible(true, false);
    const total = 480 * 1024 * 1024;
    let received = 0;
    const startedAt = Date.now();
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (state.demoPaused) return;
        received = Math.min(total, received + total / 45 + Math.random() * 8 * 1024 * 1024);
        const elapsed = (Date.now() - startedAt) / 1000;
        const percent = Math.floor((received / total) * 100);
        $('#dp-fill').style.width = percent + '%';
        $('#dp-percent').textContent = percent + '%';
        $('#dp-label').textContent = t('downloading') + '…';
        $('#dp-received').textContent = `${fmtBytes(received)} / ${fmtBytes(total)}`;
        $('#dp-speed').textContent = fmtBytes(received / Math.max(elapsed, 0.1)) + '/с';
        setStatus(`${t('downloading')}… ${percent}% · ${fmtBytes(received / Math.max(elapsed, 0.1))}/с`, true);
        if (received >= total) { clearInterval(timer); resolve(); }
      }, 60);
    });
    state.install = { installed: true, version: state.settings.game_version, path: 'D:\\Games\\SAMOT\\GameSetup.exe', downloadedAt: new Date().toISOString() };
    state.downloading = false;
      state.downloadingPid = null;
    prog.classList.add('hidden');
    prog.style.display = 'none';
    setPauseButtonVisible(false, false);
    btn.classList.remove('hidden');
    btn.disabled = false;
    renderActionButton();
    setStatus(t('ready'));
    toast(currentLang === 'en' ? 'Done! Game downloaded. (demo)' : 'Готово! Игра скачана. (демо — файл не создавался)');
    return;
  }

  if (!url) { toast('Загрузка игры пока недоступна. Попробуйте позже.', true); return; }
  if (state.downloading) return;
  state.downloading = true;
  state.downloadingPid = state.project?.id;

  const btn = $('#btn-action');
  const prog = $('#download-progress');
  btn.disabled = true;
  btn.classList.add('hidden');
  prog.classList.remove('hidden');
  prog.style.display = '';
  setPauseButtonVisible(true, false);

  const downloadPid = state.project?.id;
  const dlStart = Date.now();
  const offProgress = window.launcher.onDownloadProgress(({ received, total, percent }) => {
    const elapsed = Math.max(0.1, (Date.now() - dlStart) / 1000);
    const speed = received > 0 ? Math.round(received / elapsed) : 0;
    state.liveProgress = { pid: downloadPid, pct: Math.max(0, Math.min(100, Math.round(percent ?? 0))) };
    paintSidebarProgress();
    $('#dp-fill').style.width = (percent ?? 0) + '%';
    $('#dp-percent').textContent = percent != null ? percent + '%' : '?';
    $('#dp-label').textContent = t('downloading') + '…';
    $('#dp-received').textContent = fmtBytes(received) + ' / ' + (total ? fmtBytes(total) : '?');
    $('#dp-speed').textContent = (typeof fmtBytes === 'function' ? fmtBytes(speed) : String(speed)) + '/с';
    setStatus(t('downloading') + ': ' + (percent ?? '') + '% · ' + fmtBytes(speed) + '/с', true);
  });

  try {
    const result = await window.launcher.downloadGame(url, state.settings.game_version || '', state.project?.id, state.project?.slug);
    if (state.project?.id) state.installByProject[state.project.id] = result;
    refreshCurrentInstall();
    paintSidebarProgress();
    toast(currentLang === 'en' ? 'Done! Game downloaded.' : 'Готово! Игра скачана.');
  } catch (err) {
    toast('Ошибка скачивания: ' + (err?.message || err), true);
  } finally {
    offProgress();
    state.liveProgress = null;
    paintSidebarProgress();
    state.downloading = false;
      state.downloadingPid = null;
    prog.classList.add('hidden');
    prog.style.display = 'none';
    setPauseButtonVisible(false, false);
    btn.classList.remove('hidden');
    btn.disabled = false;
    renderActionButton();
    setStatus(t('ready'));
  }
}

// =====================================================
//  ВХОД / САМОКОНТРОЛЬ
// =====================================================

async function readImageForReport() {
  const input = $('#bug-image');
  const file = input?.files?.[0];
  if (!file) return null;
  try {
    const img = await new Promise((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = rej;
      el.src = URL.createObjectURL(file);
    });
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    const base64 = (dataUrl.split(',')[1]) || '';
    if (!base64 || base64.length > 4_000_000) return null;
    const filename = (file.name || 'screenshot.jpg').replace(/\.[^.]+$/, '') + '.jpg';
    return { filename, content: base64, contentType: 'image/jpeg' };
  } catch (err) {
    logLine('WARN', ['bug report image skipped:', err?.message || err]);
    return null;
  }
}

// =====================================================
//  ОБНОВЛЕНИЯ КЛИЕНТА + БАГ-РЕПОРТЫ
// =====================================================
state.latestLauncherUpdate = null;

async function checkForLauncherUpdate() {
  try {
    const { data, error } = await sb.from('app_updates').select('latest_version, download_url, sha256').eq('tool', 'launcher').maybeSingle();
    if (error || !data) return;
    const latest = String(data.latest_version || '').trim();
    const url = String(data.download_url || '').trim();
    if (!latest || !/^https?:\/\//i.test(url)) return;
    if (cmpSemver(latest, CFG.LAUNCHER_VERSION) <= 0) return;
    state.latestLauncherUpdate = { latest, url, sha256: data.sha256 || '' };
    const banner = $('#update-banner');
    if (!banner) return;
    $('#update-banner-version').textContent = 'v' + latest;
    banner.classList.remove('hidden');
    const shownKey = 'samot_notified_' + latest;
    if (localStorage.getItem(shownKey) !== '1') {
      try { window.launcher?.notifyUpdate?.(latest); } catch {}
      localStorage.setItem(shownKey, '1');
    }
  } catch { /* офлайн или таблица недоступна — молчим */ }
}

$('#btn-update-later')?.addEventListener('click', () => {
  $('#update-banner')?.classList.add('hidden');
});

$('#btn-update-now')?.addEventListener('click', async () => {
  const info = state.latestLauncherUpdate;
  if (!info) return;
  const btn = $('#btn-update-now');
  btn.disabled = true;
  btn.textContent = 'Скачиваем…';

  const onProgress = (p) => {
    if (p && p.total > 0) btn.textContent = 'Скачиваем… ' + Math.floor((p.received / p.total) * 100) + '%';
  };
  const off = window.launcher?.onUpdateProgress ? window.launcher.onUpdateProgress(onProgress) : null;

  try {
    if (window.launcher?.downloadAndRunUpdate) {
      await window.launcher.downloadAndRunUpdate(info.url, info.sha256);
      btn.textContent = 'Устанавливаем…';
    } else {
      // браузер/демо: просто открываем страницу загрузки
      window.launcher?.openExternal ? window.launcher.openExternal(info.url) : window.open(info.url, '_blank');
      btn.disabled = false;
      btn.textContent = 'Обновить';
    }
  } catch (err) {
    logLine('ERROR', ['update failed:', err?.message || err]);
    toast('Не удалось обновиться. Откроем страницу загрузки…', true);
    window.launcher?.openExternal?.(info.url);
    btn.disabled = false;
    btn.textContent = 'Обновить';
  } finally {
    if (typeof off === 'function') off();
  }
});

$('#btn-report-bug')?.addEventListener('click', () => {
  $('#bug-modal')?.classList.remove('hidden');
});
$('#bug-cancel')?.addEventListener('click', () => $('#bug-modal')?.classList.add('hidden'));
$('#bug-modal')?.addEventListener('click', (e) => { if (e.target.id === 'bug-modal') e.target.classList.add('hidden'); });

$('#bug-send')?.addEventListener('click', async () => {
  const btn = $('#bug-send');
  const message = ($('#bug-message')?.value || '').trim();
  const contact = ($('#bug-contact')?.value || '').trim();
  if (!message) { toast('Опишите проблему.', true); return; }
  btn.disabled = true;
  btn.textContent = 'Отправляем…';
  const image = await readImageForReport();

  const systemInfo = [
    'app: SAMOT Launcher v' + CFG.LAUNCHER_VERSION,
    'userAgent: ' + navigator.userAgent,
    'platform: ' + navigator.platform,
    'language: ' + navigator.language,
    'screen: ' + window.screen.width + 'x' + window.screen.height,
    'project: ' + (state.project?.name || '—'),
    'url: ' + window.location.href,
  ].join('\n');

  try {
    const { error } = await sb.functions.invoke('send_report', {
      body: {
        tool: 'launcher',
        kind: 'bug',
        message,
        contact,
        userEmail: state.user?.email || null,
        systemInfo,
        logs: LOG_BUFFER.slice(-40).join('\n'),
        image,
      },
    });
    if (error) throw error;
    toast('Спасибо! Отчёт отправлен разработчику.');
    $('#bug-message').value = '';
    $('#bug-contact').value = '';
    if ($('#bug-image')) $('#bug-image').value = '';
    $('#bug-modal')?.classList.add('hidden');
  } catch (err) {
    logLine('ERROR', ['bug report failed:', err?.message || err]);
    toast('Не удалось отправить отчёт. Попробуйте позже.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Отправить';
  }
});


function formatBanRemaining(until) {
  const ms = until.getTime() - Date.now();
  if (ms <= 0) return 'истёк';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return days + 'д ' + hours + 'ч';
  if (hours > 0) return hours + 'ч ' + mins + 'м';
  return mins + ' мин';
}

function showBanScreen(ban) {
  state.banned = ban || null;
  const until = ban && ban.banned_until ? new Date(ban.banned_until) : null;
  $('#ban-screen-reason').textContent = (ban?.reason || '').trim() || 'Причина не указана';
  $('#ban-screen-until').textContent = until && !isNaN(until.getTime())
    ? until.toLocaleString('ru-RU') + ' (осталось: ' + formatBanRemaining(until) + ')'
    : '—';
  mainScreen.classList.add('hidden');
  authScreen.classList.add('hidden');
  $('#ban-screen')?.classList.remove('hidden');
  syncSupportVisibility();
}

function hideBanScreen() {
  state.banned = null;
  $('#ban-screen')?.classList.add('hidden');
}

// Скрыть/показать кнопки Поддержки по состоянию авторизации и бана
function syncSupportVisibility() {
  const loggedIn = !!state.user;
  document.querySelectorAll('#btn-contact-dev, #btn-unban-apply').forEach((b) => b.classList.toggle('hidden', !loggedIn));
  $('#btn-unban-apply')?.classList.toggle('hidden', !state.banned);
}

// Универсальная модалка письма (контакт / разбан)
let msgKind = null;
const MSG_KIND_META = {
  contact: { title: 'Связь с разработчиком', sendKind: 'contact' },
  unban:   { title: 'Заявка на разблокировку', sendKind: 'unban' },
};
function openMessageModal(kind) {
  msgKind = kind;
  $('#msg-modal-title').textContent = MSG_KIND_META[kind].title;
  $('#msg-message').value = '';
  $('#msg-modal')?.classList.remove('hidden');
}
function closeMessageModal() {
  $('#msg-modal')?.classList.add('hidden');
}
$('#msg-cancel')?.addEventListener('click', closeMessageModal);
$('#msg-modal')?.addEventListener('click', (e) => { if (e.target.id === 'msg-modal') closeMessageModal(); });

$('#msg-send')?.addEventListener('click', async () => {
  const btn = $('#msg-send');
  const message = ($('#msg-message')?.value || '').trim();
  if (!message) { toast('Опишите проблему.', true); return; }
  if (!state.user) { toast('Нужно войти в аккаунт.', true); return; }
  btn.disabled = true;
  btn.textContent = 'Отправляем…';
  const systemInfo = [
    'app: SAMOT Launcher v' + CFG.LAUNCHER_VERSION,
    'userAgent: ' + navigator.userAgent,
    'platform: ' + navigator.platform,
    'language: ' + navigator.language,
    'screen: ' + window.screen.width + 'x' + window.screen.height,
    'url: ' + window.location.href,
  ].join('\n');
  try {
    const { error } = await sb.functions.invoke('send_report', {
      body: {
        kind: MSG_KIND_META[msgKind].sendKind,
        message,
        contact: state.user?.email || null,
        userEmail: state.user?.email || null,
        systemInfo,
        logs: LOG_BUFFER.slice(-40).join('\n'),
      },
    });
    if (error) throw error;
    toast('Спасибо! Сообщение отправлено разработчику.');
    $('#msg-message').value = '';
    closeMessageModal();
  } catch (err) {
    logLine('ERROR', ['message send failed:', err?.message || err]);
    toast('Не удалось отправить. Попробуйте позже.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Отправить';
  }
});

$('#btn-contact-dev')?.addEventListener('click', () => openMessageModal('contact'));
$('#btn-unban-apply')?.addEventListener('click', () => openMessageModal('unban'));

$('#btn-delete-account')?.addEventListener('click', async () => {
  if (!state.user) return toast('Не выполнен вход.', true);
  const email = state.user.email;
  const typed = await uiPrompt({ title: 'Удалить аккаунт', label: 'Удалить аккаунт и все данные безвозвратно. Введите ваш email для подтверждения:', okLabel: 'Продолжить', danger: true, validate: (v) => (String(v).trim().toLowerCase() === String(email || '').trim().toLowerCase()) ? null : 'Email не совпадает' });
  if (typed === null) return;
  if (!(await uiConfirm({ title: 'Удалить аккаунт навсегда', message: 'Точно удалить ' + email + '? Это необратимо.', okLabel: 'УДАЛИТЬ', danger: true }))) return;
  btnDisableSelf('#btn-delete-account', true, 'Удаляем…');
  try {
    const { data, error } = await sb.functions.invoke('delete-account', { body: {} });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    toast('Аккаунт удалён. Выходим…');
    try { await sb.auth.signOut(); } catch {}
    try { localStorage.clear(); } catch { /* игнорируем */ }
    state.user = null; state.settings = {}; state.news = []; state.project = null;
    mainScreen.classList.add('hidden');
    $('#settings-panel').classList.add('hidden');
    $('#consent-modal')?.classList.add('hidden');
    authScreen.classList.remove('hidden');
    // переход на экран входа с чистым состоянием
    setTimeout(() => { try { window.location.reload(); } catch {} }, 1200);
  } catch (err) {
    btnDisableSelf('#btn-delete-account', false, '🗑 Удалить мой аккаунт и все данные');
    toast('Не удалось удалить: ' + friendlyError(err?.message || String(err)), true);
  }
});

$('#btn-ban-logout')?.addEventListener('click', async () => {
  try { await sb.auth.signOut(); } catch {}
  state.user = null; state.settings = {}; state.news = []; state.project = null;
  hideBanScreen();
  mainScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
});
$('#ban-screen-settings')?.addEventListener('click', () => $('#settings-panel').classList.toggle('hidden'));



function uuidv4() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.random() * 16 | 0;
    return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function registerDevice() {
  try {
    let deviceId = localStorage.getItem(DEVICE_KEY);
    if (!deviceId) { deviceId = uuidv4(); localStorage.setItem(DEVICE_KEY, deviceId); }
    const sp = (navigator.platform || 'PC').replace(/\s+/g, ' ').slice(0, 120);
    const name = sp + ' · ' + (navigator.userAgentData?.brands?.[0]?.brand || '');
    // получаем IP (быстро, неблокирующе) — если ошибка, пишем пусто
    let ip = '';
    try {
      const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      const j = await r.json();
      ip = j?.ip || '';
    } catch { /* офлайн или блок — не критично */ }
    await sb.rpc('upsert_my_device', {
      p_device_id: deviceId,
      p_device_name: name.slice(0, 200),
      p_platform: sp.slice(0, 80),
      p_user_agent: String(navigator.userAgent || '').slice(0, 512),
      p_app_version: CFG.LAUNCHER_VERSION,
      p_ip_address: ip,
    });
    try {
      const r = await sb.rpc('list_my_devices');
      const list = r?.data || [];
      const stored = JSON.parse(localStorage.getItem(KNOWN_DEVICES_KEY) || '[]');
      const newOnes = list.filter((d) => stored.length && !stored.includes(d.device_id));
      if (stored.length && newOnes.length) {
        toast('Новое устройство вошло в ваш аккаунт: ' + (newOnes[0].device_name || 'устройство') + '. Если это не вы — смените пароль.', true);
      }
      localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(list.map((d) => d.device_id)));
    } catch { /* ignore */ }
  } catch (e) {
    logLine('WARN', ['device register failed:', e?.message || e]);
  }
}


// ---------- Фоновая проверка целостности игры ----------
async function checkCacheIntegrity() {
  try {
    const raw = state.settings?.game_manifest;
    if (!raw) return; // манифест не настроен — ничего не проверяем
    let manifest;
    try { manifest = JSON.parse(raw); } catch { return; }
    if (!manifest || !Array.isArray(manifest.files)) return;
    const res = await window.launcher?.verifyCache?.(manifest, state.project?.id);
    if (!res) return;
    const broken = (res.report || []).filter((r) => !r.ok);
    const banner = $('#cache-banner');
    const textEl = $('#cache-banner-text');
    if (!banner || !textEl) return;
    if (broken.length) {
      textEl.textContent = 'Файлов игры: ' + broken.length + ' повреждено/отсутствует. Обновление будет докачано.';
      banner.classList.remove('hidden');
      logLine('WARN', ['cache integrity failed', 'broken=' + broken.length, 'version=' + (manifest.version || '?')]);
    } else {
      banner.classList.add('hidden');
    }
  } catch (e) {
    logLine('WARN', ['cache integrity check failed', e?.message || e]);
  }
}

$('#btn-cache-fix')?.addEventListener('click', () => {
  $('#cache-banner')?.classList.add('hidden');
  startDownload();
});
$('#btn-cache-dismiss')?.addEventListener('click', () => {
  $('#cache-banner')?.classList.add('hidden');
});

// =====================================================
//  СОГЛАШЕНИЕ И ПЕРСОНАЛЬНЫЕ ДАННЫЕ (блокирует вход без согласия)
// =====================================================
//  СОГЛАШЕНИЕ И ПЕРСОНАЛЬНЫЕ ДАННЫЕ (per-user, с одного ПК — независимо)
// =====================================================
const CONSENT_STORE = 'samot_consent_v3';
function consentState() {
  try {
    const raw = localStorage.getItem(CONSENT_STORE);
    const obj = raw ? JSON.parse(raw) : {};
    // миграция одноразового v1 → v2 (только один раз)
    const v1 = localStorage.getItem('samot_consent_v1');
    if (v1 === '1' && !obj._v1_migrated) {
      obj._v1_migrated = true;
      try { localStorage.setItem(CONSENT_STORE, JSON.stringify(obj)); } catch {}
      localStorage.removeItem('samot_consent_v1');
    }
    return obj;
  } catch { return {}; }
}
async function hasConsent(email) {
  if (!email) return false;
  try {
    const persisted = await window.launcher?.consentRead?.();
    if (persisted && typeof persisted === 'object' && persisted[String(email).toLowerCase()]) return true;
  } catch { /* сбой чтения — считаем, что не соглашались */ }
  const obj = consentState();
  if (obj[String(email).toLowerCase()]) {
    try { await window.launcher?.consentWrite?.(email); localStorage.removeItem(CONSENT_STORE); } catch {}
    return true;
  }
  // если был одноразовый v1 — перенесём
  const v1 = localStorage.getItem('samot_consent_v1');
  if (v1 === '1') {
    try { await grantConsent(email); localStorage.removeItem('samot_consent_v1'); } catch {}
    return true;
  }
  return false;
}
async function grantConsent(email) {
  if (!email) return;
  const obj = consentState();
  obj[String(email).toLowerCase()] = { at: Date.now(), version: 2 };
  try { localStorage.setItem(CONSENT_STORE, JSON.stringify(obj)); } catch {}
  try { await window.launcher?.consentWrite?.(email); } catch {}
}
async function revokeConsent(email) {
  if (!email) return;
  const obj = consentState();
  delete obj[String(email).toLowerCase()];
  try { localStorage.setItem(CONSENT_STORE, JSON.stringify(obj)); } catch {}
  try { await window.launcher?.consentClear?.(); } catch {}
}
function clearAllLocalAccountData() {
  // Очистить кэш, черновики и согласия этого пользователя / либо всё, если email не передан
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('samot_cache_') || k.startsWith('samot_news_draft')).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

async function ensureConsentThen(email) {
  const targetEmail = email || (state.user && state.user.email) || 'anonymous';
  if (await hasConsent(targetEmail)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const modal = $('#consent-modal');
    if (!modal) return resolve(true); // офлайн/старые файлы — не блокируем
    const rulesEl = $('#consent-agree-rules');
    const dataEl = $('#consent-agree-data');
    const serviceEl = $('#consent-agree-service');
    const acceptBtn = $('#consent-accept');
    const declineBtn = $('#consent-decline');
    const sync = () => { if (acceptBtn) acceptBtn.disabled = !(rulesEl?.checked && dataEl?.checked && serviceEl?.checked); };
    if (rulesEl) rulesEl.onchange = sync;
    if (dataEl) dataEl.onchange = sync;
    if (serviceEl) serviceEl.onchange = sync;
    if (acceptBtn) acceptBtn.onclick = async () => {
      await grantConsent(targetEmail);
      modal.classList.add('hidden');
      resolve(true);
    };
    if (declineBtn) declineBtn.onclick = async () => {
      modal.classList.add('hidden');
      try { await sb.auth.signOut(); } catch { /* ignore */ }
      mainScreen.classList.add('hidden');
      authScreen.classList.remove('hidden');
      resolve(false);
    };
    mainScreen.classList.add('hidden');
    modal.classList.remove('hidden');
    sync();
  });
}

async function enterApp() {
  const { data: { session } } = await sb.auth.getSession();
  const email = session?.user?.email || '';
  if (!(await ensureConsentThen(email))) return;
  state.user = session?.user || null;
  try { await registerDevice(); } catch {}
  logLine('INFO', ['boot: v' + CFG.LAUNCHER_VERSION, 'user=' + (state.user?.email || 'demo'), 'platform=' + navigator.platform, 'online=' + navigator.onLine]);

  // бан: если забанен — выкидываем без всякого API/базы
  const { data: myBan } = await sb
    .from('bans')
    .select('reason, banned_until')
    .gt('banned_until', new Date().toISOString())
    .maybeSingle();
  if (myBan) {
    logLine('WARN', ['user banned until', myBan.banned_until, 'reason:', myBan.reason || '-']);
    // пользователь остаётся залогинен: кнопки Поддержки видны
    showBanScreen(myBan);
    return;
  }
  if (!state.user) return;
  state.banned = null;
  hideBanScreen();

  authScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');

  const nickname = state.user.user_metadata?.nickname;
  const fallback = state.user.email?.split('@')[0] || 'игрок';
  $('#account-name').textContent = nickname || fallback;
  $('#account-email').textContent = state.user.email || '';
  $('#account-avatar').textContent = (nickname || fallback).trim().charAt(0).toUpperCase();

  syncSupportVisibility();
  await loadAll();
  try { await checkForLauncherUpdate(); } catch {}
  // Полностью автоматический режим: если доступна новая версия — скачать и установить молча
  if (state.latestLauncherUpdate) {
    try { document.getElementById('btn-update-now')?.click(); } catch { /* кнопка останется как запасной вариант */ }
  }
  // фоновая проверка целостности
  try { checkCacheIntegrity(); } catch {}
}

async function enterDemoMode() {
  state.user = { email: 'player@example.com', user_metadata: { nickname: 'Игрок' } };
  if (!(await ensureConsentThen(state.user.email))) return;
  syncSupportVisibility();
  authScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');

  $('#account-name').textContent = 'Игрок';
  $('#account-email').textContent = 'player@example.com · ДЕМО';
  $('#account-avatar').textContent = 'И';
  $('#tb-version').textContent = 'ДЕМО';

  state.projects = [...DEMO_DATA.projects];
  state.project = state.projects[0];
  localStorage.setItem(SELECTED_KEY, String(state.project.id));

  state.settings = { ...DEMO_DATA.settings };
  state.news = [...DEMO_DATA.news];

  renderNewsList();
  renderGamePanel();
  renderProjectList();
  renderProjectPill();
  await loadHomeData();
  renderHome();
  showView('home');
  state.installByProject = {};
  refreshCurrentInstall();
  paintSidebarProgress();
  renderActionButton();
  setStatus(t('ready'));
  setNewsStatus(`${t('news_updated')} · ${timeNow()} (демо)`);
}

async function initSettingsPanel() {
  const panel = $('#settings-panel');
  $('#btn-settings').addEventListener('click', () => panel.classList.toggle('hidden'));
  $('#btn-settings-close').addEventListener('click', () => panel.classList.add('hidden'));

  try {
    const ls = await window.launcher.getLauncherSettings();
    $('#set-autostart').checked = !!ls.autostart;
    if ($('#set-fullscreen')) $('#set-fullscreen').checked = !!ls.fullscreen;
    if ($('#set-tray')) $('#set-tray').checked = !!ls.trayOnClose;
    $('#set-install-path').textContent = ls.installPath || '—';
    applyTheme('orange', false);   // оранжевая — единственная тема
  } catch { /* вне Electron — дефолты */ }

  $('#set-autostart').addEventListener('change', async (e) => {
    try { await window.launcher.setLauncherSettings({ autostart: e.target.checked }); } catch {}
  });
  if ($('#set-fullscreen')) $('#set-fullscreen').addEventListener('change', async (e) => {
    try { await window.launcher.setFullscreen(e.target.checked); } catch {}
  });
  if ($('#set-tray')) $('#set-tray').addEventListener('change', async (e) => {
    try { await window.launcher.setTrayOnClose(e.target.checked); } catch {}
  });

  // Клик вне панели настроек — закрываем её
  document.addEventListener('click', (e) => {
    if (panel.classList.contains('hidden')) return;
    if (e.target.closest('#settings-panel') || e.target.closest('#btn-settings')) return;
    panel.classList.add('hidden');
  });
  $('#btn-choose-path').addEventListener('click', async () => {
    try {
      const ls = await window.launcher.chooseInstallPath();
      $('#set-install-path').textContent = ls.installPath;
      toast(currentLang === 'en' ? 'Folder updated.' : 'Папка обновлена.');
    } catch {}
  });
}

// =====================================================
//  СТАРТ
// =====================================================
(async function init() {
  const finishToLogin = () => {
    authScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
  };

  const finishToSplash = () => {
    mainScreen.classList.remove('hidden');
    authScreen.classList.add('hidden');
  };

  try {
    $('#tb-version').textContent = 'v' + CFG.LAUNCHER_VERSION;
    splashStep('Запускаем…', 8);

    // 1) Если пришли по Google OAuth — доигрываем PKCE
    const url = new URL(window.location.href);
    if (url.searchParams.get('code')) {
      const code = url.searchParams.get('code');
      url.searchParams.delete('code'); url.searchParams.delete('state');
      try { window.history.replaceState({}, '', url.pathname + (url.search || '')); } catch { /* ignore */ }
      try { await sb.auth.exchangeCodeForSession(code); } catch { /* пользователь увидит логин-экран */ }
    }

    // 2) Внешние настройки: тема, язык
    try {
      const ls = await window.launcher.getLauncherSettings();
      currentTheme = ls.theme || DEFAULT_THEME;
      applyI18n(ls.language || 'ru');
      applyTheme(currentTheme, false);
    } catch {
      applyI18n('ru');
      applyTheme(DEFAULT_THEME, false);
    }

    try { await initSettingsPanel(); } catch (e) { console.log('settings panel failed', e); }

    // 3) Доступность сервера (таймаут 5с)
    splashStep('Проверяем серверы…', 25);
    const online = await checkSupabaseReachable(5000);
    state.offline = !online;
    splashStatus.textContent = online
      ? 'Серверы онлайн ✓'
      : 'Сервер недоступен — офлайн-режим';

    if (DEMO_USER) {
      splashFill.style.width = '100%';
      await new Promise((r) => setTimeout(r, 700));
      await enterDemoMode();
      hideSplash();
      return;
    }

    // 4) Сессия из safeStorage + попытка освежить
    let session = null;
    try { const r = await sb.auth.getSession(); session = r?.data?.session || null; } catch { /* нет сессии — покажем вход */ }
    if (!session) {
      try { const r = await sb.auth.refreshSession(); session = r?.data?.session || null; } catch { /* время для показа логина */ }
    }

    splashStep(session ? 'Восстанавливаем сессию…' : 'Ожидаем вход…', 65);
    await new Promise((r) => setTimeout(r, 200));

    if (session) {
      splashStep('Загружаем проекты и новости…', 85);
      try { await enterApp(); } catch (e) { console.log('enterApp failed', e); }
      finishToSplash();
      hideSplash();
      return;
    }

    splashStep('Требуется авторизация', 100);
    await new Promise((r) => setTimeout(r, 300));
    syncSupportVisibility();
    finishToLogin();
    hideSplash();
  } catch (err) {
    console.error('startup crashed', err);
    try { toast('Ошибка запуска: ' + (err?.message || err), true); } catch {}
    finishToLogin();
    hideSplash();
  }
})();


// =====================================================
//  ПРЕДУПРЕЖДЕНИЯ (warnings) — полоска перед контентом
// =====================================================
if (window.SAMOT_DOCS_FILL) window.SAMOT_DOCS_FILL();
async function loadWarnings() {
  try {
    const { data, error } = await sb.rpc('list_my_warnings');
    if (error || !Array.isArray(data)) { renderWarningBanner([]); return; }
    state.warnings = data;
    const pid = state.project?.id;
    const matching = pid ? data.filter((w) => w.project_id === pid) : data;
    renderWarningBanner(matching);
  } catch (err) {
    console.warn('loadWarnings failed', err);
    renderWarningBanner([]);
  }
}

function renderWarningBanner(list) {
  const banner = $('#warning-banner');
  if (!banner) return;
  const sessionKey = 'samot_warning_dismissed_session';
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(sessionKey) === '1'; } catch { dismissed = false; }
  if (dismissed) { banner.classList.add('hidden'); return; }
  const w = (list || [])[0];
  if (!w) {
    banner.classList.add('hidden');
    return;
  }
  const projectName = w.project_name || 'Проект';
  const until = new Date(w.warned_until).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
  $('#warning-banner-project').textContent = projectName + ' (до ' + until + ')';
  banner.classList.remove('hidden');
  banner.dataset.id = String(w.id);
  banner.dataset.project = projectName;
  banner.dataset.reason = w.reason;
  banner.dataset.until = w.warned_until;
}

$('#btn-warning-detail')?.addEventListener('click', () => {
  const banner = $('#warning-banner');
  const modal = $('#warning-modal');
  if (!banner || !modal) return;
  $('#warning-modal-project').textContent = banner.dataset.project || '—';
  $('#warning-modal-reason').textContent = banner.dataset.reason || '—';
  $('#warning-modal-until').textContent = banner.dataset.until ? new Date(banner.dataset.until).toLocaleString('ru-RU') : '—';
  modal.classList.remove('hidden');
});
$('#warning-modal-close')?.addEventListener('click', () => $('#warning-modal').classList.add('hidden'));
$('#warning-modal')?.addEventListener('click', (e) => { if (e.target.id === 'warning-modal') $('#warning-modal').classList.add('hidden'); });
$('#btn-warning-dismiss')?.addEventListener('click', () => {
  try { sessionStorage.setItem('samot_warning_dismissed_session', '1'); } catch {}
  $('#warning-banner').classList.add('hidden');
});

// =====================================================
//  МОДАЛКИ — замена prompt()/confirm() (в Electron они не работают)
// =====================================================
function uiConfirm(opts) {
  const { title = 'Подтвердите действие', message = '', okLabel = 'ОК', danger = false } = opts || {};
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'ui-modal-backdrop';
    back.innerHTML =
      '<div class="ui-modal" role="dialog" aria-modal="true">' +
        '<div class="ui-modal-title' + (danger ? ' danger' : '') + '">' + escapeHtml(title) + '</div>' +
        (message ? '<div class="ui-modal-msg">' + escapeHtml(message) + '</div>' : '') +
        '<div class="ui-modal-actions">' +
          '<button class="btn btn-ghost" data-act="cancel" type="button">Отмена</button>' +
          '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok" type="button">' + escapeHtml(okLabel) + '</button>' +
        '</div>' +
      '</div>';
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } if (e.key === 'Enter') { e.preventDefault(); done(true); } };
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(false); });
    back.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
    back.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    back.querySelector('[data-act="ok"]').focus();
  });
}

function uiPrompt(opts) {
  const { title = 'Введите значение', label = '', value = '', placeholder = '', okLabel = 'Сохранить', danger = false, validate } = opts || {};
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'ui-modal-backdrop';
    back.innerHTML =
      '<div class="ui-modal" role="dialog" aria-modal="true">' +
        '<div class="ui-modal-title' + (danger ? ' danger' : '') + '">' + escapeHtml(title) + '</div>' +
        (label ? '<label class="ui-modal-msg">' + escapeHtml(label) + '</label>' : '') +
        '<input class="ui-modal-input" type="text" autocomplete="off" spellcheck="false" />' +
        '<div class="ui-modal-error" hidden></div>' +
        '<div class="ui-modal-actions">' +
          '<button class="btn btn-ghost" data-act="cancel" type="button">Отмена</button>' +
          '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok" type="button">' + escapeHtml(okLabel) + '</button>' +
        '</div>' +
      '</div>';
    const done = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const input = back.querySelector('.ui-modal-input');
    const errEl = back.querySelector('.ui-modal-error');
    input.value = value;
    input.placeholder = placeholder || '';
    const tryAccept = () => {
      const v = input.value;
      if (typeof validate === 'function') {
        const e2 = validate(v);
        if (e2) { errEl.textContent = e2; errEl.hidden = false; return; }
      }
      done(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } else if (e.key === 'Enter') { e.preventDefault(); tryAccept(); } };
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
    back.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
    back.querySelector('[data-act="ok"]').addEventListener('click', tryAccept);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    input.focus();
    input.select();
  });
}


// =====================================================
//  ПРАВОВАЯ ИНФОРМАЦИЯ (модалка с вкладками)
// =====================================================
(function initLegalModal() {
  const modal = document.getElementById('legal-modal');
  const openBtn = document.getElementById('btn-legal');
  const closeBtn = document.getElementById('btn-legal-close');
  const closeBtnAlt = document.getElementById('btn-legal-close-action');
  if (!modal || !openBtn) return;
  const showTab = (name) => {
    modal.querySelectorAll('[data-legal-tab]').forEach((b) => b.classList.toggle('active', b.dataset.legalTab === name));
    modal.querySelectorAll('.consent-body').forEach((el) => el.classList.add('hidden'));
    const target = document.getElementById('legal-doc-' + name);
    if (target) target.classList.remove('hidden');
  };
  const open = () => { modal.classList.remove('hidden'); };
  const close = () => { modal.classList.add('hidden'); };
  openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (closeBtnAlt) closeBtnAlt.addEventListener('click', close);
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
  modal.querySelectorAll('[data-legal-tab]').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.legalTab)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();