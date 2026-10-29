'use strict';
// Runtime-owned custom-scheme broker. Linux only: the macOS host has no
// WKURLSchemeHandler for admitted asset schemes yet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('../scripts/source-manifest.cjs');
const { buildAdapter } = require('../scripts/adapted-adapter.cjs');

const root = path.resolve(__dirname, '..');
const hostBinary = path.join(root, 'dist/emoon-host');
const supported = process.platform === 'linux' && Boolean(process.env.DISPLAY);
const hostAvailable = fs.existsSync(hostBinary);
if (process.env.ELECTRON_MBT_REQUIRE_NATIVE_HOST === '1' && supported && !hostAvailable) {
  throw new Error(`ELECTRON_MBT_REQUIRE_NATIVE_HOST=1 but ${path.relative(root, hostBinary)} is missing`);
}

// A valid 1x1 RGBA PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGO8o6Hxn4ECwMLAwMCgfP06WZrvampCDIBxSAEwS5nIshoJjBowasDgMACeF8jNUIyUZmcAzYUMTODIg2AAAAAASUVORK5CYII=',
  'base64');

const simpleApi = {
  schema: 3,
  name: 'api',
  version: 'asset-test',
  topics: [{ topic: 'doc:open', method: 'onOpenDocument' }],
  calls: [{ name: 'noop', operation: 'app:noop', args: 'none' }],
  queue: { maxCalls: 4, maxBytes: 16384, readyTimeoutMs: 5000 },
};

let cachedBinary = null;
function buildBinary() {
  if (cachedBinary) return cachedBinary;
  const build = spawnSync('moon', ['build', '--target', 'native', 'cmd/emoon'], {
    cwd: root, encoding: 'utf8', timeout: 180000,
  });
  assert.equal(build.status, 0, `moon build failed\n${build.stdout}\n${build.stderr}`);
  const candidates = [
    path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe'),
    path.join(root, '_build/native/debug/build/cmd/emoon/emoon'),
  ];
  const binary = candidates.find(candidate => fs.existsSync(candidate));
  assert.ok(binary, 'emoon binary was not produced');
  cachedBinary = binary;
  return binary;
}

function encodePath(file) {
  return encodeURIComponent(file);
}

function assetHtml(imagePath) {
  return [
    '<!doctype html>',
    '<title></title>',
    `<img id="img" src="asset-test://local/${encodePath(imagePath)}">`,
    '<script>',
    'const img = document.getElementById("img");',
    'function report() {',
    '  if (!img.complete) return;',
    '  document.title = img.naturalWidth > 0 ? "asset-ok-" + img.naturalWidth : "asset-error";',
    '}',
    'img.addEventListener("load", report);',
    'img.addEventListener("error", report);',
    'setTimeout(function () { if (document.title === "") document.title = "asset-timeout"; }, 700);',
    '</script>',
    '',
  ].join('\n');
}

function makeApp(mainSource, imagePath, extraFiles = {}, html = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-asset-app-'));
  const adapter = buildAdapter(simpleApi).source;
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'adapted'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'renderer'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/main.js'), mainSource);
  fs.writeFileSync(path.join(dir, 'package.json'),
    '{"name":"asset-test","version":"1.0.0","main":"src/main.js"}\n');
  fs.writeFileSync(path.join(dir, 'adapted/api.json'), `${JSON.stringify(simpleApi)}\n`);
  fs.writeFileSync(path.join(dir, 'adapted/page-api.js'), adapter);
  fs.writeFileSync(path.join(dir, 'renderer/index.html'), html || assetHtml(imagePath));
  fs.writeFileSync(path.join(dir, 'nodeless-app.json'), `${JSON.stringify({
    schema: 1,
    profile: 'electron-nodeless-adapted-v1',
    adapter: 'adapted/page-api.js',
    assetSchemes: ['asset-test'],
  })}\n`);
  for (const [file, content] of Object.entries(extraFiles)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  const manifest = buildSourceManifest(dir, 'renderer/index.html', 'asset-test', [
    'package.json', 'src/main.js', 'nodeless-app.json', 'adapted/api.json',
    'adapted/page-api.js', 'renderer/index.html', ...Object.keys(extraFiles),
  ]);
  writeSourceManifest(path.join(dir, 'source-manifest.json'), manifest);
  return dir;
}

function runHold(binary, appDir, env = {}, holdMs = 1800, holdSeconds = null) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-asset-path-'));
  const fakeNode = path.join(fakeBin, 'node');
  fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 99\n');
  fs.chmodSync(fakeNode, 0o700);
  const result = spawnSync(binary, [
    'run', appDir, '--window', '--hold',
    ...(holdSeconds === null ? ['--hold-close-after-ms', String(holdMs)] : ['--hold-seconds', String(holdSeconds)]),
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      ELECTRON_MBT_TEST_MODE: '1',
      ...env,
    },
  });
  fs.rmSync(fakeBin, { recursive: true, force: true });
  const reports = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'))
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
  const holding = reports.find(report => report.status === 'HOLDING') || null;
  const exit = reports.find(report => report.status === 'HOLD_EXIT') || null;
  return { result, holding, exit, reports };
}

function makeAssetsDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-assets-'));
  const doc = path.join(dir, 'document.md');
  const image = path.join(dir, 'pixel.png');
  fs.writeFileSync(doc, '# asset test\n');
  fs.writeFileSync(image, PIXEL);
  return { dir, doc, image, name };
}

test('an admitted asset scheme serves a dialog-granted image without running the app handler', {
  skip: !supported || !hostAvailable,
}, () => {
  const binary = buildBinary();
  const assets = makeAssetsDir('positive');
  const handlerExecuted = path.join(assets.dir, 'handler-executed');
  const app = makeApp([
    "'use strict';",
    "const { app, BrowserWindow, dialog, protocol } = require('electron');",
    "protocol.registerSchemesAsPrivileged([{",
    "  scheme: 'asset-test',",
    "  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },",
    "}]);",
    "app.whenReady().then(async function () {",
    "  const selected = await dialog.showOpenDialog({ properties: ['openFile'] });",
    "  if (selected.canceled || selected.filePaths.length === 0) throw new Error('no selection');",
    "  protocol.handle('asset-test', function () {",
    "    require('node:fs').writeFileSync(" + JSON.stringify(handlerExecuted) + ", 'ran');",
    "    return null;",
    "  });",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'asset-test', show: false });",
    "  win.loadFile('renderer/index.html');",
    "});",
    '',
  ].join('\n'), assets.image);
  try {
    const { result, holding, exit } = runHold(binary, app, {
      ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT: assets.doc,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const title = (exit && exit.pageTitle) || (holding && holding.pageTitle);
    assert.equal(title, 'asset-ok-16', `image did not load: ${JSON.stringify(holding)}`);
    const assetsReport = (exit && exit.assets) || (holding && holding.assets);
    assert.ok(assetsReport, 'missing asset status');
    assert.equal(assetsReport.mode, 'asset-broker');
    assert.equal(assetsReport.handlerExecuted, false);
    assert.deepEqual(assetsReport.schemes, ['asset-test']);
    assert.ok(assetsReport.served >= 1, JSON.stringify(assetsReport));
    assert.equal(assetsReport.denied, 0, JSON.stringify(assetsReport));
    assert.equal(assetsReport.bytes, PIXEL.length, JSON.stringify(assetsReport));
    assert.equal(fs.existsSync(handlerExecuted), false,
      'the app protocol handler must not be executed');
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(assets.dir, { recursive: true, force: true });
  }
});

test('an ungranted asset path is denied and the page sees an error', {
  skip: !supported || !hostAvailable,
}, () => {
  const binary = buildBinary();
  const assets = makeAssetsDir('negative');
  const app = makeApp([
    "'use strict';",
    "const { app, BrowserWindow, protocol } = require('electron');",
    "protocol.registerSchemesAsPrivileged([{ scheme: 'asset-test', privileges: { standard: true, secure: true } }]);",
    "app.whenReady().then(function () {",
    "  protocol.handle('asset-test', function () { return null; });",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'asset-test', show: false });",
    "  win.loadFile('renderer/index.html');",
    "});",
    '',
  ].join('\n'), assets.image);
  try {
    const { result, holding, exit } = runHold(binary, app);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const title = (exit && exit.pageTitle) || (holding && holding.pageTitle);
    assert.equal(title, 'asset-error', `ungranted image unexpectedly loaded: ${JSON.stringify(holding)}`);
    const assetsReport = (exit && exit.assets) || (holding && holding.assets);
    assert.ok(assetsReport, 'missing asset status');
    assert.ok(assetsReport.denied >= 1, JSON.stringify(assetsReport));
    assert.equal(assetsReport.served, 0, JSON.stringify(assetsReport));
    assert.equal(assetsReport.lastCode, 'ELECTRON_MBT_ASSET_DENIED', JSON.stringify(assetsReport));
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(assets.dir, { recursive: true, force: true });
  }
});

test('a staged scheme that is not admitted fails before the window appears', {
  skip: !supported || !hostAvailable,
}, () => {
  const binary = buildBinary();
  const assets = makeAssetsDir('unadmitted');
  const app = makeApp([
    "'use strict';",
    "const { app, BrowserWindow, protocol } = require('electron');",
    "protocol.registerSchemesAsPrivileged([{ scheme: 'other-asset', privileges: { standard: true } }]);",
    "app.whenReady().then(function () {",
    "  new BrowserWindow({ width: 320, height: 200, title: 'asset-test', show: false });",
    "});",
    '',
  ].join('\n'), assets.image);
  try {
    const result = spawnSync(binary, ['run', app, '--window'], {
      cwd: root, encoding: 'utf8', timeout: 30000,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.notEqual(result.status, 0, output);
    assert.ok(output.includes('ELECTRON_MBT_PROTOCOL_SCHEME_NOT_ADMITTED'), output);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(assets.dir, { recursive: true, force: true });
  }
});

function dialogApp(imagePath) {
  return makeApp([
    "'use strict';",
    "const { app, BrowserWindow, dialog, protocol } = require('electron');",
    "protocol.registerSchemesAsPrivileged([{ scheme: 'asset-test', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);",
    "app.whenReady().then(async function () {",
    "  const selected = await dialog.showOpenDialog({ properties: ['openFile'] });",
    "  if (selected.canceled || selected.filePaths.length === 0) throw new Error('no selection');",
    "  protocol.handle('asset-test', function () { return null; });",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'asset-test', show: false });",
    "  win.loadFile('renderer/index.html');",
    "});",
    '',
  ].join('\n'), imagePath);
}

function runDialogNegative(binary, imagePath, expectedCode) {
  const assets = makeAssetsDir('negative');
  const app = imagePath ? dialogApp(imagePath(assets)) : null;
  try {
    const { result, holding, exit } = runHold(binary, app, {
      ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT: assets.doc,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const title = (exit && exit.pageTitle) || (holding && holding.pageTitle);
    assert.equal(title, 'asset-error', `unexpected image result: ${JSON.stringify(holding)}`);
    const assetsReport = (exit && exit.assets) || (holding && holding.assets);
    assert.ok(assetsReport, 'missing asset status');
    assert.equal(assetsReport.served, 0, JSON.stringify(assetsReport));
    assert.ok(assetsReport.denied >= 1, JSON.stringify(assetsReport));
    assert.equal(assetsReport.lastCode, expectedCode, JSON.stringify(assetsReport));
  } finally {
    if (app) fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(assets.dir, { recursive: true, force: true });
  }
}

test('asset path traversal is denied before realpath', {
  skip: !supported || !hostAvailable,
}, () => {
  runDialogNegative(buildBinary(), () => '/../etc/passwd', 'ELECTRON_MBT_ASSET_ESCAPE');
});

test('an image symlink escaping the granted directory is denied', {
  skip: !supported || !hostAvailable,
}, () => {
  runDialogNegative(buildBinary(), assets => {
    const link = path.join(assets.dir, 'link.png');
    fs.symlinkSync('/etc/hostname', link);
    return link;
  }, 'ELECTRON_MBT_ASSET_DENIED');
});

test('a non-image sibling is denied by the image allowlist', {
  skip: !supported || !hostAvailable,
}, () => {
  runDialogNegative(buildBinary(), assets => assets.doc, 'ELECTRON_MBT_ASSET_TYPE');
});

test('an image above the 4 MiB cap is denied', {
  skip: !supported || !hostAvailable,
}, () => {
  runDialogNegative(buildBinary(), assets => {
    const big = path.join(assets.dir, 'big.png');
    fs.writeFileSync(big, Buffer.alloc(4 * 1024 * 1024 + 1));
    return big;
  }, 'ELECTRON_MBT_ASSET_LIMIT');
});

function canvasHtml(imagePath) {
  return [
    '<!doctype html>',
    '<title></title>',
    `<img id="img" crossorigin="anonymous" src="asset-test://local/${encodePath(imagePath)}">`,
    '<canvas id="canvas" width="2" height="2"></canvas>',
    '<script>',
    'const img = document.getElementById("img");',
    'const canvas = document.getElementById("canvas");',
    'const context = canvas.getContext("2d");',
    'img.addEventListener("load", function () {',
    '  try {',
    '    context.drawImage(img, 0, 0);',
    '    const data = canvas.toDataURL("image/png");',
    '    document.title = "canvas-ok-" + data.length;',
    '  } catch (error) {',
    '    document.title = "canvas-tainted-" + String(error && error.name || error);',
    '  }',
    '});',
    'img.addEventListener("error", function () { document.title = "canvas-image-error"; });',
    'setTimeout(function () { if (document.title === "") document.title = "canvas-timeout"; }, 1200);',
    '</script>',
    '',
  ].join('\n');
}

test('a granted asset image can be drawn to a canvas', {
  skip: !supported || !hostAvailable,
}, () => {
  const binary = buildBinary();
  const assets = makeAssetsDir('canvas');
  const app = makeApp([
    "'use strict';",
    "const { app, BrowserWindow, dialog, protocol } = require('electron');",
    "protocol.registerSchemesAsPrivileged([{ scheme: 'asset-test', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);",
    "app.whenReady().then(async function () {",
    "  const selected = await dialog.showOpenDialog({ properties: ['openFile'] });",
    "  if (selected.canceled || selected.filePaths.length === 0) throw new Error('no selection');",
    "  protocol.handle('asset-test', function () { return null; });",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'asset-test', show: false });",
    "  win.loadFile('renderer/index.html');",
    "});",
    '',
  ].join('\n'), assets.image, {}, canvasHtml(assets.image));
  try {
    const { result, holding, exit } = runHold(binary, app, {
      ELECTRON_MBT_LINUX_DIALOG_AUTOSELECT: assets.doc,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const title = (exit && exit.pageTitle) || (holding && holding.pageTitle);
    const assetsReport = (exit && exit.assets) || (holding && holding.assets);
    assert.ok(assetsReport, 'missing asset status');
    assert.equal(assetsReport.served, 1, JSON.stringify(assetsReport));
    assert.match(String(title), /^canvas-ok-/, `canvas result: ${title}; ${JSON.stringify(assetsReport)}`);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(assets.dir, { recursive: true, force: true });
  }
});

test('loadFile query reaches the page location.search', {
  skip: !supported || !hostAvailable,
}, () => {
  const binary = buildBinary();
  const assets = makeAssetsDir('query');
  const html = [
    '<!doctype html>',
    '<title></title>',
    '<script>document.title = "query-" + location.search;</script>',
    '',
  ].join('\n');
  const app = makeApp([
    "'use strict';",
    "const { app, BrowserWindow } = require('electron');",
    "app.whenReady().then(function () {",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'query', show: false });",
    "  win.loadFile('renderer/index.html', { query: { marker: 'q1', count: 2, flag: true } });",
    "});",
    '',
  ].join('\n'), assets.image, {}, html);
  try {
    const { result, holding, exit } = runHold(binary, app);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const title = (exit && exit.pageTitle) || (holding && holding.pageTitle);
    assert.equal(title, 'query-?marker=q1&count=2&flag=true');
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(assets.dir, { recursive: true, force: true });
  }
});

test('watchFile, unwatchFile, recursive watch and close deliver bounded events', {
  skip: !supported || !hostAvailable,
}, () => {
  const binary = buildBinary();
  const assets = makeAssetsDir('watch');
  const app = makeApp([
    "'use strict';",
    "const { app, BrowserWindow } = require('electron');",
    "const fs = require('fs');",
    "const path = require('path');",
    "app.whenReady().then(function () {",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'watch', show: false });",
    "  win.loadFile('renderer/index.html');",
    "  const root = path.join(__dirname, '..', '.appData');",
    "  fs.mkdirSync(root, { recursive: true });",
    "  const file = path.join(root, 'watch.txt');",
    "  fs.writeFileSync(file, 'a');",
    "  const state = { wf: 0, size: 0, rec: 0, event: '', name: '' };",
    "  function publish() { win.setTitle('wf:' + state.wf + ':' + state.size + '|rec:' + state.rec + ':' + state.event + ':' + state.name); }",
    "  fs.watchFile(file, { interval: 250 }, function (curr, prev) {",
    "    state.wf += 1; state.size = curr.size;",
    "    if (state.wf === 1) {",
    "      fs.unwatchFile(file);",
    "      fs.writeFileSync(file, 'ccc');",
    "    }",
    "    publish();",
    "  });",
    "  fs.writeFileSync(file, 'bb');",
    "  const dir = path.join(root, 'watchdir');",
    "  fs.mkdirSync(dir, { recursive: true });",
    "  const watcher = fs.watch(dir, { recursive: true }, function (event, name) {",
    "    state.rec += 1; state.event = event; state.name = name;",
    "    if (state.rec === 1) {",
    "      watcher.close();",
    "      fs.writeFileSync(path.join(dir, 'b.txt'), 'b');",
    "    }",
    "    publish();",
    "  });",
    "  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');",
    "  win.setTitle('watch-start');",
    "  setTimeout(function () { if (state.event === '') win.setTitle('watch-timeout'); }, 3000);",
    "}).catch(function (error) {",
    "  const win = BrowserWindow.getAllWindows()[0];",
    "  if (win) win.setTitle('watch-error:' + String(error && (error.code || error.message) || error));",
    "});",
    '',
  ].join('\n'), assets.image, {}, '<!doctype html><title>watch</title>');
  try {
    const { result, holding, exit } = runHold(binary, app, {}, 5000, 10);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(exit, 'missing hold exit report');
    assert.equal(exit.reason, 'hold-seconds');
    assert.equal(exit.windowTitle, 'wf:1:2|rec:1:rename:a.txt', `watch title: ${exit.windowTitle}; holding=${JSON.stringify(holding)} exit=${JSON.stringify(exit)}`);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(assets.dir, { recursive: true, force: true });
  }
});

test('screen exposes all displays and selects by point and rectangle', {
  skip: !supported || !hostAvailable,
}, () => {
  const binary = buildBinary();
  const assets = makeAssetsDir('display');
  const app = makeApp([
    "'use strict';",
    "const { app, BrowserWindow, screen } = require('electron');",
    "app.whenReady().then(function () {",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'display', show: false });",
    "  win.loadFile('renderer/index.html');",
    "  const all = screen.getAllDisplays();",
    "  const nearest = screen.getDisplayNearestPoint({ x: 5, y: 5 });",
    "  const matching = screen.getDisplayMatching({ x: 0, y: 0, width: 10, height: 10 });",
    "  win.setTitle('display:' + all.length + ':' + nearest.bounds.width + ':' + matching.bounds.width + ':' + nearest.id + ':' + matching.id);",
    "});",
    '',
  ].join('\n'), assets.image, {}, '<!doctype html><title>display</title>');
  try {
    const { result, holding, exit } = runHold(binary, app);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const title = (exit && exit.windowTitle) || (holding && holding.windowTitle);
    assert.match(String(title), /^display:[1-9][0-9]*:[1-9][0-9]*:[1-9][0-9]*:[0-9]+:[0-9]+$/, `display title: ${title}`);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(assets.dir, { recursive: true, force: true });
  }
});

test('message box and net fail closed without the test injection', {
  skip: !supported || !hostAvailable,
}, () => {
  const binary = buildBinary();
  const assets = makeAssetsDir('negative');
  const app = makeApp([
    "'use strict';",
    "const { app, BrowserWindow, dialog, net } = require('electron');",
    "app.whenReady().then(async function () {",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'negative', show: false });",
    "  win.loadFile('renderer/index.html');",
    "  const out = [];",
    "  try { await dialog.showMessageBox({ message: 'x' }); out.push('box-resolved'); } catch (error) { out.push('box:' + error.code); }",
    "  try { dialog.showMessageBoxSync({ message: 'x' }); out.push('sync-resolved'); } catch (error) { out.push('sync:' + error.code); }",
    "  try { net.fetch('https://example.invalid'); out.push('fetch-resolved'); } catch (error) { out.push('fetch:' + error.code); }",
    "  try { net.request('https://example.invalid'); out.push('request-resolved'); } catch (error) { out.push('request:' + error.code); }",
    "  out.push('online:' + net.isOnline());",
    "  win.setTitle(out.join('|'));",
    "});",
    '',
  ].join('\n'), assets.image, {}, '<!doctype html><title>negative</title>');
  try {
    const { result, holding, exit } = runHold(binary, app, { ELECTRON_MBT_TEST_MESSAGE_BOX: '' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const title = (exit && exit.windowTitle) || (holding && holding.windowTitle);
    assert.equal(title,
      'box:ELECTRON_MBT_UNSUPPORTED_API|sync:ELECTRON_MBT_UNSUPPORTED_API|fetch:ELECTRON_MBT_UNSUPPORTED_API|request:ELECTRON_MBT_UNSUPPORTED_API|online:false',
      `negative title: ${title}`);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(assets.dir, { recursive: true, force: true });
  }
});
