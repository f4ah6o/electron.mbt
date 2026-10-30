'use strict';
// Positive jmd v0.2.3 smoke: boot the adapted stage, drive the real open
// dialog through a CLI-only main hook, edit through CodeMirror's DOM and save
// through the app's menu:save renderer action. The upstream checkout stays
// untouched.
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
const keyMarker = 'jmd-key-marker-20261029';
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

function runXdotool(args) {
  return spawnSync('xdotool', args, { encoding: 'utf8', timeout: 15000 });
}

function keyboardStep(phase, marker, events) {
  const search = runXdotool(['search', '--name', 'note.md']);
  const ids = String(search.stdout || '').split('\n').map(line => line.trim()).filter(Boolean);
  const windowId = ids.length > 0 ? ids[ids.length - 1] : '';
  const event = {
    phase,
    window: windowId,
    searchStatus: search.status,
    searchStderr: (search.stderr || '').slice(-500),
  };
  events.push(event);
  if (!windowId) return;
  const focus = runXdotool(['windowfocus', '--sync', windowId]);
  runXdotool(['sleep', '0.2']);
  const typed = runXdotool(['type', '--delay', '25', '--clearmodifiers', marker]);
  // Let the renderer commit the final key event before the save chord.
  runXdotool(['sleep', '0.5']);
  const key = runXdotool(['key', '--clearmodifiers', 'ctrl+s']);
  event.focusStatus = focus.status;
  event.typeStatus = typed.status;
  event.keyStatus = key.status;
  event.stderr = `${focus.stderr || ''}${typed.stderr || ''}${key.stderr || ''}`.slice(-500);
  if (typed.status !== 0 || key.status !== 0) {
    const typedWindow = runXdotool(['type', '--window', windowId, '--delay', '25', '--clearmodifiers', marker]);
    runXdotool(['sleep', '0.5']);
    const keyWindow = runXdotool(['key', '--window', windowId, '--clearmodifiers', 'ctrl+s']);
    event.windowTypeStatus = typedWindow.status;
    event.windowKeyStatus = keyWindow.status;
    event.windowStderr = `${typedWindow.stderr || ''}${keyWindow.stderr || ''}`.slice(-500);
  }
}

function keyboardWindowRetry(marker, events) {
  const search = runXdotool(['search', '--name', 'note.md']);
  const ids = String(search.stdout || '').split('\n').map(line => line.trim()).filter(Boolean);
  const windowId = ids.length > 0 ? ids[ids.length - 1] : '';
  const event = { phase: 'window-retry', window: windowId, searchStatus: search.status };
  events.push(event);
  if (!windowId) return;
  const typed = runXdotool(['type', '--window', windowId, '--delay', '25', '--clearmodifiers', marker]);
  runXdotool(['sleep', '0.5']);
  const key = runXdotool(['key', '--window', windowId, '--clearmodifiers', 'ctrl+s']);
  event.typeStatus = typed.status;
  event.keyStatus = key.status;
  event.stderr = `${typed.stderr || ''}${key.stderr || ''}`.slice(-500);
}

function runApp(binary, args, env) {
  return new Promise(function (resolve) {
    const child = spawn(binary, args, { cwd: root, env });
    let stdout = '';
    let stderr = '';
    const keyboard = [];
    let keyboardTimer = null;
    let retryTimer = null;
    let timeout = null;
    const clearTimers = function () {
      if (timeout !== null) { clearTimeout(timeout); timeout = null; }
      if (keyboardTimer !== null) { clearTimeout(keyboardTimer); keyboardTimer = null; }
      if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
    };
    const finish = function (code, signal, timedOut) {
      clearTimers();
      resolve({ status: code, signal, timedOut: !!timedOut, stdout, stderr, keyboard });
    };
    timeout = setTimeout(function () {
      child.kill('SIGKILL');
      finish(null, null, true);
    }, 60000);
    child.stdout.on('data', function (chunk) { stdout += chunk.toString(); });
    child.stderr.on('data', function (chunk) { stderr += chunk.toString(); });
    // Boot/open/synthetic edit/save happen in the first few seconds. The host
    // focus helper runs at ~5 s and ~8 s; type and save at 9 s. A direct
    // window-event retry runs at 12.5 s only if the file has no marker; the
    keyboardTimer = setTimeout(function () { keyboardStep('primary', keyMarker, keyboard); }, 9000);
    retryTimer = setTimeout(function () {
      let content = '';
      try { content = fs.readFileSync(documentPath, 'utf8'); } catch (_) {}
      if (!content.includes(keyMarker)) keyboardWindowRetry(keyMarker, keyboard);
    }, 12500);
    child.on('close', function (code, signal) { finish(code, signal, false); });
    child.on('error', function (error) {
      stderr += String(error);
      finish(null, null, false);
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
    // The smoke test uses ASCII only. Force GTK's simple input context so a
    // desktop IME cannot translate xdotool key events into a preedit.
    GTK_IM_MODULE: 'gtk-im-context-simple',
    XMODIFIERS: '@im=none',
  };
  const args = ['run', stage, '--window', '--hold', '--hold-seconds', '38',
    '--dispatch-main', 'test:open-dialog', '--jmd-edit-save', '--jmd-focus-editor', '--menu-activate', 'Save', '--menu-activate-role', 'Zoom In'];
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
  const displayCount = dispatch && typeof dispatch.all === 'number' ? dispatch.all : 0;
  const matching = dispatch && dispatch.matching ? dispatch.matching : null;
  const save = exit && exit.jmdSave ? exit.jmdSave : null;
  const menuActivate = exit && exit.menuActivate ? exit.menuActivate : null;
  const menuRoleActivate = exit && exit.menuRoleActivate ? exit.menuRoleActivate : null;
  const menuEvents = exit && typeof exit.menuEvents === 'number' ? exit.menuEvents : 0;
  const zoomLevel = exit && typeof exit.zoomLevel === 'number' ? exit.zoomLevel : 0;

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
    displayCount: displayCount >= 1,
    matchingBounds: !!(matching && typeof matching.width === 'number' && matching.width > 0),
    messageBox: !!(box && box.response === 2 && box.checkboxChecked === false),
    editSaved: fileContent.includes(editMarker) && preview.includes(editMarker),
    keyboardSaved: fileContent.includes(keyMarker) && preview.includes(keyMarker),
    editCleanTitle: !!(exit && typeof exit.windowTitle === 'string' && !exit.windowTitle.includes('●')),
    saveDispatched: !!(save && save.ok === true),
    nativeMenu: !!(menuActivate && menuActivate.activated === true && menuEvents >= 1),
    nativeMenuRole: !!(menuRoleActivate && menuRoleActivate.activated === true &&
      menuRoleActivate.action === 'zoomIn' && zoomLevel > 1),
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
      testMode: 'test-injected open dialog/message box; xdotool X11 ASCII with IME disabled',
    },
    source: adaptation.source,
    build: adaptation.build || null,
    adapted: adaptation.adapted,
    document: { path: path.relative(root, documentPath), marker, editMarker, keyMarker },
    commands: [
      'node scripts/jmd-adapt.cjs',
      `${path.relative(root, binary)} ${args.join(' ')}`,
    'xdotool search --name note.md; windowfocus; type; key ctrl+s',
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
      menu: { activate: menuActivate, roleActivate: menuRoleActivate, events: menuEvents, zoomLevel: zoomLevel },
      keyboard: run.keyboard,
      file: {
        bytes: Buffer.byteLength(fileContent),
        editMarker: fileContent.includes(editMarker),
        keyMarker: fileContent.includes(keyMarker),
      },
    },
    limitations: [
      'app protocol.handle is recorded, not executed',
      'the open dialog and message box are test-injected; keyboard input is xdotool X11 input, IME is NOT RUN',
      'the native menu is installed; File > Save activation dispatches jmd\'s own click handler. Role items are display-only/unsupported; Ctrl+S uses jmd\'s own shortcut',
      'fs.watch is covered by the asset fixture; this jmd smoke does not exercise an external rewrite',
      'macOS is out of scope',
    ],
    originalPreload: 'NOT_EXECUTED',
    note: 'The real pinned jmd renderer boots, opens a document, edits via a fixed host hook, types through X11/xdotool and saves via Ctrl+S, and reports GDK display geometry. The native menu is installed and its click handlers are dispatched. This is an adapted-profile result, not Electron compatibility.',
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
