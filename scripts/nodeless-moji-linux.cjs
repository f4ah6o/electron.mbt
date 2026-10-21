'use strict';
/*
 * Experimental Linux boot harness for the pinned Moji app.
 *
 * This deliberately covers only the real main + real renderer boot path. The
 * Linux host does not implement the file broker, dialogs, export or the
 * original preload, so this is not app acceptance and not Electron
 * compatibility. The report is written only when the pinned source and the
 * Linux host are present; non-Linux runs never overwrite the recorded result.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('./source-manifest.cjs');

const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji';
const sourceMain = path.join(sourceRoot, 'out/main/main.js');
const sourcePreload = path.join(sourceRoot, 'out/preload/preload.js');
const sourceRenderer = path.join(sourceRoot, 'out/renderer');
const sourceSample = path.join(sourceRoot, 'samples/markdown-guide.en.md');
const hostBinary = path.join(root, 'dist/electron-mbt-native-host-linux');
const binaryCandidates = [
  path.join(root, '_build/native/debug/build/native/nodeless/nodeless.exe'),
  path.join(root, '_build/native/debug/build/native/nodeless/nodeless'),
];
const reportPath = path.join(root, 'compatibility/reports/moji-linux-boot.json');
const provenance = JSON.parse(fs.readFileSync(
  path.join(root, 'compatibility/apps/moji-v1.0.5/build-provenance.json'), 'utf8'));
const adapted = JSON.parse(fs.readFileSync(
  path.join(root, 'compatibility/apps/moji-v1.0.5/adapted-preload.json'), 'utf8'));
const adapterPath = path.join(root, adapted.adapter.path);
const adapterSource = adapted.adapter.path;

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function walk(directory, base) {
  const out = [];
  for (const name of fs.readdirSync(directory)) {
    const absolute = path.join(directory, name);
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) out.push(...walk(absolute, base));
    else if (stat.isFile()) out.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return out;
}
function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, reportPath);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
function notRun(reason) {
  process.stdout.write(`${JSON.stringify({
    schema: 1,
    probe: 'moji-linux-boot',
    status: 'NOT_RUN',
    reason,
    compatible: false,
  })}\n`);
  process.exit(0);
}
function buildBinary() {
  const build = spawnSync('moon', ['build', '--target', 'native', 'native/nodeless'], {
    cwd: root, encoding: 'utf8', timeout: 180000,
  });
  if (build.status !== 0) return null;
  return binaryCandidates.find(candidate => fs.existsSync(candidate)) || null;
}

if (process.platform !== 'linux') notRun('the Linux native host requires Linux');
if (!fs.existsSync(hostBinary)) notRun('dist/electron-mbt-native-host-linux is missing');
if (!fs.existsSync(sourceMain) || !fs.existsSync(sourcePreload) ||
    !fs.existsSync(sourceRenderer) || !fs.existsSync(sourceSample) ||
    !fs.existsSync(adapterPath)) {
  notRun(`pinned Moji source was not found at ${sourceRoot}`);
}
const mainSHA256 = hashFile(sourceMain);
const preloadSHA256 = hashFile(sourcePreload);
const adapterSHA256 = hashFile(adapterPath);
const rendererIndex = path.join(sourceRenderer, 'index.html');
if (!fs.existsSync(rendererIndex)) notRun('pinned Moji renderer/index.html is missing');
if (mainSHA256 !== provenance.hashes.main || preloadSHA256 !== provenance.hashes.preload ||
    adapterSHA256 !== adapted.adapter.sha256) {
  writeReport({
    schema: 1,
    probe: 'moji-linux-boot',
    status: 'FAIL',
    code: 'ELECTRON_MBT_MOJI_SOURCE_HASH',
    reason: 'pinned Moji main/preload/adapter hashes do not match the recorded provenance',
    compatible: false,
  });
  process.exit(1);
}
const binary = buildBinary();
if (binary == null) {
  writeReport({
    schema: 1,
    probe: 'moji-linux-boot',
    status: 'FAIL',
    code: 'ELECTRON_MBT_NODELESS_BUILD',
    reason: 'native/nodeless did not build',
    compatible: false,
  });
  process.exit(1);
}

const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-linux-'));
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-linux-path-'));
try {
  fs.mkdirSync(path.join(appDir, 'out/main'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'out/preload'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'adapted'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'samples'), { recursive: true });
  fs.cpSync(sourceRenderer, path.join(appDir, 'out/renderer'), { recursive: true });
  fs.copyFileSync(sourceMain, path.join(appDir, 'out/main/main.js'));
  fs.copyFileSync(sourcePreload, path.join(appDir, 'out/preload/preload.js'));
  fs.copyFileSync(sourceSample, path.join(appDir, 'samples/markdown-guide.en.md'));
  fs.copyFileSync(adapterPath, path.join(appDir, 'adapted/page-api.js'));
  fs.writeFileSync(path.join(appDir, 'package.json'),
    `${JSON.stringify({ name: 'moji', version: '1.0.5', main: 'out/main/main.js' }, null, 2)}\n`);
  fs.writeFileSync(path.join(appDir, 'nodeless-app.json'),
    `${JSON.stringify({ schema: 1, profile: 'electron-nodeless-adapted-v1', adapter: 'adapted/page-api.js' }, null, 2)}\n`);
  const files = [
    ...walk(path.join(appDir, 'out/renderer'), appDir),
    'adapted/page-api.js',
    'nodeless-app.json',
    'package.json',
    'out/main/main.js',
    'out/preload/preload.js',
    'samples/markdown-guide.en.md',
  ];
  const manifest = buildSourceManifest(appDir, 'out/renderer/index.html', 'moji-linux-boot', files);
  writeSourceManifest(path.join(appDir, 'source-manifest.json'), manifest);
  const fakeNode = path.join(fakeBin, 'node');
  fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 99\n');
  fs.chmodSync(fakeNode, 0o700);
  const result = spawnSync(binary, [
    'run', appDir, '--window', '--entry', 'out/main/main.js',
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 45000,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      DISPLAY: process.env.DISPLAY || ':10.0',
      GDK_BACKEND: 'x11',
      WEBKIT_DISABLE_COMPOSITING_MODE: '1',
      LIBGL_ALWAYS_SOFTWARE: '1',
    },
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  let report = null;
  try { report = lines.length ? JSON.parse(lines.at(-1)) : null; } catch {}
  const adaptedReport = report && report.adapted ? report.adapted : {};
  const ingress = adaptedReport.ingress || {};
  const ok = result.status === 0 && report && report.status === 'PASS' &&
    report.platform === 'linux' &&
    report.pageTitle === 'Moji v1.0.5' &&
    report.pageURL === 'electron-mbt-app://app/out/renderer/index.html' &&
    report.rendererLoaded === true && report.preloadExecuted === false &&
    report.mainError === '' && report.hostShutdown === true &&
    report.liveLeases === 0 && report.nodeProcesses === 0 &&
    adaptedReport.configured === true && adaptedReport.observed === true &&
    adaptedReport.released === true && adaptedReport.requests >= 2 &&
    adaptedReport.replyErrors === 0 && ingress.admitted >= 2 && ingress.denied === 0 &&
    report.compatible === false;
  const output = {
    schema: 1,
    probe: 'moji-linux-boot',
    status: ok ? 'PASS' : 'FAIL',
    mode: 'linux-native-boot',
    platform: report ? report.platform : 'linux',
    arch: report ? report.arch : null,
    app: {
      id: 'moji-v1.0.5',
      mainSHA256,
      preloadSHA256,
      rendererIndexSHA256: hashFile(rendererIndex),
      adapterSHA256,
      adapter: adapterSource,
    },
    runtime: {
      engine: 'quickjs-2026-06-04',
      profile: 'electron-nodeless-adapted-v1',
      strict: 'blocked',
      hostSHA256: hashFile(hostBinary),
    },
    window: report ? {
      pageTitle: report.pageTitle,
      pageURL: report.pageURL,
      rendererLoaded: report.rendererLoaded,
      documentGeneration: report.documentGeneration,
    } : null,
    adapted: report ? {
      configured: adaptedReport.configured,
      observed: adaptedReport.observed,
      released: adaptedReport.released,
      requests: adaptedReport.requests,
      replyErrors: adaptedReport.replyErrors,
      ingress,
    } : null,
    main: report ? {
      error: report.mainError,
      hostShutdown: report.hostShutdown,
      liveLeases: report.liveLeases,
      nodeProcesses: report.nodeProcesses,
    } : null,
    preloadExecuted: false,
    broker: 'NOT_IMPLEMENTED',
    humanInput: false,
    compatible: false,
    notVerified: [
      'file-broker',
      'main-fs',
      'dialogs',
      'export',
      'grant-persistence',
      'human-input',
      'original-preload',
      'updater-behavior',
      'linux-native-sender-frame-authority',
      'strict-profile',
      'macos-suite-for-this-run',
    ],
    limits: [
      'The real Moji main and Vite renderer boot; file open/save/export, dialogs, main fs and the broker are not implemented on the Linux host.',
      'The screenshot is the initial UI only; no human file selection, IME, save, export or restart was exercised.',
      'The original preload is NOT_EXECUTED; the generated adapted page API is used.',
      'Native main-frame sender/frame authority is unproven (WebKitGTK lacks WKScriptMessage.frameInfo).',
      'Linux results are not macOS/WebKit compatibility evidence and do not promote a profile or A-J row.'
    ],
    note: 'Experimental boot evidence only. compatible:false, strict BLOCKED, original preload NOT_EXECUTED.',
  };
  writeReport(output);
  if (!ok) {
    process.stderr.write(`moji-linux-boot: FAIL\n${result.stdout || ''}\n${result.stderr || ''}\n`);
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.rmSync(fakeBin, { recursive: true, force: true });
}
