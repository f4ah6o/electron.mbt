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
const record = JSON.parse(fs.readFileSync(path.join(root, 'compatibility/apps/moji-v1.0.5/adapted-preload.json'), 'utf8'));
const adapterPath = path.join(root, record.adapter.path);
const harnessPath = path.join(root, 'fixtures/moji-boot/harness.js');
const reportPath = path.join(root, 'compatibility/reports/moji-adapted-native.json');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
if (!fs.existsSync(mainPath) || !fs.existsSync(preloadPath)) {
  process.stdout.write(`${JSON.stringify({
    status: 'NOT_RUN',
    probe: 'moji-adapted-native',
    reason: `pinned Moji source not found at ${sourceRoot}`,
    compatible: false,
  })}\n`);
  process.exit(0);
}
const mainSHA256 = hashFile(mainPath);
const preloadSHA256 = hashFile(preloadPath);
const adapterSHA256 = hashFile(adapterPath);
const harnessSHA256 = hashFile(harnessPath);
if (mainSHA256 !== provenance.hashes.main || preloadSHA256 !== provenance.hashes.preload ||
    adapterSHA256 !== record.adapter.sha256) {
  process.stderr.write('ELECTRON_MBT_MOJI_ADAPTED_NATIVE: source hash mismatch\n');
  process.exit(1);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-native-'));
try {
  fs.mkdirSync(path.join(temp, 'out/main'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'out/preload'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'adapted'), { recursive: true });
  fs.copyFileSync(mainPath, path.join(temp, 'out/main/main.js'));
  fs.copyFileSync(preloadPath, path.join(temp, 'out/preload/preload.js'));
  fs.copyFileSync(adapterPath, path.join(temp, 'adapted/page-api.js'));
  fs.copyFileSync(harnessPath, path.join(temp, 'harness.js'));
  fs.writeFileSync(path.join(temp, 'package.json'),
    `${JSON.stringify({ name: 'moji', version: '1.0.5', main: 'out/main/main.js' }, null, 2)}\n`);
  fs.writeFileSync(path.join(temp, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>moji-adapted-booting</title></head>
<body><div id="probe">booting</div>
<script>
(async function () {
  const finish = function (value) {
    document.title = value;
    const node = document.getElementById('probe');
    if (node) node.textContent = value;
  };
  try {
    const api = window.api;
    if (!api || typeof api.getSettings !== 'function') return finish('moji-adapted-missing');
    const settings = await api.getSettings();
    const update = await api.getUpdateState();
    if (!settings || settings.previewTheme !== 'dark') return finish('moji-adapted-bad-settings');
    if (!update || update.status !== 'unsupported') return finish('moji-adapted-bad-update');
    finish('moji-adapted-ready:' + settings.previewTheme + ':' + update.status);
  } catch (error) {
    finish('moji-adapted-failed:' + String(error && error.code || error));
  }
})();
</script></body></html>
`);
  const manifest = buildSourceManifest(temp, 'index.html', 'moji-adapted-native', [
    'index.html', 'adapted/page-api.js', 'package.json', 'out/main/main.js',
    'out/preload/preload.js', 'harness.js',
  ]);
  writeSourceManifest(path.join(temp, 'source-manifest.json'), manifest);
  const result = spawnSync('moon', ['run', '--target', 'native', 'native/supervisor'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 90000,
    env: {
      ...process.env,
      ELECTRON_MBT_MOJI_APP: '1',
      ELECTRON_MBT_MOJI_BOOT_ROOT: temp,
    },
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(Boolean);
  const raw = lines.filter(line => line.startsWith('{') && line.endsWith('}')).at(-1);
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    process.stderr.write(`ELECTRON_MBT_MOJI_ADAPTED_NATIVE: no JSON report\n${result.stdout}\n${result.stderr}\n`);
    process.exit(1);
  }
  const ok = result.status === 0 && parsed.status === 'PASS' &&
    parsed.probe === 'moji-adapted-native' && parsed.pageLoaded === true &&
    parsed.apiPresent === true && parsed.settingsTheme === 'dark' &&
    parsed.updateStatus === 'unsupported' && parsed.mainHandlers === true &&
    parsed.compatible === false;
  const report = {
    ...parsed,
    status: ok ? 'PASS' : 'FAIL',
    sourceRoot,
    mainSHA256,
    preloadSHA256,
    adapterSHA256,
    harnessSHA256,
    bootGraphFiles: manifest.files.length,
    preloadExecuted: false,
    rendererLoaded: false,
    compatible: false,
    note: 'Moji page-world adapted API → native ingress → QuickJS Moji settings/update handlers; original preload NOT_EXECUTED.',
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!ok) process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
