'use strict';
// Separate jmd external-reload smoke. It deliberately avoids xdotool, native
// menu activation and the multi-feature jmd-positive hold: those interactions
// made the late rewrite racy at shutdown. This script boots the adapted stage,
// opens note.md through the test-injected dialog, rewrites it from another
// process, and reads the preview marker.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.resolve(process.env.JMD_SOURCE || path.join(root, '_build/jmd-positive-src'));
const stage = path.join(root, '_build/jmd-positive-stage');
const documentDir = path.join(root, '_build/jmd-positive-doc');
const documentPath = path.join(documentDir, 'note.md');
const reportPath = path.join(root, 'compatibility/reports/jmd-watch.json');
const revision = 'f875fc616feb89ea803a0fc140ec770a2ade041e';
const marker = 'jmd-watch-marker-20261029';
const required = process.env.CI === 'true' || process.env.JMD_REQUIRE_SOURCE === '1';

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function finish(report, code) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    status: report.status,
    reason: report.reason,
    watcherReloaded: report.checks && report.checks.watcherReloaded,
    preview: report.result && report.result.preview,
  }));
  process.exit(code);
}

function skip(reason) {
  const report = {
    schema: 1, probe: 'jmd-watch', status: 'NOT_RUN', reason, revision,
    compatible: false, originalPreload: 'NOT_EXECUTED',
  };
  if (required) {
    report.status = 'FAIL';
    report.reason = `${reason}; pinned source/build is required in CI`;
    finish(report, 1);
  }
  finish(report, 0);
}

function appendMarker() {
  fs.appendFileSync(documentPath, `\n\n${marker}\n`);
}

function runApp(binary) {
  return new Promise(function (resolve) {
    const args = ['run', stage, '--window', '--hold', '--hold-seconds', '20',
      '--dispatch-main', 'test:open-dialog'];
    const child = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_MBT_TEST_MODE: '1',
        ELECTRON_MBT_TEST_MESSAGE_BOX: '2',
        ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT: documentPath,
      },
    });
    let stdout = '';
    let stderr = '';
    let rewriteTimer = null;
    let timeout = null;
    const finishChild = function (status, signal, timedOut) {
      if (timeout !== null) { clearTimeout(timeout); timeout = null; }
      if (rewriteTimer !== null) { clearTimeout(rewriteTimer); rewriteTimer = null; }
      resolve({ status, signal, timedOut: !!timedOut, stdout, stderr, args });
    };
    timeout = setTimeout(function () {
      child.kill('SIGKILL');
      finishChild(null, null, true);
    }, 45000);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    // Open happens in the first couple of seconds; rewrite with plenty of time
    // left for the polling watcher and the jmd reload path.
    rewriteTimer = setTimeout(appendMarker, 6000);
    child.on('close', (code, signal) => finishChild(code, signal, false));
    child.on('error', error => {
      stderr += String(error);
      finishChild(null, null, false);
    });
  });
}

if (!fs.existsSync(path.join(source, 'electron/main.js'))) skip(`pinned source missing at ${path.relative(root, source)}`);
const head = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
if (head.status !== 0 || head.stdout.trim() !== revision) skip(`source is not pinned ${revision}`);
if (!fs.existsSync(path.join(source, 'dist/index.html'))) skip(`renderer build missing at ${path.relative(root, source)}/dist`);
const binary = [path.join(root, 'dist/emoon'), path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe')]
  .find(candidate => fs.existsSync(candidate));
if (!binary) skip('emoon binary is not built');

const adapt = spawnSync(process.execPath, ['scripts/jmd-adapt.cjs'], {
  cwd: root, encoding: 'utf8', timeout: 120000,
  env: { ...process.env, JMD_SOURCE: source, JMD_STAGE: stage, JMD_DOC_DIR: documentDir },
});
if (adapt.status !== 0) {
  finish({
    schema: 1, probe: 'jmd-watch', status: 'FAIL', reason: 'jmd adaptation failed',
    stderr: (adapt.stderr || '').slice(-2048), compatible: false,
  }, 1);
}
let adaptation = null;
try { adaptation = JSON.parse(fs.readFileSync(path.join(root, 'compatibility/reports/jmd-positive-adaptation.json'), 'utf8')); } catch (_) {}
if (!adaptation || adaptation.status !== 'PASS') {
  finish({ schema: 1, probe: 'jmd-watch', status: 'FAIL', reason: 'adaptation report missing', compatible: false }, 1);
}

runApp(binary).then(function (run) {
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  const frames = output.split('\n').map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
    .filter(Boolean);
  const holding = frames.find(frame => frame.status === 'HOLDING') || null;
  const exit = frames.find(frame => frame.status === 'HOLD_EXIT') || null;
  const probe = exit && exit.rendererProbe ? exit.rendererProbe : null;
  const preview = probe && typeof probe.preview === 'string' ? probe.preview : '';
  let fileContent = '';
  try { fileContent = fs.readFileSync(documentPath, 'utf8'); } catch (_) {}
  const checks = {
    exitZero: run.status === 0 && run.timedOut === false,
    holdExit: !!(exit && exit.status === 'HOLD_EXIT'),
    adaptedBoot: !!(holding && holding.adapted === true && holding.released === true),
    openDialog: !!(exit && typeof exit.windowTitle === 'string' && exit.windowTitle.includes('note.md')),
    watcherReloaded: fileContent.includes(marker) && preview.includes(marker),
    noMainError: !(holding && holding.mainError && String(holding.mainError).length > 0),
  };
  const report = {
    schema: 1, probe: 'jmd-watch', status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
    compatible: false, revision,
    environment: {
      platform: process.platform, cli: path.relative(root, binary), cliSHA256: hash(binary),
      hostSHA256: fs.existsSync(path.join(root, 'dist/emoon-host')) ? hash(path.join(root, 'dist/emoon-host')) : null,
      testMode: 'test-injected open dialog; no xdotool or menu activation',
    },
    source: adaptation.source, adapted: adaptation.adapted,
    document: { path: path.relative(root, documentPath), marker },
    command: `${path.relative(root, binary)} ${run.args.join(' ')}`,
    checks,
    result: { pageTitle: exit && exit.pageTitle, windowTitle: exit && exit.windowTitle, preview: preview.slice(0, 500) },
    limitations: [
      'fs.watch is a bounded polling facade; no native inotify claim',
      'test-injected open dialog; no human input',
      'app protocol.handle is recorded, not executed',
      'macOS is out of scope',
    ],
    originalPreload: 'NOT_EXECUTED',
    note: 'The pinned jmd renderer reloads an externally rewritten document through the polling fs.watch facade. This is an adapted-profile result, not Electron compatibility.',
  };
  if (run.status !== 0 || run.timedOut) {
    report.stderr = (run.stderr || '').slice(-2048);
    report.stdout = (run.stdout || '').slice(-2048);
    if (run.timedOut) report.timedOut = true;
  }
  finish(report, report.status === 'PASS' ? 0 : 1);
});
