// Тонкая обёртка: запускает tests/smoke-main.cjs через electron.
const { spawn } = require('child_process');
const path = require('path');

const electronBin = require('electron');
const child = spawn(electronBin, [path.join(__dirname, 'smoke-main.cjs'), '--disable-gpu'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => { console.error('smoke spawn error:', err); process.exit(1); });