'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('./source-manifest.cjs');

const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji';
const mainPath = path.join(sourceRoot, 'out/main/main.js');
const preloadPath = path.join(sourceRoot, 'out/preload/preload.js');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'compatibility/apps/moji-v1.0.5/build-provenance.json'), 'utf8'));
const reportPath = path.join(root, 'compatibility/reports/moji-nodeless-boot.json');
const binary = path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

if (process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/emoon-host'))) {
  const report = {
    status: 'NOT_RUN',
    probe: 'moji-nodeless-boot',
    reason: 'native host is macOS-only or dist/emoon-host is missing',
    compatible: false,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}
if (!fs.existsSync(mainPath) || !fs.existsSync(preloadPath)) {
  const report = {
    status: 'NOT_RUN',
    probe: 'moji-nodeless-boot',
    reason: `pinned Moji source not found at ${sourceRoot}`,
    compatible: false,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}
const mainSHA256 = hashFile(mainPath);
const preloadSHA256 = hashFile(preloadPath);
if (mainSHA256 !== provenance.hashes.main || preloadSHA256 !== provenance.hashes.preload) {
  process.stderr.write('ELECTRON_MBT_MOJI_NODELESS_BOOT: source hash mismatch\n');
  process.exit(1);
}
const build = spawnSync('moon', ['build', '--target', 'native', 'cmd/emoon'], {
  cwd: root, encoding: 'utf8', timeout: 180000,
});
if (build.status !== 0 || !fs.existsSync(binary)) {
  process.stderr.write(`ELECTRON_MBT_MOJI_NODELESS_BOOT: build failed\n${build.stdout}\n${build.stderr}\n`);
  process.exit(1);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-nodeless-'));
try {
  fs.mkdirSync(path.join(temp, 'out/main'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'out/preload'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'out/renderer'), { recursive: true });
  fs.copyFileSync(mainPath, path.join(temp, 'out/main/main.js'));
  fs.copyFileSync(preloadPath, path.join(temp, 'out/preload/preload.js'));
  const probe = '<!doctype html>\n<html><head><meta charset="utf-8"><title>moji-nodeless-loading</title></head>\n' +
    '<body><div id="root"></div><script>document.title = \'moji-nodeless-ready\';</script></body></html>\n';
  fs.writeFileSync(path.join(temp, 'out/renderer/index.html'), probe);
  fs.writeFileSync(path.join(temp, 'package.json'),
    `${JSON.stringify({ name: 'moji', version: '1.0.5', main: 'out/main/main.js' }, null, 2)}\n`);
  const manifest = buildSourceManifest(temp, 'out/renderer/index.html', 'moji-nodeless', [
    'package.json', 'out/main/main.js', 'out/preload/preload.js', 'out/renderer/index.html',
  ]);
  writeSourceManifest(path.join(temp, 'source-manifest.json'), manifest);
  const result = spawnSync(binary, ['run', temp, '--window', '--entry', 'out/main/main.js'], {
    cwd: root, encoding: 'utf8', timeout: 60000,
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  let parsed = null;
  try { parsed = JSON.parse(lines.at(-1)); } catch { parsed = null; }
  const ok = result.status === 0 && parsed && parsed.status === 'PASS' &&
    parsed.pageTitle === 'moji-nodeless-ready' && parsed.windowLoaded === true &&
    parsed.hostShutdown === true && parsed.liveLeases === 0 &&
    parsed.lastRejection === '' && parsed.compatible === false;
  const report = {
    status: ok ? 'PASS' : 'FAIL',
    probe: 'moji-nodeless-boot',
    sourceRoot,
    mainSHA256,
    preloadSHA256,
    probeSHA256: crypto.createHash('sha256').update(probe).digest('hex'),
    bootGraphFiles: manifest.files.length,
    mainEvaluated: parsed ? parsed.app && parsed.app.entry === 'out/main/main.js' : false,
    windowLoaded: parsed ? parsed.windowLoaded : false,
    pageTitle: parsed ? parsed.pageTitle : '',
    preloadExecuted: false,
    rendererLoaded: false,
    adaptedImports: ['electron-updater', 'node:fs', 'node:fs/promises', 'node:zlib'],
    fsMode: 'host-backed app-root read and appData/userData atomic write; session user-file grants via dialog/test control; grant persistence and streams remain open',
    zlibMode: 'host-backed createDeflate with stored fallback',
    updaterMode: 'explicit import-only autoUpdater adaptation',
    lastRejection: parsed ? parsed.lastRejection : null,
    liveLeases: parsed ? parsed.liveLeases : null,
    nodeProcesses: parsed ? parsed.nodeProcesses : null,
    compatible: false,
    note: 'Pinned Moji main boots on the Node-less runtime against a probe page; the original preload and real renderer are NOT executed.',
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!ok) process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
