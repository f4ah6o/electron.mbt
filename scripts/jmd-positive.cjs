'use strict';
// Positive jmd v0.2.3 smoke: boot the adapted stage, drive the real open
// dialog through a CLI-only main hook, edit through CodeMirror's DOM and save
// through the app's menu:save renderer action. A separate process rewrites the
// open document so the polling fs.watch facade and jmd's file:changed reload
// path are exercised. The upstream checkout stays untouched.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.resolve(process.env.JMD_SOURCE || path.join(root, '_build/jmd-positive-src'));
const stage = path.join(root, '_build/jmd-positive-stage');
const documentDir = path.join(root, '_build/jmd-positive-doc');
const documentPath = path.join(documentDir, 'note.md');
const reportPath = path.join(root, 'compatibility/reports/jmd-positive.json');
const adaptationPath = path.join(root, 'compatibility/reports/jmd-positive-adaptation.json');
const revision = 'f875fc616feb89ea803a0fc140ec770a2ade041e';
const marker = 'jmd-positive-marker-20261029';
const editMarker = 'jmd-edit-marker-20261029';
const watchMarker = 'jmd-watch-marker-20261029';
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
    editSaved: report.checks && report.checks.editSaved,
    watcherReloaded: report.checks && report.checks.watcherReloaded,
    pageTitle: report.result && report.result.pageTitle,
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

function appendWatchMarker() {
  fs.appendFileSync(documentPath, `\n\n${watchMarker}\n`);
}

function runApp(binary, args, env) {
  return new Promise(function (resolve) {
    const child = spawn(binary, args, { cwd: root, env });
    let stdout = '';
    let stderr = '';
    let rewriteTimer = null;
    let timeout = null;
    const stop = function (code, timedOut) {
      if (timeout !== null) { clearTimeout(timeout); timeout = null; }
      if (rewriteTimer !== null) { clearTimeout(rewriteTimer); rewriteTimer = null; }
      resolve({ status: code, signal: null, timedOut: !!timedOut, stdout, stderr });
    };
    timeout = setTimeout(function () {
      child.kill('SIGKILL');
      stop(null, true);
    }, 60000);
    child.stdout.on('data', function (chunk) { stdout += chunk.toString(); });
    // The CLI's piped stdout is block-buffered, so do not wait for HOLDING.
    // Boot/open/edit/save happen in the first few seconds; rewrite later.
    rewriteTimer = setTimeout(appendWatchMarker, 12000);
    child.stderr.on('data', function (chunk) { stderr += chunk.toString(); });
    child.on('close', function (code, signal) {
      if (resolve) {
        if (timeout !== null) { clearTimeout(timeout); timeout = null; }
        if (rewriteTimer !== null) { clearTimeout(rewriteTimer); rewriteTimer = null; }
        resolve({ status: code, signal, timedOut: false, stdout, stderr });
        resolve = null;
      } else if (timeout !== null) {
        clearTimeout(timeout);
      }
    });
    child.on('error', function (error) {
      if (resolve) {
        resolve({ status: null, signal: null, timedOut: false, stdout, stderr: stderr + String(error) });
        resolve = null;
      }
    });
  });
}

async function main() {
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
    finish({
      schema: 1, probe: 'jmd-positive', status: 'FAIL', reason: 'jmd adaptation failed',
      stderr: (adapt.stderr || '').slice(-2048), compatible: false,
    }, 1);
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
    ELECTRON_MBT_TEST_MESSAGE_BOX: '2',
    ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT: documentPath,
  };
  const args = ['run', stage, '--window', '--hold', '--hold-seconds', '30',
    '--dispatch-main', 'test:open-dialog', '--jmd-edit-save'];
  const run = await runApp(binary, args, env);
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  const frames = output.split('\n').map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
    .filter(Boolean);
  const holding = frames.find(frame => frame.status === 'HOLDING') || null;
  const exit = frames.find(frame => frame.status === 'HOLD_EXIT') || null;
  const probe = exit && exit.rendererProbe ? exit.rendererProbe : null;
  const preview = probe && typeof probe.preview === 'string' ? probe.preview : '';
  const pageText = probe && typeof probe.text === 'string' ? probe.text : '';

  let dispatch = null;
  if (exit && exit.mainDispatch && exit.mainDispatch.ok === true &&
      typeof exit.mainDispatch.result === 'string') {
    try {
      const parsed = JSON.parse(exit.mainDispatch.result);
      dispatch = parsed && parsed.ok === true ? parsed.result : null;
    } catch (_) { dispatch = null; }
  }
  const display = dispatch && dispatch.display ? dispatch.display : null;
  const bounds = display && display.bounds ? display.bounds : null;
  const workArea = display && display.workArea ? display.workArea : null;
  const box = dispatch && dispatch.box ? dispatch.box : null;
  const save = exit && exit.jmdSave ? exit.jmdSave : null;

  let fileContent = '';
  try { fileContent = fs.readFileSync(documentPath, 'utf8'); } catch (_) {}

  const checks = {
    exitZero: run.status === 0 && run.timedOut === false,
    holdExit: !!(exit && exit.status === 'HOLD_EXIT'),
    adaptedBoot: !!(holding && holding.adapted === true && holding.released === true),
    pageUrl: !!(exit && exit.pageURL === 'electron-mbt-app://app/dist/index.html'),
    windowTitle: !!(exit && typeof exit.windowTitle === 'string' && exit.windowTitle.includes('note.md')),
    initialUi: !!(probe && typeof probe.text === 'string' &&
      probe.text.includes('note.md') && probe.text.includes('jmd positive')),
    openDialog: !!(dispatch && dispatch.open === true),
    previewMarker: preview.includes(marker),
    schemeRegistered: !!(exit && exit.assets && Array.isArray(exit.assets.schemes) &&
      exit.assets.schemes.includes('jmd-file') && exit.assets.handlerExecuted === false),
    assetServed: !!(exit && exit.assets && exit.assets.served >= 1),
    imageLoaded: !!(probe && probe.image && probe.image.naturalWidth > 0),
    noMainError: !(holding && holding.mainError && String(holding.mainError).length > 0),
    displayBounds: !!(bounds && typeof bounds.x === 'number' && typeof bounds.y === 'number' &&
      typeof bounds.width === 'number' && typeof bounds.height === 'number' &&
      bounds.width > 0 && bounds.height > 0 && workArea && workArea.width > 0 && workArea.height > 0),
    messageBox: !!(box && box.response === 2 && box.checkboxChecked === false),
    editSaved: fileContent.includes(editMarker) && preview.includes(editMarker),
    editCleanTitle: !!(exit && typeof exit.windowTitle === 'string' && !exit.windowTitle.includes('●')),
    watcherReloaded: fileContent.includes(watchMarker) && preview.includes(watchMarker),
    saveDispatched: !!(save && save.ok === true),
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
      testMode: 'test-injected open dialog, message box response 2/Cancel, external rewrite',
    },
    source: adaptation.source,
    build: adaptation.build || null,
    adapted: adaptation.adapted,
    document: { path: path.relative(root, documentPath), marker, editMarker, watchMarker },
    commands: [
      'node scripts/jmd-adapt.cjs',
      `${path.relative(root, binary)} ${args.join(' ')}`,
    ],
    checks,
    result: {
      pageTitle: exit && exit.pageTitle,
      windowTitle: exit && exit.windowTitle,
      pageURL: exit && exit.pageURL,
      preview: preview.slice(0, 500),
      pageText: pageText.slice(0, 500),
      dispatch: exit && exit.mainDispatch,
      facades: dispatch,
      assets: exit && exit.assets,
      save: save,
      file: {
        bytes: Buffer.byteLength(fileContent),
        editMarker: fileContent.includes(editMarker),
        watchMarker: fileContent.includes(watchMarker),
      },
    },
    limitations: [
      'app protocol.handle is recorded, not executed',
      'the open dialog and message box are test-injected; no human input',
      'the native menu is store-only; test:menu-save delivers the same menu:save topic',
      'fs.watch is a bounded polling facade; no native inotify claim',
      'macOS is out of scope',
    ],
    originalPreload: 'NOT_EXECUTED',
    note: 'The real pinned jmd renderer boots, opens a document, edits and saves it through the app menu:save path, reloads it after an external rewrite through the polling watcher, and reports GDK display geometry. This is an adapted-profile result, not Electron compatibility.',
  };
  if (run.timedOut) report.timedOut = true;
  if (run.status !== 0) {
    report.stderr = (run.stderr || '').slice(-2048);
    report.stdout = (run.stdout || '').slice(-2048);
  }
  const screenshot = path.join(root, 'docs/images/jmd-positive-20261029.png');
  if (fs.existsSync(screenshot)) {
    report.visual = {
      path: 'docs/images/jmd-positive-20261029.png',
      note: 'Manual run of the same stage: the jmd window shows note.md, the editor text and the preview marker.',
    };
  }
  finish(report, report.status === 'PASS' ? 0 : 1);
}

main().catch(function (error) {
  finish({
    schema: 1, probe: 'jmd-positive', status: 'FAIL',
    reason: String(error && error.stack || error), compatible: false,
  }, 1);
});
