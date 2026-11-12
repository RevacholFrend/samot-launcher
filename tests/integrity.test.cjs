/**
 * Интегральные тесты SAMOT Launcher (клиент).
 * Запуск: npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (name) => fs.existsSync(path.join(ROOT, name));

test('все нужные файлы на месте', () => {
  for (const p of [
    'main.js', 'preload.js',
    'src/app.js', 'src/index.html', 'src/styles.css', 'src/config.js', 'src/theme.config.js', 'src/documents.js',
    'assets/logoClient.svg', 'assets/iconClient.ico', 'assets/wallpaper-dark.png',
    'supabase/schema.sql',
  ]) {
    assert.ok(has(p), `нет файла: ${p}`);
  }
});

test('все JS-файлы компилируются (vm.compileFunction)', () => {
  for (const p of ['main.js', 'preload.js', 'src/app.js', 'src/config.js', 'src/theme.config.js', 'src/documents.js']) {
    const src = read(p);
    assert.doesNotThrow(() => new vm.Script(src, { filename: p }), `синтаксическая ошибка в ${p}`);
  }
});

test('HTML id, которые читает JS (unguarded binds), существуют в index.html', () => {
  const html = read('src/index.html');
  const js = read('src/app.js');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const direct = [...new Set([...js.matchAll(/\$\(\s*'#([A-Za-z0-9_-]+)'\)\.addEventListener/g)].map((m) => m[1]))];
  const missing = direct.filter((id) => !htmlIds.has(id));
  assert.deepStrictEqual(missing, [], `в HTML отсутствуют id: ${missing.join(', ')}`);
});

test('каросельная логика и чтение баннеров присутствуют', () => {
  const js = read('src/app.js');
  assert.ok(js.includes("eq('carousel', true)"), 'карусель: нет запроса carousel-баннеров');
  assert.ok(js.includes("kind === 'news'"), 'openHomeSlide должен фильтровать kind=news');
  const html = read('src/index.html');
  assert.ok(html.includes('home-hero-label">Карусель<'), 'на главной нет метки «Карусель» в hero');
});

test('миграции упорядочены, есть v25 с carousel-колонками', () => {
  const dir = path.join(ROOT, 'supabase');
  const files = fs.readdirSync(dir).filter((f) => /^migration-v\d+\.sql$/.test(f));
  const nums = files.map((f) => Number(f.match(/v(\d+)\.sql/)[1])).sort((a, b) => a - b);
  for (let i = 1; i < nums.length; i++) {
    assert.ok(nums[i] >= nums[i - 1], `номера миграций не по порядку на v${nums[i]}`);
  }
  assert.ok(nums.includes(25), 'нет migration-v25.sql (kind/carousel/cta_url для баннеров)');
});

test('v25 содержит kind/carousel/cta_url в news (идемпотентно)', () => {
  const sql = read('supabase/migration-v25.sql');
  assert.ok(/alter table public\.news add column if not exists kind/.test(sql));
  assert.ok(/alter table public\.news add column if not exists carousel/.test(sql));
  assert.ok(/alter table public\.news add column if not exists cta_url/.test(sql));
});
