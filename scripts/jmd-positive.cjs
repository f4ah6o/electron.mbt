'use strict';
// Positive jmd v0.2.3 smoke: boot the adapted stage, drive the real open
// dialog through a CLI-only main hook, and read the preview marker. The source
// is the pinned checkout; only the staged copy is adapted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.resolve(process.env.JMD_SOURCE || path.join(root, '_build/jmd-positive-src'));
const stage = path.join(root, '_build/jmd-positive-stage');
const documentDir = path.join(root, '_build/jmd-positive-doc');
const documentPath = path.join(documentDir, 'note.md');
const reportPath = path.join(root, 'compatibility/reports/jmd-positive.json');
const adaptationPath = path.join(root, 'compatibility/reports/jmd-positive-adaptation.json');
const revision = 'f875fc616feb89ea803a0fc140ec770a2ade041e';
const marker = 'jmd-positive-marker-20261029';
const required = process.env.CI === 'true' || process.env.JMD_REQUIRE_SOURCE === '1';

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function finish(report, code) {
  writeReport(report);
  console.log(JSON.stringify({
    status: report.status,
    reason: report.reason,
    pageTitle: report.result && report.result.pageTitle,
    preview: report.result && report.result.preview,
  }));
  process.exit(code);
}

function skip(reason) {
  const report = {
    schema: 1,
    probe: 'jmd-positive',
    status: 'NOT_RUN',
    reason,
    revision,
    compatible: false,
    originalPreload: 'NOT_EXECUTED',
  };
  if (required) {
    report.status = 'FAIL';
    report.reason = `${reason}; pinned source/build is required in CI`;
    finish(report, 1);
  }
  finish(report, 0);
}

if (!fs.existsSync(path.join(source, 'electron/main.js'))) skip(`pinned source missing at ${path.relative(root, source)}`);
const head = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
if (head.status !== 0 || head.stdout.trim() !== revision) skip(`source is not pinned ${revision}`);
if (!fs.existsSync(path.join(source, 'dist/index.html'))) {
  skip(`renderer build missing at ${path.relative(root, source)}/dist; run npm ci --ignore-scripts && npm run build`);
}

const binary = [path.join(root, 'dist/emoon'), path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe')]
  .find(candidate => fs.existsSync(candidate));
if (!binary) skip('emoon binary is not built');

const adapt = spawnSync(process.execPath, ['scripts/jmd-adapt.cjs'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, JMD_SOURCE: source, JMD_STAGE: stage, JMD_DOC_DIR: documentDir },
});
if (adapt.status !== 0) {
  const report = {
    schema: 1,
    probe: 'jmd-positive',
    status: 'FAIL',
    reason: 'jmd adaptation failed',
    stderr: (adapt.stderr || '').slice(-2048),
    compatible: false,
  };
  finish(report, 1);
}

let adaptation = null;
try { adaptation = JSON.parse(fs.readFileSync(adaptationPath, 'utf8')); } catch (_) {}
if (!adaptation || adaptation.status !== 'PASS') {
  finish({
    schema: 1, probe: 'jmd-positive', status: 'FAIL',
    reason: 'adaptation report missing or not PASS', compatible: false,
  }, 1);
}

const env = {
  ...process.env,
  ELECTRON_MBT_TEST_MODE: '1',
  ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT: documentPath,
};
const args = ['run', stage, '--window', '--hold', '--hold-seconds', '15', '--dispatch-main', 'test:open-dialog'];
const run = spawnSync(binary, args, {
  cwd: root, encoding: 'utf8', timeout: 45000, env,
});
const output = `${run.stdout || ''}\n${run.stderr || ''}`;
const frames = output.split('\n').map(line => line.trim())
  .filter(line => line.startsWith('{') && line.endsWith('}'))
  .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
  .filter(Boolean);
const holding = frames.find(frame => frame.status === 'HOLDING') || null;
const exit = frames.find(frame => frame.status === 'HOLD_EXIT') || null;
const preview = exit && exit.rendererProbe && typeof exit.rendererProbe.preview === 'string'
  ? exit.rendererProbe.preview : '';
const dispatchResult = exit && exit.mainDispatch && exit.mainDispatch.ok === true
  ? exit.mainDispatch.result : '';

const checks = {
  exitZero: run.status === 0,
  holdExit: !!(exit && exit.status === 'HOLD_EXIT'),
  adaptedBoot: !!(holding && holding.adapted === true && holding.released === true),
  pageUrl: !!(exit && exit.pageURL === 'electron-mbt-app://app/dist/index.html'),
  windowTitle: !!(exit && typeof exit.windowTitle === 'string' && exit.windowTitle.includes('note.md')),
  initialUi: !!(exit && exit.rendererProbe && typeof exit.rendererProbe.text === 'string' &&
    exit.rendererProbe.text.includes('note.md') && exit.rendererProbe.text.includes('jmd positive')),
  openDialog: !!(dispatchResult && dispatchResult.includes('"ok":true') && dispatchResult.includes('"result":true')),
  previewMarker: preview.includes(marker),
  schemeRegistered: !!(exit && exit.assets && Array.isArray(exit.assets.schemes) &&
    exit.assets.schemes.includes('jmd-file') && exit.assets.handlerExecuted === false),
  assetServed: !!(exit && exit.assets && exit.assets.served >= 1),
  imageLoaded: !!(exit && exit.rendererProbe && exit.rendererProbe.image &&
    exit.rendererProbe.image.naturalWidth > 0),
  noMainError: !(holding && holding.mainError && String(holding.mainError).length > 0),
};

const report = {
  schema: 1,
  probe: 'jmd-positive',
  status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
  compatible: false,
  revision,
  environment: {
    platform: process.platform,
    scriptNode: process.version,
    npmOnPath: (spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout || '').trim() || null,
    cli: path.relative(root, binary),
    cliSHA256: hash(binary),
    host: 'dist/emoon-host',
    hostSHA256: fs.existsSync(path.join(root, 'dist/emoon-host')) ? hash(path.join(root, 'dist/emoon-host')) : null,
    testMode: 'test-injected open dialog',
  },
  source: adaptation.source,
  build: adaptation.build || null,
  adapted: adaptation.adapted,
  document: { path: path.relative(root, documentPath), marker },
  commands: [
    'node scripts/jmd-adapt.cjs',
    `${path.relative(root, binary)} run ${path.relative(root, stage)} --window --hold --hold-seconds 15 --dispatch-main test:open-dialog`,
  ],
  checks,
  result: {
    pageTitle: exit && exit.pageTitle,
    windowTitle: exit && exit.windowTitle,
    pageURL: exit && exit.pageURL,
    preview: preview.slice(0, 500),
    dispatch: exit && exit.mainDispatch,
    assets: exit && exit.assets,
  },
  limitations: [
    'app protocol.handle is recorded, not executed',
    'the open dialog is test-injected; no human input',
    'save/edit is NOT RUN in this increment',
    'macOS is out of scope',
  ],
  originalPreload: 'NOT_EXECUTED',
  note: 'The real pinned jmd renderer boots, opens a document through the adapted dialog path, and renders the marker text. This is an adapted-profile result, not Electron compatibility.',
};
if (!checks.exitZero) report.stderr = (run.stderr || '').slice(-2048);
const screenshot = path.join(root, 'docs/images/jmd-positive-20261029.png');
if (fs.existsSync(screenshot)) {
  report.visual = {
    path: 'docs/images/jmd-positive-20261029.png',
    note: 'Manual run of the same stage: the jmd window shows note.md, the editor text and the preview marker.',
  };
}
finish(report, report.status === 'PASS' ? 0 : 1);
