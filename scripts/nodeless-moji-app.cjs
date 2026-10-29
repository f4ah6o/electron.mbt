'use strict';
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
const provenance = JSON.parse(fs.readFileSync(
  path.join(root, 'compatibility/apps/moji-v1.0.5/build-provenance.json'), 'utf8'));
const adapted = JSON.parse(fs.readFileSync(
  path.join(root, 'compatibility/apps/moji-v1.0.5/adapted-preload.json'), 'utf8'));
const adapterPath = path.join(root, adapted.adapter.path);
const reportPath = path.join(root, 'compatibility/reports/moji-nodeless-app.json');
const binary = path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe');
const hostBinary = path.join(root, 'dist/emoon-host');

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

if (process.platform !== 'darwin' || !fs.existsSync(hostBinary)) {
  writeReport({
    status: 'NOT_RUN',
    probe: 'moji-nodeless-app',
    reason: 'the native host is macOS-only or dist/emoon-host is missing',
    compatible: false,
  });
  process.exit(0);
}
if (!fs.existsSync(sourceMain) || !fs.existsSync(sourcePreload) ||
    !fs.existsSync(sourceRenderer) || !fs.existsSync(sourceSample) ||
    !fs.existsSync(adapterPath)) {
  writeReport({
    status: 'NOT_RUN',
    probe: 'moji-nodeless-app',
    reason: `pinned Moji source was not found at ${sourceRoot}`,
    compatible: false,
  });
  process.exit(0);
}
const mainSHA256 = hashFile(sourceMain);
const preloadSHA256 = hashFile(sourcePreload);
const adapterSHA256 = hashFile(adapterPath);
if (mainSHA256 !== provenance.hashes.main || preloadSHA256 !== provenance.hashes.preload ||
    adapterSHA256 !== adapted.adapter.sha256) {
  process.stderr.write('ELECTRON_MBT_MOJI_NODELESS_APP: source hash mismatch\n');
  process.exit(1);
}
const build = spawnSync('moon', ['build', '--target', 'native', 'cmd/emoon'], {
  cwd: root, encoding: 'utf8', timeout: 180000,
});
if (build.status !== 0 || !fs.existsSync(binary)) {
  process.stderr.write(`ELECTRON_MBT_MOJI_NODELESS_APP: build failed\n${build.stdout}\n${build.stderr}\n`);
  process.exit(1);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-nodeless-app-'));
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-nodeless-path-'));
const brokerProfile = {
  schema: 1,
  grants: [{ path: 'renderer-save.md', mode: 'readwrite' }],
  dialogs: [
    { kind: 'open', path: 'samples/markdown-guide.en.md' },
    { kind: 'save', path: 'renderer-save-as.md' },
    { kind: 'export-html', path: 'renderer-export.html' },
    { kind: 'export-png', path: 'renderer-export.png' },
    { kind: 'export-pdf', path: 'renderer-export.pdf' },
    { kind: 'export-doc-png', path: 'renderer-export-doc.png' },
  ],
};
try {
  fs.mkdirSync(path.join(temp, 'out/main'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'out/preload'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'adapted'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'samples'), { recursive: true });
  fs.cpSync(sourceRenderer, path.join(temp, 'out/renderer'), { recursive: true });
  fs.copyFileSync(sourceMain, path.join(temp, 'out/main/main.js'));
  fs.copyFileSync(sourcePreload, path.join(temp, 'out/preload/preload.js'));
  fs.copyFileSync(sourceSample, path.join(temp, 'samples/markdown-guide.en.md'));
  fs.copyFileSync(adapterPath, path.join(temp, 'adapted/page-api.js'));
  fs.writeFileSync(path.join(temp, 'package.json'),
    `${JSON.stringify({ name: 'moji', version: '1.0.5', main: 'out/main/main.js' }, null, 2)}\n`);
  fs.writeFileSync(path.join(temp, 'nodeless-app.json'),
    `${JSON.stringify({ schema: 1, profile: 'electron-nodeless-adapted-v1', adapter: 'adapted/page-api.js', assetSchemes: ['moji-asset'] }, null, 2)}\n`);
  fs.writeFileSync(path.join(temp, 'nodeless-broker.json'),
    `${JSON.stringify(brokerProfile, null, 2)}\n`);
  const rendererFiles = walk(path.join(temp, 'out/renderer'), temp);
  const files = [
    ...rendererFiles,
    'adapted/page-api.js',
    'nodeless-app.json',
    'nodeless-broker.json',
    'package.json',
    'out/main/main.js',
    'out/preload/preload.js',
    'samples/markdown-guide.en.md',
  ];
  const manifest = buildSourceManifest(temp, 'out/renderer/index.html', 'moji-nodeless-app', files);
  writeSourceManifest(path.join(temp, 'source-manifest.json'), manifest);
  const fakeNode = path.join(fakeBin, 'node');
  fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 99\n');
  fs.chmodSync(fakeNode, 0o700);
  const result = spawnSync(binary, [
    'run', temp, '--window', '--entry', 'out/main/main.js', '--broker-selftest',
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}` },
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  let parsed = null;
  try { parsed = JSON.parse(lines.at(-1)); } catch { parsed = null; }
  const pageText = parsed && parsed.renderer ? String(parsed.renderer.text || '') : '';
  const pageTitle = parsed ? String(parsed.pageTitle || '') : '';
  const adaptedReport = parsed && parsed.adapted ? parsed.adapted : {};
  const ingress = adaptedReport.ingress || {};
  const broker = parsed && parsed.broker ? parsed.broker : {};
  const apiProbe = broker.apiProbe && typeof broker.apiProbe === 'object' ? broker.apiProbe : {};
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function readOutput(name) {
    const file = path.join(temp, name);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
  const saved = readOutput('renderer-save.md');
  const savedAs = readOutput('renderer-save-as.md');
  const exportedHtml = readOutput('renderer-export.html');
  const exportedPdf = readOutput('renderer-export.pdf');
  const exportedPng = readOutput('renderer-export.png');
  const exportedDocPng = readOutput('renderer-export-doc.png');
  const brokerOutputs = {
    save: saved !== null && saved.toString('utf8') === '# renderer save\n',
    saveAs: savedAs !== null && savedAs.toString('utf8') === '# save-as\n',
    exportHtml: exportedHtml !== null && exportedHtml.toString('utf8').includes('<h1>renderer export</h1>'),
    exportPdf: exportedPdf !== null && exportedPdf.length > 4 && exportedPdf.subarray(0, 4).toString('ascii') === '%PDF',
    exportPng: exportedPng !== null && exportedPng.length >= 8 && exportedPng.subarray(0, 8).equals(pngMagic),
    exportDocPng: exportedDocPng !== null && exportedDocPng.length >= 8 && exportedDocPng.subarray(0, 8).equals(pngMagic),
  };
  const apiProbeOk = apiProbe.state === 'done' &&
    apiProbe.openOk === true && apiProbe.saveAsOk === true &&
    apiProbe.exportOk === true && apiProbe.pngOk === true &&
    apiProbe.pdfOk === true && apiProbe.pdfLandscapeOk === true &&
    apiProbe.docPngOk === true && apiProbe.updateCheckOk === true &&
    apiProbe.saveOk === true && apiProbe.readOk === true &&
    apiProbe.sampleOk === true && apiProbe.settingsTheme === 'dark' &&
    apiProbe.settingsSetOk === true && apiProbe.settingsLanguage === 'ja';
  const settingsFile = path.join(temp, '.appData/moji/settings.json');
  let settingsData = null;
  try {
    if (fs.existsSync(settingsFile)) {
      settingsData = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    }
  } catch {
    settingsData = null;
  }
  const settingsPersisted = settingsData !== null && settingsData.language === 'ja';
  const brokerOk = broker.configured === true && broker.triggered === true &&
    broker.grants === 1 && broker.dialogs === 6 && broker.error === '' &&
    apiProbeOk && settingsPersisted && Object.values(brokerOutputs).every(Boolean);
  const uiText = ['New', 'Open', 'Save', 'Preview', 'Editor', 'Export']
    .filter(label => pageText.includes(label));
  const ok = result.status === 0 && parsed && parsed.status === 'PASS' &&
    parsed.rendererLoaded === true && parsed.preloadExecuted === false &&
    parsed.pageURL === 'electron-mbt-app://app/out/renderer/index.html' &&
    pageTitle.includes('Moji') &&
    Number.isInteger(parsed.renderer && parsed.renderer.rootChildren) &&
    parsed.renderer.rootChildren > 0 &&
    parsed.renderer.apiPresent === true &&
    adaptedReport.configured === true && adaptedReport.observed === true &&
    adaptedReport.released === true &&
    Number.isInteger(adaptedReport.requests) && adaptedReport.requests >= 2 &&
    adaptedReport.replyErrors === 0 &&
    ingress.admitted >= 2 && ingress.denied === 0 &&
    brokerOk &&
    parsed.mainError === '' && parsed.lastRejection === '' &&
    parsed.hostShutdown === true && parsed.liveLeases === 0 &&
    parsed.nodeProcesses === 0 && parsed.compatible === false &&
    uiText.length >= 4;
  const report = {
    status: ok ? 'PASS' : 'FAIL',
    probe: 'moji-nodeless-app',
    sourceRoot,
    engine: parsed ? parsed.engine : 'quickjs-2026-06-04',
    profile: 'electron-nodeless-adapted-v1',
    strict: 'blocked',
    mainSHA256,
    preloadSHA256,
    adapterSHA256,
    rendererIndexSHA256: manifest.files.find(file => file.path === 'out/renderer/index.html').sha256,
    manifestSHA256: crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(temp, 'source-manifest.json'))).digest('hex'),
    bootGraphFiles: manifest.files.length,
    pageURL: parsed ? parsed.pageURL : '',
    pageTitle,
    rendererLoaded: parsed ? parsed.rendererLoaded : false,
    rootChildren: parsed && parsed.renderer ? parsed.renderer.rootChildren : 0,
    apiPresent: parsed && parsed.renderer ? parsed.renderer.apiPresent : false,
    pageText,
    uiText,
    adapted: adaptedReport,
    ingress,
    broker,
    apiProbe,
    brokerOutputs,
    settingsPersisted,
    settingsFile: {
      exists: settingsData !== null,
      language: settingsData !== null ? settingsData.language : null,
    },
    preloadExecuted: false,
    mainError: parsed ? parsed.mainError : null,
    lastRejection: parsed ? parsed.lastRejection : null,
    hostShutdown: parsed ? parsed.hostShutdown : false,
    liveLeases: parsed ? parsed.liveLeases : null,
    nodeProcesses: parsed ? parsed.nodeProcesses : null,
    assetScheme: 'electron-mbt-app://app',
    nodeFreeChildPath: true,
    rendererProvenance: 'main/preload/adapter hashes match build-provenance; the renderer tree is pinned per file by the generated source manifest, and the provenance renderer tree hash was not independently re-derived.',
    compatible: false,
    note: 'Pinned Moji main and real renderer run on the Node-less QuickJS runtime under the generated adapted page API. The original preload is NOT_EXECUTED; file/dialog/export paths use test-injected grants and are not production consent. No Electron compatibility is claimed.',
  };
  writeReport(report);
  if (!ok) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(fakeBin, { recursive: true, force: true });
}
