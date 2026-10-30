'use strict';
// Moji 1.0.7 asset E2E on the Linux GTK/WebKitGTK host. The real pinned
// renderer opens a test document through the native dialog, resolves a relative
// image to moji-asset://, and the runtime-owned broker serves it. The app's
// protocol handler is recorded but never executed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('./source-manifest.cjs');

const root = path.resolve(__dirname, '..');
const mojiRoot = path.join(root, '_build/Moji');
const stage = path.join(mojiRoot, '.emoon/app');
const binaryCandidates = [
  path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe'),
  path.join(root, '_build/native/debug/build/cmd/emoon/emoon'),
];
const binary = binaryCandidates.find(candidate => fs.existsSync(candidate)) || binaryCandidates[0];
const host = path.join(root, 'dist/emoon-host');
const reportPath = path.join(root, 'compatibility/reports/moji-assets.json');
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGO8o6Hxn4ECwMLAwMCgfP06WZrvampCDIBxSAEwS5nIshoJjBowasDgMACeF8jNUIyUZmcAzYUMTODIg2AAAAAASUVORK5CYII=',
  'base64');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function skip(reason) {
  writeReport({
    schema: 1,
    probe: 'moji-assets',
    status: 'SKIP',
    reason,
    compatible: false,
  });
  console.log(JSON.stringify({ status: 'SKIP', reason }));
  process.exit(0);
}

if (!fs.existsSync(path.join(stage, 'out/main/main.js')) ||
    !fs.existsSync(path.join(stage, 'out/renderer/index.html'))) {
  skip('prepared Moji 1.0.7 stage is not available');
}
if (!fs.existsSync(binary) || !fs.existsSync(host)) {
  skip('debug emoon binary or dist/emoon-host is not built');
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-assets-'));
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-assets-path-'));
const report = {
  schema: 1,
  probe: 'moji-assets',
  status: 'FAIL',
  compatible: false,
  environment: {
    platform: process.platform,
    node: process.version,
    hostSHA256: hashFile(host),
    cliSHA256: hashFile(binary),
  },
};

try {
  const staged = path.join(temp, 'app');
  fs.cpSync(stage, staged, {
    recursive: true,
    filter: source => {
      const relative = path.relative(stage, source).split(path.sep).join('/');
      return relative !== '.appData' && relative !== '.userData' &&
        !relative.startsWith('.appData/') && !relative.startsWith('.userData/') &&
        relative !== 'source-manifest.json';
    },
  });
  const profilePath = path.join(staged, 'nodeless-app.json');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  profile.assetSchemes = ['moji-asset'];
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  const files = walk(staged);
  const manifest = buildSourceManifest(staged, 'out/renderer/index.html', 'moji', files);
  writeSourceManifest(path.join(staged, 'source-manifest.json'), manifest);
  report.stage = {
    files: manifest.files.length,
    manifestSHA256: hashFile(path.join(staged, 'source-manifest.json')),
    mainSHA256: hashFile(path.join(staged, 'out/main/main.js')),
    rendererIndexSHA256: hashFile(path.join(staged, 'out/renderer/index.html')),
  };

  const assets = path.join(temp, 'documents');
  fs.mkdirSync(assets, { recursive: true });
  const documentPath = path.join(assets, 'note.md');
  fs.writeFileSync(documentPath, '# Image\n\n![pixel](pixel.png)\n');
  fs.writeFileSync(path.join(assets, 'pixel.png'), PIXEL);
  report.document = { path: 'note.md', imageBytes: PIXEL.length };

  const fakeNode = path.join(fakeBin, 'node');
  fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 99\n');
  fs.chmodSync(fakeNode, 0o700);
  const result = spawnSync(binary, [
    'run', staged, '--window', '--entry', 'out/main/main.js',
    '--hold', '--hold-seconds', '12', '--trigger-export-ui',
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      ELECTRON_MBT_TEST_MODE: '1',
      ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT: documentPath,
    },
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  const reports = lines.map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
  const holding = reports.find(entry => entry.status === 'HOLDING') || null;
  const exit = reports.find(entry => entry.status === 'HOLD_EXIT') || null;
  report.command = {
    exitCode: result.status,
    holding: holding ? { pageTitle: holding.pageTitle, assets: holding.assets } : null,
    exit: exit ? { reason: exit.reason, pageTitle: exit.pageTitle, assets: exit.assets, rendererProbe: exit.rendererProbe } : null,
  };
  const assetsReport = (exit && exit.assets) || (holding && holding.assets) || null;
  const probe = exit && exit.rendererProbe ? exit.rendererProbe : null;
  const problems = [];
  if (result.status !== 0) report.stderr = (result.stderr || '').slice(-4000);
  if (result.status !== 0) problems.push(`exit ${result.status}`);
  if (probe && probe.image) {
    report.rendererProbe = {
      status: probe.image.naturalWidth > 0 ? 'PASS' : 'FAIL',
      complete: probe.image.complete,
      naturalWidth: probe.image.naturalWidth,
      naturalHeight: probe.image.naturalHeight,
    };
    if (!(probe.image.naturalWidth > 0)) {
      problems.push('the Moji preview image element has zero width');
    }
  } else {
    // Moji's preview does not expose the relative image as a plain DOM <img>
    // at this point. The host-served bytes remain the assertion; the controlled
    // asset fixture covers WebKit decoding and naturalWidth.
    report.rendererProbe = { status: 'NOT_EXPOSED', probe: probe || null };
  }
  if (!assetsReport) problems.push('missing asset status');
  if (assetsReport) {
    if (assetsReport.mode !== 'asset-broker') problems.push('not in asset-broker mode');
    if (assetsReport.handlerExecuted !== false) problems.push('app handler was executed');
    if (!Array.isArray(assetsReport.schemes) || !assetsReport.schemes.includes('moji-asset')) {
      problems.push('moji-asset was not admitted');
    }
    if (!(assetsReport.served >= 1)) problems.push('no asset was served');
    if (assetsReport.denied !== 0) problems.push('an asset request was denied');
    if (assetsReport.bytes !== PIXEL.length) {
      problems.push(`served bytes ${assetsReport.bytes} != ${PIXEL.length}`);
    }
    report.assets = assetsReport;
  }
  if (problems.length > 0) {
    report.problems = problems;
    writeReport(report);
    console.error(JSON.stringify({ status: 'FAIL', problems }));
    process.exit(1);
  }
  report.status = 'PASS';
  const screenshot = path.join(root, 'docs/images/moji-assets-20261029.png');
  if (fs.existsSync(screenshot)) {
    report.visual = {
      path: 'docs/images/moji-assets-20261029.png',
      note: 'Separate manual run with a 96x96 PNG through the same stage and broker path; the red preview image is visibly rendered. The DOM probe still reports NOT_EXPOSED.',
    };
  }
  report.note = 'The pinned Moji renderer requested the relative image and the host broker served the exact bytes. The app protocol handler was not executed. The page probe did not expose a plain preview image element (NOT_EXPOSED); the controlled asset fixture covers WebKit decoding. This is not Electron protocol compatibility.';
  writeReport(report);
  console.log(JSON.stringify({
    status: 'PASS',
    served: assetsReport.served,
    bytes: assetsReport.bytes,
    schemes: assetsReport.schemes,
    handlerExecuted: assetsReport.handlerExecuted,
  }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(fakeBin, { recursive: true, force: true });
}
