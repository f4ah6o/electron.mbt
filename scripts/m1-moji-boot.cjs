'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji';
const mainPath = path.join(sourceRoot, 'out/main/main.js');
const preloadPath = path.join(sourceRoot, 'out/preload/preload.js');
const provenancePath = path.join(root, 'compatibility/apps/moji-v1.0.5/build-provenance.json');
const reportPath = path.join(root, 'compatibility/reports/moji-boot.json');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
if (!fs.existsSync(mainPath) || !fs.existsSync(preloadPath)) {
  process.stdout.write(`${JSON.stringify({
    status: 'NOT_RUN',
    probe: 'moji-main-boot',
    reason: `pinned Moji source not found at ${sourceRoot}`,
    compatible: false,
  })}\n`);
  process.exit(0);
}
const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
const mainSHA256 = hashFile(mainPath);
const preloadSHA256 = hashFile(preloadPath);
const harnessPath = path.join(root, 'fixtures/moji-boot/harness.js');
const harnessSHA256 = hashFile(harnessPath);
if (mainSHA256 !== provenance.hashes.main || preloadSHA256 !== provenance.hashes.preload) {
  process.stderr.write('ELECTRON_MBT_MOJI_BOOT: source hash mismatch\n');
  process.exit(1);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-boot-'));
try {
  fs.mkdirSync(path.join(temp, 'out/main'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'out/preload'), { recursive: true });
  fs.copyFileSync(mainPath, path.join(temp, 'out/main/main.js'));
  fs.copyFileSync(preloadPath, path.join(temp, 'out/preload/preload.js'));
  fs.copyFileSync(harnessPath, path.join(temp, 'harness.js'));
  fs.writeFileSync(path.join(temp, 'package.json'),
    `${JSON.stringify({ name: 'moji', version: '1.0.5', main: 'out/main/main.js' }, null, 2)}\n`);
  const manifest = spawnSync(process.execPath, [
    'scripts/source-manifest.cjs',
    '--root', temp,
    '--entry', 'out/main/main.js',
    '--out', path.join(temp, 'source-manifest.json'),
    '--app', 'moji-boot',
    '--files', 'package.json,out/main/main.js,out/preload/preload.js,harness.js',
  ], { cwd: root, encoding: 'utf8' });
  if (manifest.status !== 0) {
    process.stderr.write(`ELECTRON_MBT_MOJI_BOOT: manifest failed\n${manifest.stdout}\n${manifest.stderr}\n`);
    process.exit(1);
  }
  const result = spawnSync('moon', ['run', '--target', 'native', 'native/supervisor'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 90000,
    env: {
      ...process.env,
      ELECTRON_MBT_MOJI_BOOT: '1',
      ELECTRON_MBT_MOJI_BOOT_ROOT: temp,
    },
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(Boolean);
  const raw = lines.filter(line => line.startsWith('{') && line.endsWith('}')).at(-1);
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    process.stderr.write(`ELECTRON_MBT_MOJI_BOOT: no JSON report\n${result.stdout}\n${result.stderr}\n`);
    process.exit(1);
  }
  const ok = result.status === 0 && parsed.status === 'PASS' &&
    parsed.probe === 'moji-main-boot' && parsed.app === 'moji-v1.0.5' &&
    parsed.entry === 'out/main/main.js' && parsed.mainEvaluated === true &&
    parsed.whenReady === true && Number.isInteger(parsed.windows) && parsed.windows >= 1 &&
    parsed.ipcHandlers === 14 && parsed.preloadPresent === true &&
    parsed.preloadExecuted === false && parsed.compatible === false;
  const report = {
    ...parsed,
    status: ok ? 'PASS' : 'FAIL',
    sourceRoot,
    mainSHA256,
    preloadSHA256,
    harnessSHA256,
    bootGraphFiles: 4,
    compatible: false,
    note: 'Moji main boot smoke in QuickJS with a virtual Electron facade; original preload NOT_EXECUTED.',
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!ok) process.exitCode = 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
