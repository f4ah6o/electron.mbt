'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('../scripts/source-manifest.cjs');
const { buildAdapter } = require('../scripts/adapted-adapter.cjs');

const root = path.resolve(__dirname, '..');
const nativeHostBinary = path.join(root, process.platform === 'linux'
  ? 'dist/electron-mbt-native-host-linux'
  : 'dist/electron-mbt-native-host');
const nativeHostAvailable = fs.existsSync(nativeHostBinary);
const nativeHostSupported = process.platform === 'darwin' || process.platform === 'linux';
if (process.env.ELECTRON_MBT_REQUIRE_NATIVE_HOST === '1' &&
    nativeHostSupported && !nativeHostAvailable) {
  throw new Error(`ELECTRON_MBT_REQUIRE_NATIVE_HOST=1 but ${path.relative(root, nativeHostBinary)} is missing`);
}
const fixture = path.join(root, 'fixtures/nodeless-app');
const binaryCandidates = [
  path.join(root, '_build/native/debug/build/native/nodeless/nodeless.exe'),
  path.join(root, '_build/native/debug/build/native/nodeless/nodeless'),
];

function buildBinary() {
  const build = spawnSync('moon', ['build', '--target', 'native', 'native/nodeless'], {
    cwd: root, encoding: 'utf8', timeout: 180000,
  });
  assert.equal(build.status, 0, `moon build failed\n${build.stdout}\n${build.stderr}`);
  const binary = binaryCandidates.find(candidate => fs.existsSync(candidate));
  assert.ok(binary, 'nodeless binary was not produced');
  return binary;
}

function run(binary, appDir, args = [], extraEnv = {}) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-path-'));
  const fakeNode = path.join(fakeBin, 'node');
  fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 99\n');
  fs.chmodSync(fakeNode, 0o700);
  const result = spawnSync(binary, ['run', appDir, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      NODELESS_FIXTURE_ENV: 'fixture-value',
      SECRET_TOKEN: 'must-not-leak',
      ...extraEnv,
    },
  });
  fs.rmSync(fakeBin, { recursive: true, force: true });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  let report = null;
  if (lines.length > 0) {
    try { report = JSON.parse(lines.at(-1)); } catch { report = null; }
  }
  return { result, report };
}

function manifestFor(appDir, entry, files) {
  const manifest = buildSourceManifest(appDir, entry, 'nodeless-test', files);
  writeSourceManifest(path.join(appDir, 'source-manifest.json'), manifest);
}

function temporaryApp(mainSource, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-app-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/main.js'), mainSource);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"nodeless-test","version":"1.0.0","main":"src/main.js"}\n');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  manifestFor(dir, 'src/main.js', ['package.json', 'src/main.js', ...Object.keys(files)]);
  return dir;
}

test('the committed adapted fixture adapter matches its manifest', () => {
  const fixtureRoot = path.join(root, 'fixtures/nodeless-adapted-app');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(fixtureRoot, 'adapted/api.json'), 'utf8'));
  const expected = buildAdapter(manifest).source;
  const committed = fs.readFileSync(path.join(fixtureRoot, 'adapted/page-api.js'), 'utf8');
  assert.equal(committed, expected);
});

test('Node-less runtime executes the fixture without Node and fails closed', () => {
  const binary = buildBinary();
  const { result, report } = run(binary, fixture);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(report, 'missing JSON report');
  assert.equal(report.schema, 1);
  assert.equal(report.probe, 'nodeless-main-runtime');
  assert.equal(report.status, 'PASS');
  assert.equal(report.engine, 'quickjs-2026-06-04');
  assert.equal(report.profile, 'electron-nodeless-adapted-v1');
  assert.equal(report.strict, 'blocked');
  assert.equal(report.compatible, false);
  assert.equal(report.app.entry, 'src/main.js');
  assert.equal(report.app.modules, 6);
  assert.equal(report.liveLeases, 0);
  assert.equal(report.nodeProcesses, 0);

  const manifestBytes = fs.readFileSync(path.join(fixture, 'source-manifest.json'));
  const manifestHash = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  assert.equal(report.app.manifestSha256, manifestHash);

  const resultOf = name => report.results[name].result;
  const main = resultOf('selftest:report');
  assert.equal(main.app, 'nodeless-fixture');
  assert.equal(main.version, '1.0.0');
  assert.equal(main.a, 'a');
  assert.equal(main.b, 'b');
  assert.equal(main.cycleA, 'b');
  assert.equal(main.cycleB, 'a');
  assert.equal(main.pkg, 'package');
  assert.equal(main.data, 'fixture');
  assert.equal(main.joined, 'src/lib/a.js');
  assert.equal(main.b64, 'aGk=');
  assert.equal(main.event, 1);
  assert.equal(main.nextTick, true);
  assert.equal(main.fixtureEnv, 'fixture-value');
  assert.equal(main.secretEnv, null);
  assert.equal(resultOf('selftest:async').value, 9);
  assert.deepEqual(resultOf('selftest:order').order, ['tick', 'promise', 'timer']);
  assert.equal(resultOf('selftest:unsupported').code, 'ELECTRON_MBT_HOST_UNAVAILABLE');
  assert.equal(resultOf('selftest:unsupported').stat, 'ELECTRON_MBT_HOST_UNAVAILABLE');
  assert.equal(resultOf('selftest:unsupported').readdir, 'ELECTRON_MBT_HOST_UNAVAILABLE');
  assert.equal(resultOf('selftest:unsupported').mkdir, 'ELECTRON_MBT_HOST_UNAVAILABLE');
});

test('the nodeless binary does not link or import Node/Node-API', () => {
  const binary = buildBinary();
  const isMac = process.platform === 'darwin';
  const linked = spawnSync(isMac ? 'otool' : 'ldd', isMac ? ['-L', binary] : [binary], {
    encoding: 'utf8',
  });
  if (linked.status === 0) {
    const text = `${linked.stdout}\n${linked.stderr}`.toLowerCase();
    assert.equal(text.includes('libnode'), false);
    assert.equal(text.includes('electron framework'), false);
  }
  const symbols = spawnSync(isMac ? 'nm' : 'nm', isMac ? ['-u', binary] : ['-D', '--undefined-only', binary], {
    encoding: 'utf8',
  });
  if (symbols.status === 0) {
    const text = `${symbols.stdout}\n${symbols.stderr}`.toLowerCase();
    assert.equal(text.includes('napi_'), false);
    assert.equal(text.includes('node::'), false);
  }
});

test('a native window loads a page and reads its title without Node', {
  skip: !nativeHostSupported || !nativeHostAvailable,
}, () => {
  const binary = buildBinary();
  const { result, report } = run(binary, path.join(root, 'fixtures/nodeless-window-app'),
    ['--window', '--entry', 'src/main.js']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(report, 'missing JSON report');
  assert.equal(report.probe, 'nodeless-window-runtime');
  assert.equal(report.status, 'PASS');
  assert.equal(report.windowLoaded, true);
  assert.equal(report.pageTitle, 'nodeless-window-ready');
  assert.match(report.pageURL, /^electron-mbt-app:\/\/app\/index\.html$/);
  assert.equal(report.hostShutdown, true);
  assert.equal(report.liveLeases, 0);
  assert.equal(report.nodeProcesses, 0);
  assert.equal(report.compatible, false);
});

test('a plain Node-less window reload advances the document generation', {
  skip: !nativeHostSupported || !nativeHostAvailable,
}, () => {
  const binary = buildBinary();
  const dir = temporaryApp([
    "'use strict';",
    "const { app, BrowserWindow } = require('electron');",
    "app.whenReady().then(function () {",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'reload', show: false });",
    "  win.loadFile('index.html');",
    "  win.loadFile('index.html');",
    "});",
    '',
  ].join('\n'), {
    'index.html': '<!doctype html><title>reload-ok</title><body>reload</body>\n',
  });
  manifestFor(dir, 'index.html', ['package.json', 'src/main.js', 'index.html']);
  try {
    const { result, report } = run(binary, dir, ['--window', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.pageTitle, 'reload-ok');
    assert.equal(report.documentGeneration, 2,
      'the second load must advance the native document generation');
    assert.equal(report.windowLoaded, true);
    assert.equal(report.compatible, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the Node-less ingress rejects a stale generation before Main dispatch', {
  skip: !nativeHostSupported || !nativeHostAvailable,
}, () => {
  const binary = buildBinary();
  const dir = temporaryApp([
    "'use strict';",
    "const { app, BrowserWindow } = require('electron');",
    "app.whenReady().then(function () {",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'ingress', show: false });",
    "  win.loadFile('index.html');",
    "});",
    '',
  ].join('\n'), {
    'index.html': '<!doctype html><title>ingress-ok</title><body>ingress</body>\n',
  });
  manifestFor(dir, 'index.html', ['package.json', 'src/main.js', 'index.html']);
  try {
    const { result, report } = run(binary, dir,
      ['--window', '--entry', 'src/main.js', '--ingress-selftest'],
      { ELECTRON_MBT_TEST_MODE: '1' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.ok(report.ingressSelftest, 'missing ingress selftest payload');
    assert.equal(report.ingressSelftest.ok, true);
    assert.equal(report.ingressSelftest.staleInjected, true);
    assert.equal(report.ingressSelftest.liveInjected, true);
    assert.equal(report.ingressSelftest.rejected, 1,
      'the stale generation event must be rejected');
    assert.equal(report.ingressSelftest.handled, 1,
      'the current generation event must reach Main');
    assert.equal(report.ingressSelftest.errors, 0);
    assert.equal(report.ingressSelftest.window, 1);
    assert.equal(report.ingressSelftest.generation, 1);
    assert.equal(report.ingressSelftest.staleGeneration, 0);
    assert.equal(report.ingressSelftest.forgedClaimsIgnored, true,
      'page-supplied window/generation/sender claims must not become authority');
    assert.equal(report.compatible, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed or frame-originated page message never reaches Node-less Main', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const api = {
    schema: 3,
    name: 'api',
    version: 'ingress-forged',
    topics: [{ topic: 'doc:open', method: 'onOpenDocument' }],
    calls: [
      { name: 'getSettings', operation: 'app:getSettings', args: 'none' },
      { name: 'getForged', operation: 'app:getForged', args: 'none' },
    ],
    queue: { maxCalls: 4, maxBytes: 16384, readyTimeoutMs: 5000 },
  };
  const adapter = buildAdapter(api).source;
  const dir = temporaryApp([
    "'use strict';",
    "const { app, BrowserWindow, ipcMain } = require('electron');",
    "let forged = 0;",
    "app.whenReady().then(function () {",
    "  ipcMain.handle('app:forged', function () { forged += 1; return { forged: forged }; });",
    "  ipcMain.handle('app:getForged', function () { return { forged: forged }; });",
    "  ipcMain.handle('app:getSettings', function () { return { theme: 'dark' }; });",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'ingress-forged', show: false });",
    "  win.loadFile('renderer/index.html');",
    "});",
    '',
  ].join('\n'), {
    'nodeless-app.json': `${JSON.stringify({
      schema: 1, profile: 'electron-nodeless-adapted-v1', adapter: 'adapted/page-api.js',
    })}\n`,
    'adapted/api.json': `${JSON.stringify(api)}\n`,
    'adapted/page-api.js': adapter,
    'renderer/index.html': '<!doctype html><title>ingress-forged-wait</title><body><div id="root"></div><script type="module" src="./app.js"></script></body>\n',
    'renderer/app.js': [
      "'use strict';",
      "try {",
      "  const handler = window.webkit && window.webkit.messageHandlers &&",
      "    window.webkit.messageHandlers.electronMbtApp;",
      "  if (handler) {",
      "    const reply = handler.postMessage({ operation: 'app:forged', payload: 'not-an-object' });",
      "    if (reply && reply.catch) reply.catch(function () {});",
      "  }",
      "} catch (_) {}",
      "try {",
      "  const frame = document.createElement('iframe');",
      "  frame.setAttribute('sandbox', 'allow-scripts');",
      "  frame.srcdoc = '<script>try{const h=window.webkit.messageHandlers.electronMbtApp;" +
        "const p=h.postMessage({operation:\"app:forged\",payload:{}});" +
        "if(p&&p.catch)p.catch(function(){});}catch(e){}</script>';",
      "  document.body.appendChild(frame);",
      "} catch (_) {}",
      "window.api.getForged().then(function (result) {",
      "  document.title = 'forged-' + result.forged;",
      "  document.getElementById('root').textContent = 'forged';",
      "}).catch(function (error) {",
      "  document.title = 'forged-error-' + String(error && (error.code || error.message) || error);",
      "});",
      '',
    ].join('\n'),
  });
  manifestFor(dir, 'renderer/index.html', [
    'package.json', 'src/main.js', 'nodeless-app.json', 'adapted/api.json',
    'adapted/page-api.js', 'renderer/index.html', 'renderer/app.js',
  ]);
  try {
    const { result, report } = run(binary, dir, ['--window', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.pageTitle, 'forged-0',
      'neither the malformed main-frame message nor a frame message may reach Main');
    assert.equal(report.adapted.replyErrors, 0);
    assert.equal(report.adapted.rejected, 0);
    assert.ok(report.adapted.ingress.admitted >= 1);
    assert.ok(report.adapted.ingress.denied >= 1,
      'the malformed page message must be denied at the native ingress');
    assert.equal(report.compatible, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an adapted Node-less window reloads with a new generation and a fresh ingress', {
  skip: !nativeHostSupported || !nativeHostAvailable,
}, () => {
  const binary = buildBinary();
  const api = {
    schema: 3,
    name: 'api',
    version: 'reload-adapted',
    topics: [{ topic: 'doc:open', method: 'onOpenDocument' }],
    calls: [{ name: 'getSettings', operation: 'app:hello', args: 'none' }],
    queue: { maxCalls: 4, maxBytes: 16384, readyTimeoutMs: 5000 },
  };
  const adapter = buildAdapter(api).source;
  const dir = temporaryApp([
    "'use strict';",
    "const { app, BrowserWindow, ipcMain } = require('electron');",
    "let loads = 0;",
    "app.whenReady().then(function () {",
    "  ipcMain.handle('app:hello', function () { loads += 1; return { loads: loads }; });",
    "  const win = new BrowserWindow({ width: 320, height: 200, title: 'reload-adapted', show: false });",
    "  win.loadFile('renderer/index.html');",
    "  win.loadFile('renderer/index.html');",
    "});",
    '',
  ].join('\n'), {
    'nodeless-app.json': `${JSON.stringify({
      schema: 1, profile: 'electron-nodeless-adapted-v1', adapter: 'adapted/page-api.js',
    })}\n`,
    'adapted/api.json': `${JSON.stringify(api)}\n`,
    'adapted/page-api.js': adapter,
    'renderer/index.html': '<!doctype html><title>reload-adapted-wait</title><body><div id="root"></div><script type="module" src="./app.js"></script></body>\n',
    'renderer/app.js': [
      "'use strict';",
      "window.api.getSettings().then(function (result) {",
      "  document.title = 'reload-adapted-' + result.loads;",
      "  document.getElementById('root').textContent = 'reload-adapted';",
      "}).catch(function (error) {",
      "  document.title = 'reload-adapted-error-' + String(error && (error.code || error.message) || error);",
      "});",
      '',
    ].join('\n'),
  });
  manifestFor(dir, 'renderer/index.html', [
    'package.json', 'src/main.js', 'nodeless-app.json', 'adapted/api.json',
    'adapted/page-api.js', 'renderer/index.html', 'renderer/app.js',
  ]);
  try {
    const { result, report } = run(binary, dir, ['--window', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.documentGeneration, 2,
      'the adapted reload must advance the native document generation');
    assert.equal(report.pageTitle, 'reload-adapted-1');
    assert.equal(report.adapted.observed, true);
    assert.equal(report.adapted.released, true);
    assert.ok(report.adapted.requests >= 1);
    assert.equal(report.adapted.replyErrors, 0);
    assert.ok(report.adapted.rejected >= 1,
      'the previous document request becomes stale at reload and must be rejected');
    assert.equal(report.adapted.ingress.admitted >= 1, true);
    assert.equal(report.adapted.ingress.denied, 0);
    assert.equal(report.compatible, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main fs reads app files and atomically writes appData without Node', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-fs-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-fs-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
    fs.mkdirSync(path.join(dir, '.appData'), { recursive: true });
    fs.symlinkSync('../sample.txt', path.join(dir, '.appData', 'sample-link'));
    const { result, report } = run(binary, dir,
      ['--window', '--fs-selftest', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.fsSelftestOk, true);
    const fsReport = report.fsSelftest;
    assert.ok(fsReport, 'missing fs selftest payload');
    assert.equal(fsReport.ok, true);
    assert.equal(fsReport.syncText, 'sample\n');
    assert.equal(fsReport.asyncText, 'sample\n');
    assert.equal(fsReport.syncBuffer, true);
    assert.equal(fsReport.exists, true);
    assert.equal(fsReport.existsMissing, false);
    assert.equal(fsReport.existsOutside, false);
    assert.equal(fsReport.largeRead, true);
    assert.equal(fsReport.largeAsync, true);
    assert.equal(fsReport.asyncWrite, true);
    assert.equal(fsReport.nestedWrite, true);
    assert.equal(fsReport.atomicRead, true);
    assert.equal(fsReport.empty, true);
    assert.equal(fsReport.base64RoundTrip, true);
    assert.equal(fsReport.writeDenied, 'EACCES');
    assert.equal(fsReport.traversalDenied, 'EACCES');
    assert.equal(fsReport.readDenied, 'EACCES');
    assert.equal(fsReport.missing, 'ENOENT');
    assert.equal(fsReport.oversize, 'EFBIG');
    assert.equal(fsReport.unknownFlag, 'ELECTRON_MBT_UNSUPPORTED_API');
    assert.equal(fsReport.escapeCode, 'ENOENT');
    assert.equal(fsReport.mkdirRecursive, true);
    assert.equal(fsReport.mkdirExistingRecursive, true);
    assert.equal(fsReport.dirListNested, true);
    assert.equal(fsReport.dirListSrc, true);
    assert.equal(fsReport.dirListUtf8, true);
    assert.equal(fsReport.direntFile, true);
    assert.equal(fsReport.direntLink, true);
    assert.equal(fsReport.statFile, true);
    assert.equal(fsReport.statDirectory, true);
    assert.equal(fsReport.statMissing, 'ENOENT');
    assert.equal(fsReport.statOutside, 'EACCES');
    assert.equal(fsReport.statNoThrow, true);
    assert.equal(fsReport.statBigint, 'ELECTRON_MBT_UNSUPPORTED_API');
    assert.equal(fsReport.listMissing, 'ENOENT');
    assert.equal(fsReport.listFile, 'ENOTDIR');
    assert.equal(fsReport.listOutside, 'EACCES');
    assert.equal(fsReport.listBadEncoding, 'ELECTRON_MBT_UNSUPPORTED_API');
    assert.equal(fsReport.listRecursive, 'ELECTRON_MBT_UNSUPPORTED_API');
    assert.equal(fsReport.mkdirExists, 'EEXIST');
    assert.equal(fsReport.mkdirFile, 'EEXIST');
    assert.equal(fsReport.mkdirMissingParent, 'ENOENT');
    assert.equal(fsReport.mkdirDenied, 'EACCES');
    assert.equal(fsReport.mkdirTraversal, 'EACCES');
    assert.equal(fsReport.mkdirMode, 'ELECTRON_MBT_UNSUPPORTED_API');
    assert.equal(fsReport.asyncStat, true);
    assert.equal(fsReport.asyncReaddir, true);
    assert.equal(fsReport.asyncMkdir, true);
    assert.equal(fsReport.mkdirDataRoot, true);
    assert.equal(fsReport.escapeListCode, 'ENOENT');
    assert.equal(fsReport.escapeStatCode, 'ENOENT');
    assert.equal(report.pageTitle, 'nodeless-fs-ready');
    assert.equal(report.hostShutdown, true);
    assert.equal(report.liveLeases, 0);
    assert.equal(report.nodeProcesses, 0);
    assert.equal(report.compatible, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main fs denies a symlink that escapes the app root', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-fs-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-fs-symlink-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-fs-outside-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n');
    fs.mkdirSync(path.join(dir, '.appData'), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, '.appData', 'escape'));
    const { result, report } = run(binary, dir,
      ['--window', '--fs-selftest', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.fsSelftestOk, true);
    assert.equal(report.fsSelftest.escapeCode, 'EACCES');
    assert.equal(report.fsSelftest.escapeListCode, 'EACCES');
    assert.equal(report.fsSelftest.escapeStatCode, 'EACCES');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('main fs denies directory escape and enforces directory bounds', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const mainSource = `'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
function codeOf(callback) {
  try { callback(); return 'no-error'; } catch (error) { return error && error.code ? error.code : 'no-code'; }
}
app.whenReady().then(function () {
  ipcMain.handle('fs:selftest', function () {
    const result = { ok: true };
    result.mkdirEscape = codeOf(function () {
      fs.mkdirSync('.appData/escape/newdir', { recursive: true });
    });
    result.listEscape = codeOf(function () { fs.readdirSync('.appData/escape'); });
    result.statEscape = codeOf(function () { fs.statSync('.appData/escape/secret.txt'); });
    result.many = codeOf(function () { fs.readdirSync('.appData/many'); });
    let deep = '.appData';
    for (let i = 0; i < 66; i++) deep += '/d';
    deep += '/leaf';
    result.deep = codeOf(function () { fs.mkdirSync(deep, { recursive: true }); });
    if (result.mkdirEscape !== 'EACCES' || result.listEscape !== 'EACCES' ||
        result.statEscape !== 'EACCES' || result.many !== 'EFBIG' ||
        result.deep !== 'EFBIG') {
      result.ok = false;
    }
    return result;
  });
  const window = new BrowserWindow({ width: 480, height: 320, title: 'dir-negative', show: false });
  window.loadFile('index.html');
});
`;
  const dir = temporaryApp(mainSource, {
    'index.html': '<!doctype html>\n<html><head><meta charset="utf-8">' +
      '<title>nodeless-dir-negative</title></head><body><div id="root">dir</div></body></html>\n',
  });
  writeSourceManifest(path.join(dir, 'source-manifest.json'),
    buildSourceManifest(dir, 'index.html', 'nodeless-test',
      ['index.html', 'package.json', 'src/main.js']));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-dir-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n');
    fs.mkdirSync(path.join(dir, '.appData'), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, '.appData', 'escape'));
    fs.mkdirSync(path.join(dir, '.appData', 'many'), { recursive: true });
    for (let i = 0; i < 4097; i++) {
      fs.writeFileSync(path.join(dir, '.appData', 'many', `f${i}`), '');
    }
    const { result, report } = run(binary, dir,
      ['--window', '--fs-selftest', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.fsSelftestOk, true);
    const fsReport = report.fsSelftest;
    assert.equal(fsReport.ok, true);
    assert.equal(fsReport.mkdirEscape, 'EACCES');
    assert.equal(fsReport.listEscape, 'EACCES');
    assert.equal(fsReport.statEscape, 'EACCES');
    assert.equal(fsReport.many, 'EFBIG');
    assert.equal(fsReport.deep, 'EFBIG');
    assert.equal(fs.existsSync(path.join(outside, 'newdir')), false);
    assert.equal(report.hostShutdown, true);
    assert.equal(report.liveLeases, 0);
    assert.equal(report.nodeProcesses, 0);
    assert.equal(report.compatible, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('main fs reads and writes user files granted by the test scenario', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-user-file-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-user-file-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-user-outside-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
    const readPath = path.join(outside, 'read.md');
    const writePath = path.join(outside, 'write.md');
    const deniedPath = path.join(outside, 'denied.md');
    const deniedWritePath = path.join(outside, 'denied-write.md');
    fs.writeFileSync(readPath, '# user read\n');
    fs.writeFileSync(deniedPath, 'denied\n');
    fs.writeFileSync(path.join(dir, 'nodeless-user-file.json'), `${JSON.stringify({
      schema: 1,
      readPath,
      writePath,
      deniedPath,
      deniedWritePath,
    })}\n`);
    const files = [
      'index.html',
      'package.json',
      'src/main.js',
      'nodeless-user-file.json',
    ];
    writeSourceManifest(path.join(dir, 'source-manifest.json'),
      buildSourceManifest(dir, 'index.html', 'nodeless-user-file', files));
    const { result, report } = run(binary, dir,
      ['--window', '--user-file-selftest', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.userFileSelftestOk, true);
    assert.equal(report.userFileSelftest.ok, true);
    assert.equal(report.userFileSelftest.readText, '# user read\n');
    assert.equal(report.userFileSelftest.readAsync, '# user read\n');
    assert.equal(report.userFileSelftest.existsRead, true);
    assert.equal(report.userFileSelftest.statRead, true);
    assert.equal(report.userFileSelftest.listGrantedFile, 'ENOTDIR');
    assert.equal(report.userFileSelftest.listDeniedParent, 'EACCES');
    assert.equal(report.userFileSelftest.writeReadBack, true);
    assert.equal(report.userFileSelftest.writeAsync, true);
    assert.equal(report.userFileSelftest.existsWrite, true);
    assert.equal(report.userFileSelftest.deniedRead, 'EACCES');
    assert.equal(report.userFileSelftest.deniedExists, false);
    assert.equal(report.userFileSelftest.deniedWrite, 'EACCES');
    assert.equal(report.userFileSelftest.statDenied, 'EACCES');
    assert.equal(report.userFileSelftest.mkdirDeniedNearGrant, 'EACCES');
    assert.equal(report.userFileSelftest.selfGrantBlocked, true);
    assert.equal(report.userFileSelftest.controlGrantBlocked, true);
    assert.equal(fs.readFileSync(writePath, 'utf8'), 'user-write');
    assert.equal(report.pageTitle, 'nodeless-user-file-ready');
    assert.equal(report.hostShutdown, true);
    assert.equal(report.liveLeases, 0);
    assert.equal(report.nodeProcesses, 0);
    assert.equal(report.compatible, false);
    assert.ok(report.notVerified.includes('grant-persistence'));
    assert.ok(report.notVerified.includes('human-dialog-ui'));
    assert.ok(!report.notVerified.includes('main-fs-user-grants'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('grant persistence loads across runs and revocation denies access', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-user-file-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-grant-store-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-grant-outside-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
    const readPath = path.join(outside, 'read.md');
    const writePath = path.join(outside, 'write.md');
    const deniedPath = path.join(outside, 'denied.md');
    const deniedWritePath = path.join(outside, 'denied-write.md');
    fs.writeFileSync(readPath, '# user read\n');
    fs.writeFileSync(deniedPath, 'denied\n');
    fs.writeFileSync(path.join(dir, 'nodeless-user-file.json'), `${JSON.stringify({
      schema: 1,
      readPath,
      writePath,
      deniedPath,
      deniedWritePath,
    })}\n`);
    const files = ['index.html', 'package.json', 'src/main.js', 'nodeless-user-file.json'];
    writeSourceManifest(path.join(dir, 'source-manifest.json'),
      buildSourceManifest(dir, 'index.html', 'nodeless-user-file', files));

    const first = run(binary, dir, ['--window', '--user-file-selftest', '--entry', 'src/main.js']);
    assert.equal(first.result.status, 0, `${first.result.stdout}\n${first.result.stderr}`);
    assert.equal(first.report.status, 'PASS');
    assert.equal(first.report.grantStore.persisted, true);
    assert.equal(first.report.grantStore.files.length, 2);
    const storePath = path.join(dir, '.userData', 'electron-mbt', 'grants-v1.json');
    assert.equal(fs.existsSync(storePath), true);
    assert.equal(fs.statSync(storePath).mode & 0o777, 0o600);

    const second = run(binary, dir, ['--window', '--grant-persist-selftest', '--entry', 'src/main.js']);
    assert.equal(second.result.status, 0, `${second.result.stdout}\n${second.result.stderr}`);
    assert.equal(second.report.status, 'PASS');
    assert.equal(second.report.grantPersistSelftest.ok, true);
    assert.equal(second.report.grantPersistSelftest.readGranted, true);
    assert.equal(second.report.grantPersistSelftest.writeGranted, true);
    assert.equal(second.report.grantStore.loaded, true);
    assert.equal(second.report.grantStore.persisted, true);
    assert.equal(second.report.userFileSelftestOk, true);
    assert.equal(second.report.notVerified.includes('grant-persistence'), false);

    const third = run(binary, dir, ['--window', '--grant-revoke-selftest', '--entry', 'src/main.js']);
    assert.equal(third.result.status, 0, `${third.result.stdout}\n${third.result.stderr}`);
    assert.equal(third.report.status, 'PASS');
    assert.equal(third.report.grantRevokeSelftest.ok, true);
    assert.equal(third.report.grantRevokeSelftest.revokedRead, true);
    assert.equal(third.report.grantRevokeSelftest.revokedWrite, true);
    assert.equal(third.report.grantRevokeSelftest.storeEmpty, true);
    assert.equal(third.report.grantRevokeSelftest.readDenied, true);
    assert.equal(third.report.grantRevokeSelftest.writeDenied, true);
    assert.equal(third.report.grantStore.files.length, 0);
    assert.equal(fs.existsSync(storePath), true);

    const fourth = run(binary, dir, ['--window', '--grant-persist-selftest', '--entry', 'src/main.js']);
    assert.notEqual(fourth.result.status, 0);
    assert.equal(fourth.report.status, 'FAIL');
    assert.equal(fourth.report.grantPersistSelftest.ok, false);
    assert.equal(fourth.report.userFileSelftestOk, false);
    assert.equal(fourth.report.compatible, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a persisted readwrite grant reopens and saves the same file after restart', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-user-file-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-normal-save-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-normal-save-out-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
    const documentPath = path.join(outside, 'document.md');
    fs.writeFileSync(documentPath, '# user read\n');
    fs.writeFileSync(path.join(dir, 'nodeless-user-file.json'), `${JSON.stringify({
      schema: 1,
      readPath: documentPath,
      writePath: documentPath,
      deniedPath: path.join(outside, 'denied.md'),
      deniedWritePath: path.join(outside, 'denied-write.md'),
    })}\n`);
    const files = ['index.html', 'package.json', 'src/main.js', 'nodeless-user-file.json'];
    writeSourceManifest(path.join(dir, 'source-manifest.json'),
      buildSourceManifest(dir, 'index.html', 'nodeless-user-file', files));

    const first = run(binary, dir, ['--window', '--user-file-selftest', '--entry', 'src/main.js']);
    assert.equal(first.result.status, 0, `${first.result.stdout}\n${first.result.stderr}`);
    assert.equal(first.report.status, 'PASS');
    assert.equal(first.report.grantStore.files.length, 1);
    assert.equal(first.report.grantStore.files[0].mode, 'readwrite');
    assert.equal(fs.readFileSync(documentPath, 'utf8'), 'user-write');

    // Simulate a restart with the same on-disk document; the new process must
    // load the persisted readwrite grant and save the same path without a dialog.
    fs.writeFileSync(documentPath, '# user read\n');
    const second = run(binary, dir, ['--window', '--grant-persist-selftest', '--entry', 'src/main.js']);
    assert.equal(second.result.status, 0, `${second.result.stdout}\n${second.result.stderr}`);
    assert.equal(second.report.status, 'PASS');
    assert.equal(second.report.grantPersistSelftest.ok, true);
    assert.equal(second.report.grantPersistSelftest.readGranted, true);
    assert.equal(second.report.grantPersistSelftest.writeGranted, true);
    assert.equal(second.report.userFileSelftestOk, true);
    assert.equal(second.report.grantStore.files.length, 1);
    assert.equal(second.report.grantStore.files[0].mode, 'readwrite');
    assert.equal(fs.readFileSync(documentPath, 'utf8'), 'user-write',
      'the persisted readwrite grant must allow an in-place normal save');
    assert.equal(second.report.compatible, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('a corrupt or non-canonical grant store fails closed', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-user-file-app');
  for (const kind of ['invalid-json', 'non-canonical-symlink']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `electron-mbt-grant-store-${kind}-`));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), `electron-mbt-grant-store-${kind}-out-`));
    try {
      fs.cpSync(source, dir, { recursive: true });
      const readPath = path.join(outside, 'read.md');
      const writePath = path.join(outside, 'write.md');
      fs.writeFileSync(readPath, '# user read\n');
      fs.writeFileSync(path.join(dir, 'nodeless-user-file.json'), `${JSON.stringify({
        schema: 1,
        readPath,
        writePath,
        deniedPath: path.join(outside, 'denied.md'),
        deniedWritePath: path.join(outside, 'denied-write.md'),
      })}\n`);
      const files = ['index.html', 'package.json', 'src/main.js', 'nodeless-user-file.json'];
      writeSourceManifest(path.join(dir, 'source-manifest.json'),
        buildSourceManifest(dir, 'index.html', 'nodeless-user-file', files));
      const first = run(binary, dir, ['--window', '--user-file-selftest', '--entry', 'src/main.js']);
      assert.equal(first.result.status, 0, `${kind}: ${first.result.stdout}\n${first.result.stderr}`);
      const storePath = path.join(dir, '.userData', 'electron-mbt', 'grants-v1.json');
      assert.equal(fs.existsSync(storePath), true);
      if (kind === 'invalid-json') {
        fs.writeFileSync(storePath, '{"schema":1,"files":[');
      } else {
        const link = path.join(outside, 'read-link.md');
        fs.symlinkSync(readPath, link);
        fs.writeFileSync(storePath, `${JSON.stringify({
          schema: 1,
          files: [{ path: link, mode: 'read' }],
          directories: [],
        })}\n`);
      }
      const second = run(binary, dir, ['--window', '--grant-persist-selftest', '--entry', 'src/main.js']);
      assert.notEqual(second.result.status, 0, kind);
      assert.equal(second.report.status, 'FAIL', kind);
      assert.equal(second.report.grantStore.error, 'ELECTRON_MBT_GRANT_STORE_INVALID', kind);
      assert.equal(second.report.grantPersistSelftest.ok, false, kind);
      assert.equal(second.report.userFileSelftestOk, false, kind);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }
});

test('invalid user-file scenarios fail closed', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-user-file-app');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-user-invalid-'));
  const readPath = path.join(outside, 'read.md');
  fs.writeFileSync(readPath, '# user read\n');
  const cases = [
    ['missing scenario', null],
    ['relative read path', { schema: 1, readPath: 'read.md', writePath: path.join(outside, 'write.md') }],
    ['missing write parent', {
      schema: 1,
      readPath,
      writePath: path.join(outside, 'missing', 'write.md'),
    }],
  ];
  try {
    for (const [label, scenario] of cases) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-user-file-case-'));
      try {
        fs.cpSync(source, dir, { recursive: true });
        const files = ['index.html', 'package.json', 'src/main.js'];
        if (scenario !== null) {
          fs.writeFileSync(path.join(dir, 'nodeless-user-file.json'),
            `${JSON.stringify(scenario)}\n`);
          files.push('nodeless-user-file.json');
        }
        writeSourceManifest(path.join(dir, 'source-manifest.json'),
          buildSourceManifest(dir, 'index.html', 'nodeless-user-file', files));
        const { result, report } = run(binary, dir,
          ['--window', '--user-file-selftest', '--entry', 'src/main.js']);
        assert.notEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
        assert.ok(report, `${label}: missing JSON report`);
        assert.equal(report.status, 'FAIL', label);
        assert.equal(report.code, 'ELECTRON_MBT_NODELESS_USER_FILE', label);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('main fs reads and writes inside session directory grants', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-directory-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-directory-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-directory-outside-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
    const readDir = path.join(outside, 'read');
    const writeDir = path.join(outside, 'write');
    const writeOnlyDir = path.join(outside, 'write-only');
    const deniedDir = `${writeDir}-evil`;
    const deniedFile = path.join(deniedDir, 'secret.txt');
    const escapeTarget = path.join(outside, 'escape-target');
    fs.mkdirSync(readDir, { recursive: true });
    fs.mkdirSync(writeDir, { recursive: true });
    fs.mkdirSync(writeOnlyDir, { recursive: true });
    fs.mkdirSync(deniedDir, { recursive: true });
    fs.mkdirSync(escapeTarget, { recursive: true });
    fs.writeFileSync(path.join(readDir, 'read.txt'), 'directory-read\n');
    fs.writeFileSync(path.join(readDir, 'oversize.txt'), 'x'.repeat(262145));
    fs.mkdirSync(path.join(readDir, 'many'), { recursive: true });
    for (let i = 0; i < 4097; i++) {
      fs.writeFileSync(path.join(readDir, 'many', `f${i}`), '');
    }
    fs.writeFileSync(path.join(deniedDir, 'secret.txt'), 'denied\n');
    fs.writeFileSync(path.join(escapeTarget, 'secret.txt'), 'outside\n');
    fs.symlinkSync(escapeTarget, path.join(readDir, 'escape'));
    fs.symlinkSync(escapeTarget, path.join(writeDir, 'escape'));

    const scenario = {
      schema: 1,
      grants: [
        { path: readDir, mode: 'read' },
        { path: writeDir, mode: 'read' },
        { path: writeDir, mode: 'readwrite' },
        { path: writeOnlyDir, mode: 'write' },
      ],
      deniedDir,
      deniedFile,
    };
    fs.writeFileSync(path.join(dir, 'nodeless-directory.json'),
      `${JSON.stringify(scenario, null, 2)}\n`);
    const files = ['index.html', 'package.json', 'src/main.js', 'nodeless-directory.json'];
    writeSourceManifest(path.join(dir, 'source-manifest.json'),
      buildSourceManifest(dir, 'index.html', 'nodeless-directory', files));

    const { result, report } = run(binary, dir,
      ['--window', '--directory-selftest', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.directorySelftestOk, true);
    const directory = report.directorySelftest;
    assert.ok(directory, 'missing directory selftest payload');
    assert.equal(directory.ok, true);
    assert.equal(directory.grantCount, 4);
    assert.equal(directory.readGrant, readDir);
    assert.equal(directory.writeGrant, writeDir);
    assert.equal(directory.writeOnlyGrant, writeOnlyDir);
    assert.equal(directory.readList, true);
    assert.equal(directory.readStatDir, true);
    assert.equal(directory.readStatFile, true);
    assert.equal(directory.readText, 'directory-read\n');
    assert.equal(directory.readExists, true);
    assert.equal(directory.readAsync, true);
    assert.equal(directory.readDirent, true);
    assert.equal(directory.readSymlinkList, 'EACCES');
    assert.equal(directory.readSymlinkStat, 'EACCES');
    assert.equal(directory.readSymlinkRead, 'EACCES');
    assert.equal(directory.readWriteDenied, 'EACCES');
    assert.equal(directory.readMkdirDenied, 'EACCES');
    assert.equal(directory.readTraversal, 'EACCES');
    assert.equal(directory.writeList, true);
    assert.equal(directory.writeMkdirFirstCreated, true);
    assert.equal(directory.writeReadBack, true);
    assert.equal(directory.writeStatDir, true);
    assert.equal(directory.writeAsync, true);
    assert.equal(directory.writeAsyncMkdir, true);
    assert.equal(directory.writeEscapeWrite, 'EACCES');
    assert.equal(directory.writeEscapeMkdir, 'EACCES');
    assert.equal(directory.writeSymlinkList, 'EACCES');
    assert.equal(directory.writeMissingParent, 'EIO');
    assert.equal(directory.writeOnlyList, 'EACCES');
    assert.equal(directory.writeOnlyStat, 'EACCES');
    assert.equal(directory.writeOnlyRead, 'EACCES');
    assert.equal(directory.writeOnlyWrite, 'no-error');
    assert.equal(directory.writeOnlyReadBack, 'EACCES');
    assert.equal(directory.writeOnlyMkdir, true);
    assert.equal(directory.deniedList, 'EACCES');
    assert.equal(directory.deniedStat, 'EACCES');
    assert.equal(directory.deniedRead, 'EACCES');
    assert.equal(directory.deniedWrite, 'EACCES');
    assert.equal(directory.deniedMkdir, 'EACCES');
    assert.equal(directory.prefixList, 'EACCES');
    assert.equal(directory.prefixWrite, 'EACCES');
    assert.equal(directory.oversizeRead, 'EFBIG');
    assert.equal(directory.oversizeWrite, 'EFBIG');
    assert.equal(directory.listLimit, 'EFBIG');
    assert.equal(directory.selfGrantBlocked, true);
    assert.equal(directory.fileGrantBlocked, true);
    assert.equal(fs.readFileSync(path.join(writeDir, 'created', 'write.txt'), 'utf8'),
      'directory-write');
    assert.equal(fs.readFileSync(path.join(writeOnlyDir, 'write-only.txt'), 'utf8'),
      'write-only');
    assert.equal(fs.statSync(path.join(writeOnlyDir, 'dir')).isDirectory(), true);
    assert.equal(fs.existsSync(path.join(deniedDir, 'prefix.txt')), false);
    assert.equal(fs.existsSync(path.join(escapeTarget, 'new.txt')), false);
    assert.equal(report.pageTitle, 'nodeless-directory-ready');
    assert.equal(report.hostShutdown, true);
    assert.equal(report.liveLeases, 0);
    assert.equal(report.nodeProcesses, 0);
    assert.equal(report.compatible, false);
    assert.ok(report.notVerified.includes('production-directory-consent'));
    assert.ok(report.notVerified.includes('human-dialog-ui'));
    assert.ok(!report.notVerified.includes('main-fs-directory-grants'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('invalid directory grant scenarios fail closed', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-directory-app');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-directory-invalid-'));
  const readDir = path.join(outside, 'read');
  const filePath = path.join(outside, 'file.txt');
  fs.mkdirSync(readDir, { recursive: true });
  fs.writeFileSync(filePath, 'file\n');
  const validGrant = { path: readDir, mode: 'read' };
  const tooMany = [];
  for (let i = 0; i < 17; i++) tooMany.push(validGrant);
  const cases = [
    ['missing scenario', null],
    ['schema 2', { schema: 2, grants: [validGrant] }],
    ['relative path', { schema: 1, grants: [{ path: 'read', mode: 'read' }] }],
    ['missing directory', { schema: 1, grants: [{ path: path.join(outside, 'missing'), mode: 'read' }] }],
    ['file path', { schema: 1, grants: [{ path: filePath, mode: 'read' }] }],
    ['invalid mode', { schema: 1, grants: [{ path: readDir, mode: 'admin' }] }],
    ['empty grants', { schema: 1, grants: [] }],
    ['too many grants', { schema: 1, grants: tooMany }],
    ['filesystem root', { schema: 1, grants: [{ path: '/', mode: 'read' }] }],
  ];
  try {
    for (const [label, scenario] of cases) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-directory-case-'));
      try {
        fs.cpSync(source, dir, { recursive: true });
        const files = ['index.html', 'package.json', 'src/main.js'];
        if (scenario !== null) {
          fs.writeFileSync(path.join(dir, 'nodeless-directory.json'),
            `${JSON.stringify(scenario)}\n`);
          files.push('nodeless-directory.json');
        }
        writeSourceManifest(path.join(dir, 'source-manifest.json'),
          buildSourceManifest(dir, 'index.html', 'nodeless-directory', files));
        const { result, report } = run(binary, dir,
          ['--window', '--directory-selftest', '--entry', 'src/main.js']);
        assert.notEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
        assert.ok(report, `${label}: missing JSON report`);
        assert.equal(report.status, 'FAIL', label);
        assert.equal(report.code, 'ELECTRON_MBT_NODELESS_DIRECTORY', label);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('directory selftest requires the native window host', () => {
  const binary = buildBinary();
  const { result, report } = run(binary, path.join(root, 'fixtures/nodeless-directory-app'),
    ['--directory-selftest']);
  assert.notEqual(result.status, 0);
  assert.ok(report);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.code, 'ELECTRON_MBT_NODELESS_USAGE');
});

test('fs selftest requires the native window host', () => {
  const binary = buildBinary();
  const { result, report } = run(binary, fixture, ['--fs-selftest']);
  assert.notEqual(result.status, 0);
  assert.ok(report);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.code, 'ELECTRON_MBT_NODELESS_USAGE');
});

test('a Node-less adapted app serves modules and dispatches page API calls to QuickJS main', {
  skip: !nativeHostSupported || !nativeHostAvailable,
}, () => {
  const binary = buildBinary();
  const { result, report } = run(binary, path.join(root, 'fixtures/nodeless-adapted-app'),
    ['--window', '--entry', 'src/main.js']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(report, 'missing JSON report');
  assert.equal(report.status, 'PASS');
  assert.equal(report.rendererLoaded, true);
  assert.equal(report.preloadExecuted, false);
  assert.equal(report.pageURL, 'electron-mbt-app://app/renderer/index.html');
  assert.match(report.pageTitle,
    /^nodeless-adapted-ready-module-dark-idle-(storage|no-storage)-denied-scheme$/);
  assert.equal(report.renderer.apiPresent, true);
  assert.match(report.renderer.text, /^module:dark:idle:(storage|no-storage):denied:scheme$/);
  assert.equal(report.adapted.configured, true);
  assert.equal(report.adapted.observed, true);
  assert.equal(report.adapted.released, true);
  assert.equal(report.adapted.requests, 2);
  assert.equal(report.adapted.replyErrors, 0);
  assert.equal(report.adapted.rejected, 0);
  assert.equal(report.adapted.ingress.admitted, 2);
  assert.equal(report.adapted.ingress.denied, 0);
  assert.equal(report.hostShutdown, true);
  assert.equal(report.liveLeases, 0);
  assert.equal(report.nodeProcesses, 0);
  assert.equal(report.compatible, false);
});

test('the native window can stay open in explicit hold mode', {
  skip: !nativeHostSupported || !nativeHostAvailable,
}, () => {
  const binary = buildBinary();
  const { result } = run(binary, path.join(root, 'fixtures/nodeless-adapted-app'),
    ['--window', '--hold', '--hold-seconds', '2', '--entry', 'src/main.js']);
  assert.equal(result.status, 0, `${result.stdout}
${result.stderr}`);
  const reports = `${result.stdout || ''}
${result.stderr || ''}`.split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
  const holding = reports.find(item => item.status === 'HOLDING');
  assert.ok(holding, 'missing HOLDING report');
  assert.equal(holding.probe, 'nodeless-hold');
  assert.match(holding.pageTitle,
    /^nodeless-adapted-ready-module-dark-idle-(storage|no-storage)-denied-scheme$/);
  assert.equal(holding.adapted, true);
  assert.equal(holding.released, true);
  assert.equal(holding.compatible, false);
  const exited = reports.find(item => item.status === 'HOLD_EXIT');
  assert.ok(exited, 'missing HOLD_EXIT report');
  assert.equal(exited.reason, 'hold-seconds');
  assert.equal(exited.compatible, false);
});

test('the pinned Moji main boots without Node against a probe page', {
  skip: process.platform !== 'darwin' ||
    !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')) ||
    !fs.existsSync(process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji'),
}, () => {
  const result = spawnSync(process.execPath, ['scripts/nodeless-moji-boot.cjs'], {
    cwd: root, encoding: 'utf8', timeout: 180000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  assert.ok(lines.length > 0, 'missing Moji boot report');
  const report = JSON.parse(lines.at(-1));
  assert.equal(report.status, 'PASS');
  assert.equal(report.mainSHA256, '41cd703c31002c0a80f3e6407f2743a93f60a686eb3084cd08cb98cf31f7046e');
  assert.equal(report.preloadSHA256, 'bd0f47d61f79ffa68ebd1a65186d0afc477448ac8c3c911ac8d52aab5d38c544');
  assert.equal(report.windowLoaded, true);
  assert.equal(report.pageTitle, 'moji-nodeless-ready');
  assert.equal(report.preloadExecuted, false);
  assert.equal(report.rendererLoaded, false);
  assert.equal(report.liveLeases, 0);
  assert.equal(report.compatible, false);
});

test('the pinned Moji renderer boots without Node under the adapted page API', {
  skip: process.platform !== 'darwin' ||
    !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')) ||
    !fs.existsSync(process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji'),
}, () => {
  const result = spawnSync(process.execPath, ['scripts/nodeless-moji-app.cjs'], {
    cwd: root, encoding: 'utf8', timeout: 240000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  assert.ok(lines.length > 0, 'missing Moji Node-less app report');
  const report = JSON.parse(lines.at(-1));
  assert.equal(report.status, 'PASS');
  assert.equal(report.mainSHA256, '41cd703c31002c0a80f3e6407f2743a93f60a686eb3084cd08cb98cf31f7046e');
  assert.equal(report.preloadSHA256, 'bd0f47d61f79ffa68ebd1a65186d0afc477448ac8c3c911ac8d52aab5d38c544');
  assert.equal(report.pageURL, 'electron-mbt-app://app/out/renderer/index.html');
  assert.equal(report.pageTitle, 'Moji v1.0.5');
  assert.equal(report.rendererLoaded, true);
  assert.ok(report.rootChildren > 0);
  assert.equal(report.apiPresent, true);
  assert.equal(report.adapted.observed, true);
  assert.equal(report.adapted.released, true);
  assert.ok(report.adapted.requests >= 2);
  assert.equal(report.adapted.replyErrors, 0);
  assert.equal(report.ingress.admitted >= 2, true);
  assert.equal(report.ingress.denied, 0);
  assert.equal(report.broker.configured, true);
  assert.equal(report.broker.mode, 'test-injected');
  assert.equal(report.broker.grants, 1);
  assert.equal(report.broker.dialogs, 6);
  assert.equal(report.broker.triggered, true);
  assert.equal(report.broker.error, '');
  assert.equal(report.apiProbe.state, 'done');
  for (const name of ['openOk', 'saveAsOk', 'exportOk', 'pngOk', 'pdfOk',
    'pdfLandscapeOk', 'docPngOk', 'saveOk', 'readOk', 'sampleOk', 'updateCheckOk']) {
    assert.equal(report.apiProbe[name], true, `${name} must pass`);
  }
  assert.equal(report.apiProbe.settingsTheme, 'dark');
  assert.equal(report.apiProbe.readContent, '# renderer save\n');
  for (const [name, passed] of Object.entries(report.brokerOutputs)) {
    assert.equal(passed, true, `${name} output must be present`);
  }
  assert.equal(report.preloadExecuted, false);
  assert.equal(report.liveLeases, 0);
  assert.equal(report.compatible, false);
});

test('the pinned Moji edits, saves and reopens after restart under the adapted API', {
  skip: process.platform !== 'darwin' ||
    !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')) ||
    !fs.existsSync(process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji'),
}, () => {
  const result = spawnSync(process.execPath, ['scripts/nodeless-moji-edit-save.cjs'], {
    cwd: root, encoding: 'utf8', timeout: 300000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  assert.ok(lines.length > 0, 'missing Moji edit/save report');
  const report = JSON.parse(lines.at(-1));
  assert.equal(report.status, 'PASS');
  assert.equal(report.probe, 'moji-nodeless-edit-save');
  assert.equal(report.mode, 'test-injected');
  assert.equal(report.humanInput, false);
  assert.equal(report.preloadExecuted, false);
  assert.equal(report.compatible, false);
  assert.equal(report.openForEdit.grants, 0);
  assert.equal(report.openForEdit.dialogs, 1);
  assert.equal(report.openForEdit.beforeOpenSave, 'ELECTRON_MBT_FILE_DENIED');
  assert.equal(report.openForEdit.siblingSave, 'ELECTRON_MBT_FILE_DENIED');

  const phase1 = report.phase1;
  assert.ok(phase1, 'missing phase 1');
  assert.equal(phase1.status, 'PASS');
  assert.equal(phase1.block.ok, true);
  assert.equal(phase1.block.probe.state, 'done');
  for (const field of ['open', 'editor', 'inserted', 'dirty', 'saved']) {
    assert.equal(phase1.block.probe[field], true, `phase 1 ${field}`);
  }
  assert.equal(phase1.block.probe.saveError, '');
  assert.ok(['execCommand-insertText', 'replace'].includes(
    phase1.block.probe.editMechanism));
  assert.equal(phase1.block.probe.beforeOpenSave, 'ELECTRON_MBT_FILE_DENIED');
  assert.equal(phase1.block.probe.siblingSave, 'ELECTRON_MBT_FILE_DENIED');
  assert.equal(phase1.ingress.fileSaveAdmitted, 1);
  assert.ok(phase1.ingress.fileSaveDenied >= 2);
  assert.equal(phase1.grantStore.loaded, true);
  assert.equal(phase1.grantStore.persisted, true);
  assert.equal(phase1.grantStore.files.length, 1);
  assert.equal(phase1.grantStore.files[0].mode, 'read');
  assert.equal(phase1.preloadExecuted, false);
  assert.equal(phase1.hostShutdown, true);
  assert.equal(phase1.liveLeases, 0);
  assert.equal(phase1.nodeProcesses, 0);
  assert.ok(phase1.pageTitle.includes('note.md'));

  const phase2 = report.phase2;
  assert.ok(phase2, 'missing phase 2');
  assert.equal(phase2.status, 'PASS');
  assert.equal(phase2.block.ok, true);
  assert.equal(phase2.block.probe.state, 'done');
  assert.equal(phase2.block.probe.open, true);
  assert.equal(phase2.block.probe.editor, true);
  assert.equal(phase2.block.probe.reopenMarkerPresent, true);
  assert.equal(phase2.block.probe.inserted, true);
  assert.equal(phase2.block.probe.dirty, true);
  assert.equal(phase2.block.probe.saved, true);
  assert.equal(phase2.block.probe.saveError, '');
  assert.equal(phase2.ingress.fileSaveAdmitted, 1);
  assert.equal(phase2.ingress.fileSaveDenied, 0);
  assert.equal(phase2.grantStore.loaded, true);
  assert.equal(phase2.grantStore.persisted, true);
  assert.equal(phase2.hostShutdown, true);
  assert.equal(phase2.liveLeases, 0);
  assert.equal(phase2.nodeProcesses, 0);

  assert.equal(report.document.metadata.modeBefore, '640');
  for (const phase of ['phase1', 'phase2']) {
    assert.equal(report.document.metadata[phase].mode, '640');
    assert.equal(report.document.metadata[phase].xattr, 'metadata-preserved');
    assert.equal(report.document.metadata[phase].nlink, 1);
  }

  const phase3 = report.phase3;
  assert.ok(phase3, 'missing hardlink phase');
  assert.equal(phase3.status, 'PASS');
  assert.equal(phase3.block.ok, true);
  assert.equal(phase3.block.probe.state, 'done');
  assert.equal(phase3.block.probe.open, true);
  assert.equal(phase3.block.probe.saveFailure, 'ELECTRON_MBT_FILE_LINK');
  assert.equal(phase3.ingress.fileSaveAdmitted, 0);
  assert.ok(phase3.ingress.fileSaveDenied >= 1);
  assert.equal(phase3.ingress.lastCode, 'ELECTRON_MBT_FILE_LINK');
  assert.equal(phase3.hostShutdown, true);
  assert.equal(phase3.liveLeases, 0);
  assert.equal(phase3.nodeProcesses, 0);
  assert.equal(report.document.hardlink.nlink, 2);
  assert.equal(report.document.hardlink.unchanged, true);
  assert.equal(report.document.hardlink.noteBytes, report.document.finalBytes);
  assert.equal(report.document.hardlink.linkBytes, report.document.finalBytes);

  assert.equal(report.document.phase1Mechanism, phase1.block.probe.editMechanism);
  assert.equal(report.document.phase2Mechanism, phase2.block.probe.editMechanism);
  assert.ok(report.document.finalBytes > report.document.initialBytes);
  assert.notEqual(report.document.initialSHA256, report.document.finalSHA256);
});

test('an invalid adapted profile fails closed before main evaluation', () => {
  const binary = buildBinary();
  for (const adapter of ['../escape.js', 'adapted/missing.js']) {
    const dir = temporaryApp('module.exports = 1;\n', {
      'nodeless-app.json': `${JSON.stringify({
        schema: 1, profile: 'electron-nodeless-adapted-v1', adapter,
      })}\n`,
    });
    try {
      const { result, report } = run(binary, dir);
      assert.notEqual(result.status, 0);
      assert.ok(report);
      assert.equal(report.status, 'FAIL');
      assert.equal(report.code, 'ELECTRON_MBT_NODELESS_PROFILE');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('broker selftest stays disabled without the explicit flag', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-broker-gate-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/main.js'), [
      "'use strict';",
      "const { app, BrowserWindow } = require('electron');",
      "app.whenReady().then(function () {",
      "  const win = new BrowserWindow({ width: 320, height: 200, title: 'broker-gate', show: false });",
      "  win.loadFile('index.html');",
      "});",
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'index.html'),
      '<!doctype html><title>broker-gate-ready</title><body>broker-gate</body>\n');
    fs.writeFileSync(path.join(dir, 'package.json'),
      '{"name":"broker-gate","version":"1.0.0","main":"src/main.js"}\n');
    fs.writeFileSync(path.join(dir, 'nodeless-broker.json'), '{"schema":99}\n');
    const manifest = buildSourceManifest(dir, 'index.html', 'broker-gate', [
      'index.html', 'package.json', 'src/main.js', 'nodeless-broker.json',
    ]);
    writeSourceManifest(path.join(dir, 'source-manifest.json'), manifest);
    const { result, report } = run(binary, dir, ['--window', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report);
    assert.equal(report.status, 'PASS');
    assert.equal(report.broker.configured, false);
    assert.equal(report.broker.grants, 0);
    assert.equal(report.broker.dialogs, 0);
    assert.equal(report.broker.triggered, false);
    assert.equal(report.compatible, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a source hash mismatch fails closed', () => {
  const binary = buildBinary();
  const dir = temporaryApp('module.exports = 1;\n');
  try {
    const manifestPath = path.join(dir, 'source-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.files[0].sha256 = '0'.repeat(64);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const { result, report } = run(binary, dir);
    assert.notEqual(result.status, 0);
    assert.ok(report);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.code, 'ELECTRON_MBT_NODELESS_SOURCE_HASH');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a computed require is rejected before evaluation', () => {
  const binary = buildBinary();
  const dir = temporaryApp('const name = "./x"; require(name);\n');
  try {
    const { result, report } = run(binary, dir);
    assert.notEqual(result.status, 0);
    assert.ok(report);
    assert.equal(report.status, 'FAIL');
    assert.equal(report.code, 'ELECTRON_MBT_DYNAMIC_REQUIRE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main dialog grants read-only selections and fails closed', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-dialog-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-dialog-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-dialog-outside-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
    const fileDir = path.join(outside, 'files');
    const dirDir = path.join(outside, 'dir');
    fs.mkdirSync(fileDir, { recursive: true });
    fs.mkdirSync(dirDir, { recursive: true });
    const files = [];
    for (let i = 0; i < 17; i++) {
      const file = path.join(fileDir, `file-${i}.txt`);
      fs.writeFileSync(file, `file-${i}\n`);
      files.push(file);
    }
    const special = path.join(fileDir, 'file with space-日本語.txt');
    fs.writeFileSync(special, 'special\n');
    fs.writeFileSync(path.join(dirDir, 'inside.txt'), 'inside\n');

    const canonical = file => fs.realpathSync(file);
    const results = [
      { canceled: false, paths: [files[0], special, files[1]] },
      { canceled: false, paths: [dirDir] },
      { canceled: false, paths: [files[2], dirDir] },
      { canceled: true, paths: [] },
      { canceled: false, paths: [dirDir] },
      { canceled: false, paths: [files[0], files[1], files[2]] },
      { canceled: false, paths: files },
      { canceled: false, paths: [files[0], files[0]] },
      { canceled: false, paths: files.slice(0, 16) },
    ];
    fs.writeFileSync(path.join(dir, 'nodeless-dialog.json'),
      `${JSON.stringify({ schema: 1, results }, null, 2)}\n`);
    const manifestFiles = ['index.html', 'package.json', 'src/main.js', 'nodeless-dialog.json'];
    writeSourceManifest(path.join(dir, 'source-manifest.json'),
      buildSourceManifest(dir, 'index.html', 'nodeless-dialog', manifestFiles));

    const { result, report } = run(binary, dir,
      ['--window', '--dialog-selftest', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.pageTitle, 'nodeless-dialog-ready');
    assert.equal(report.dialogSelftestOk, true);
    assert.equal(report.dialogUIOk, true);
    assert.equal(report.hostShutdown, true);
    assert.equal(report.liveLeases, 0);
    assert.equal(report.nodeProcesses, 0);
    assert.equal(report.compatible, false);
    assert.ok(report.notVerified.includes('production-directory-consent'));
    assert.ok(report.notVerified.includes('human-dialog-ui'));
    assert.ok(report.notVerified.includes('human-main-dialog-selection'));
    assert.ok(report.notVerified.includes('human-main-save-selection'));
    assert.ok(report.notVerified.includes('main-save-overwrite-confirmation'));
    assert.ok(!report.notVerified.includes('main-dialog-write-consent'));
    assert.ok(report.notVerified.includes('main-dialog-sheet-parenting'));

    const dialog = report.dialogSelftest;
    assert.ok(dialog, 'missing dialog selftest payload');
    assert.equal(dialog.ok, true);
    assert.equal(dialog.stage, 'controls');
    assert.deepEqual(dialog.multi.filePaths,
      [canonical(files[0]), canonical(special), canonical(files[1])]);
    assert.deepEqual(dialog.multi.read, ['file-0\n', 'special\n', 'file-1\n']);
    assert.equal(dialog.multi.write, 'EACCES');
    assert.equal(dialog.multi.siblingRead, 'EACCES');

    assert.deepEqual(dialog.parent.filePaths, [canonical(dirDir)]);
    assert.ok(dialog.parent.names.includes('inside.txt'));
    assert.equal(dialog.parent.statDir, true);
    assert.equal(dialog.parent.write, 'EACCES');
    assert.equal(dialog.parent.mkdir, 'EACCES');

    assert.deepEqual(dialog.mixed.filePaths, [canonical(files[2]), canonical(dirDir)]);
    assert.equal(dialog.mixed.entries[0].kind, 'file');
    assert.equal(dialog.mixed.entries[0].text, 'file-2\n');
    assert.equal(dialog.mixed.entries[1].kind, 'directory');
    assert.ok(dialog.mixed.entries[1].names.includes('inside.txt'));

    assert.deepEqual(dialog.cancel, { canceled: true, filePaths: [] });
    assert.equal(dialog.typeMismatch, 'ELECTRON_MBT_DIALOG_SELECTION');
    assert.equal(dialog.multiNotAllowed, 'ELECTRON_MBT_DIALOG_SELECTION');
    assert.equal(dialog.tooMany, 'EFBIG');
    assert.equal(dialog.duplicate, 'ELECTRON_MBT_DIALOG_SELECTION');
    assert.equal(dialog.sixteen.count, 16);
    assert.equal(dialog.sixteen.first, canonical(files[0]));
    assert.equal(dialog.sixteen.last, canonical(files[15]));
    assert.equal(dialog.unsupported, 'ELECTRON_MBT_UNSUPPORTED_API');
    assert.equal(dialog.destroyedParent, 'ELECTRON_MBT_WINDOW_DESTROYED');
    assert.equal(dialog.selfSetResults, 'ELECTRON_MBT_HOST_REQUEST_DENIED');
    assert.equal(dialog.selfStatus, 'ELECTRON_MBT_HOST_REQUEST_DENIED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('invalid main dialog scenarios fail closed before app dispatch', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-dialog-app');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-dialog-invalid-'));
  const validPath = path.join(outside, 'valid.txt');
  fs.writeFileSync(validPath, 'valid\n');
  const validResult = { canceled: false, paths: [validPath] };
  const tooManyResults = [];
  for (let i = 0; i < 17; i++) tooManyResults.push(validResult);
  const cases = [
    ['missing scenario', null],
    ['schema 2', { schema: 2, results: [validResult] }],
    ['results missing', { schema: 1 }],
    ['empty results', { schema: 1, results: [] }],
    ['too many results', { schema: 1, results: tooManyResults }],
    ['canceled with paths', { schema: 1, results: [{ canceled: true, paths: [validPath] }] }],
    ['non-canceled without paths', { schema: 1, results: [{ canceled: false, paths: [] }] }],
    ['relative path', { schema: 1, results: [{ canceled: false, paths: ['relative.txt'] }] }],
    ['non-string path', { schema: 1, results: [{ canceled: false, paths: [7] }] }],
    ['overlong path', { schema: 1, results: [{ canceled: false, paths: [`/${'x'.repeat(4100)}`] }] }],
  ];
  try {
    for (const [label, scenario] of cases) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-dialog-case-'));
      try {
        fs.cpSync(source, dir, { recursive: true });
        let manifestFiles = ['index.html', 'package.json', 'src/main.js'];
        if (scenario !== null) {
          fs.writeFileSync(path.join(dir, 'nodeless-dialog.json'),
            `${JSON.stringify(scenario)}\n`);
          manifestFiles = manifestFiles.concat('nodeless-dialog.json');
          writeSourceManifest(path.join(dir, 'source-manifest.json'),
            buildSourceManifest(dir, 'index.html', 'nodeless-dialog', manifestFiles));
        }
        const { result, report } = run(binary, dir,
          ['--window', '--dialog-selftest', '--entry', 'src/main.js']);
        assert.notEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
        assert.ok(report, `${label}: missing JSON report`);
        assert.equal(report.status, 'FAIL', label);
        assert.equal(report.code, 'ELECTRON_MBT_NODELESS_DIALOG', label);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('main dialog selftests require a window and reject conflicting modes', () => {
  const binary = buildBinary();
  const fixture = path.join(root, 'fixtures/nodeless-dialog-app');
  const withoutWindow = run(binary, fixture, ['--dialog-selftest', '--entry', 'src/main.js']);
  assert.notEqual(withoutWindow.result.status, 0);
  assert.ok(withoutWindow.report);
  assert.equal(withoutWindow.report.status, 'FAIL');
  assert.equal(withoutWindow.report.code, 'ELECTRON_MBT_NODELESS_USAGE');

  const conflicting = run(binary, fixture,
    ['--window', '--dialog-selftest', '--dialog-ui-selftest', '--entry', 'src/main.js']);
  assert.notEqual(conflicting.result.status, 0);
  assert.ok(conflicting.report);
  assert.equal(conflicting.report.status, 'FAIL');
  assert.equal(conflicting.report.code, 'ELECTRON_MBT_NODELESS_USAGE');

  const saveWithoutWindow = run(binary, fixture,
    ['--save-dialog-selftest', '--entry', 'src/main.js']);
  assert.notEqual(saveWithoutWindow.result.status, 0);
  assert.ok(saveWithoutWindow.report);
  assert.equal(saveWithoutWindow.report.code, 'ELECTRON_MBT_NODELESS_USAGE');

  const saveConflicting = run(binary, fixture,
    ['--window', '--save-dialog-selftest', '--dialog-selftest', '--entry', 'src/main.js']);
  assert.notEqual(saveConflicting.result.status, 0);
  assert.ok(saveConflicting.report);
  assert.equal(saveConflicting.report.code, 'ELECTRON_MBT_NODELESS_USAGE');

  const saveUIConflicting = run(binary, fixture,
    ['--window', '--save-dialog-selftest', '--dialog-ui-selftest', '--entry', 'src/main.js']);
  assert.notEqual(saveUIConflicting.result.status, 0);
  assert.ok(saveUIConflicting.report);
  assert.equal(saveUIConflicting.report.code, 'ELECTRON_MBT_NODELESS_USAGE');
});

test('main save dialog grants write consent and fails closed', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-dialog-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-save-dialog-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-save-dialog-outside-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
    const targetDir = path.join(outside, 'targets');
    fs.mkdirSync(targetDir, { recursive: true });
    const newFile = path.join(targetDir, 'new file-日本語.md');
    const existing = path.join(targetDir, 'existing.md');
    const newSibling = `${newFile}.sibling`;
    const existingSibling = `${existing}.sibling`;
    const cancelTarget = `${newFile}.cancel`;
    const dangling = `${newFile}.dangling`;
    const missingParent = path.join(newFile, 'missing', 'parent.md');
    fs.writeFileSync(existing, 'existing-before\n');
    fs.writeFileSync(newSibling, 'sibling\n');
    fs.writeFileSync(existingSibling, 'sibling\n');
    fs.writeFileSync(cancelTarget, 'cancel-target\n');
    fs.symlinkSync(path.join(outside, 'missing-target'), dangling);
    const canonical = file => fs.realpathSync(file);
    const results = [
      { canceled: false, path: newFile },
      { canceled: false, path: existing },
      { canceled: true },
      { canceled: true },
      { canceled: true },
      { canceled: true },
      { canceled: true },
      { canceled: false, path: targetDir },
      { canceled: false, path: missingParent },
      { canceled: false, path: dangling },
      { canceled: false, path: existing },
      { canceled: false, path: '/' },
      { canceled: true },
      { canceled: true },
    ];
    fs.writeFileSync(path.join(dir, 'nodeless-save-dialog.json'),
      `${JSON.stringify({ schema: 1, results }, null, 2)}\n`);
    const files = ['index.html', 'package.json', 'src/main.js', 'nodeless-save-dialog.json'];
    writeSourceManifest(path.join(dir, 'source-manifest.json'),
      buildSourceManifest(dir, 'index.html', 'nodeless-dialog', files));

    const { result, report } = run(binary, dir,
      ['--window', '--save-dialog-selftest', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.pageTitle, 'nodeless-dialog-ready');
    assert.equal(report.saveDialogSelftestOk, true);
    assert.equal(report.hostShutdown, true);
    assert.equal(report.liveLeases, 0);
    assert.equal(report.nodeProcesses, 0);
    assert.equal(report.compatible, false);
    assert.ok(report.notVerified.includes('human-main-save-selection'));
    assert.ok(report.notVerified.includes('main-save-overwrite-confirmation'));
    assert.ok(report.notVerified.includes('human-main-dialog-selection'));
    assert.ok(report.notVerified.includes('main-dialog-sheet-parenting'));
    assert.ok(!report.notVerified.includes('main-dialog-write-consent'));

    const dialog = report.saveDialogSelftest;
    assert.ok(dialog, 'missing save dialog selftest payload');
    assert.equal(dialog.ok, true);
    assert.equal(dialog.stage, 'controls');
    assert.equal(dialog.shape, true);
    assert.equal(dialog.syncCode, 'ELECTRON_MBT_UNSUPPORTED_API');

    assert.equal(dialog.newFile.canceled, false);
    assert.equal(dialog.newFile.filePath, canonical(newFile));
    assert.equal(dialog.newFile.firstRead, 'save-new');
    assert.equal(dialog.newFile.read, 'save-new-again');
    assert.equal(dialog.newFile.bytes, Buffer.byteLength('save-new-again'));
    assert.equal(dialog.newFile.siblingWrite, 'EACCES');

    assert.equal(dialog.existing.canceled, false);
    assert.equal(dialog.existing.filePath, canonical(existing));
    assert.equal(dialog.existing.read, 'save-existing');
    assert.equal(dialog.existing.siblingRead, 'EACCES');
    assert.equal(dialog.existing.siblingWrite, 'EACCES');
    assert.equal(dialog.existing.readdir, 'EACCES');
    assert.equal(dialog.existing.mkdir, 'EACCES');

    assert.equal(dialog.cancel.canceled, true);
    assert.equal(dialog.cancel.hasFilePath, true);
    assert.equal(dialog.cancel.undefinedFilePath, true);
    assert.equal(dialog.cancel.targetWrite, 'EACCES');

    assert.equal(dialog.defaults.directoryCanceled, true);
    assert.equal(dialog.defaults.bareCanceled, true);
    assert.equal(dialog.defaults.fileCanceled, true);
    assert.equal(dialog.defaults.overwriteCanceled, true);
    assert.equal(dialog.defaults.relativeCode, 'EINVAL');
    assert.equal(dialog.defaults.unknownCode, 'ELECTRON_MBT_UNSUPPORTED_API');
    assert.equal(dialog.defaults.propertyCode, 'ELECTRON_MBT_UNSUPPORTED_API');

    assert.equal(dialog.rejections.directory, 'EISDIR');
    assert.equal(dialog.rejections.missingParent, 'ELECTRON_MBT_DIALOG_SELECTION');
    assert.equal(dialog.rejections.dangling, 'ELECTRON_MBT_DIALOG_SELECTION');
    assert.equal(dialog.rejections.duplicateRead, 'save-existing');
    assert.equal(dialog.rejections.root, 'ELECTRON_MBT_DIALOG_SELECTION');

    assert.equal(dialog.parent.liveCanceled, true);
    assert.equal(dialog.parent.destroyed, 'ELECTRON_MBT_WINDOW_DESTROYED');
    assert.equal(dialog.cap, 'no-error');
    assert.equal(dialog.selfSetResults, 'ELECTRON_MBT_HOST_REQUEST_DENIED');
    assert.equal(dialog.selfStatus, 'ELECTRON_MBT_HOST_REQUEST_DENIED');

    assert.equal(fs.readFileSync(newFile, 'utf8'), 'save-new-again');
    assert.equal(fs.readFileSync(existing, 'utf8'), 'save-existing');
    assert.equal(fs.readFileSync(cancelTarget, 'utf8'), 'cancel-target\n');
    assert.equal(fs.readFileSync(newSibling, 'utf8'), 'sibling\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('main save dialog fails closed at the grant cap', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-dialog-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-save-cap-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-save-cap-outside-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
    const targetDir = path.join(outside, 'targets');
    fs.mkdirSync(targetDir, { recursive: true });
    const newFile = path.join(targetDir, 'new file-日本語.md');
    const existing = path.join(targetDir, 'existing.md');
    fs.writeFileSync(existing, 'existing-before\n');
    fs.writeFileSync(`${newFile}.sibling`, 'sibling\n');
    fs.writeFileSync(`${existing}.sibling`, 'sibling\n');
    fs.writeFileSync(`${newFile}.cancel`, 'cancel-target\n');
    fs.symlinkSync(path.join(outside, 'missing-target'), `${newFile}.dangling`);
    const grants = [
      { path: newFile, mode: 'readwrite' },
      { path: existing, mode: 'readwrite' },
    ];
    for (let i = 0; i < 62; i++) {
      const file = path.join(targetDir, `cap-fill-${i}.md`);
      fs.writeFileSync(file, 'fill\n');
      grants.push({ path: file, mode: 'readwrite' });
    }
    const capTarget = path.join(targetDir, 'cap-65.md');
    const results = [
      { canceled: false, path: newFile },
      { canceled: false, path: existing },
      { canceled: true },
      { canceled: true },
      { canceled: true },
      { canceled: true },
      { canceled: true },
      { canceled: false, path: targetDir },
      { canceled: false, path: path.join(newFile, 'missing', 'parent.md') },
      { canceled: false, path: `${newFile}.dangling` },
      { canceled: false, path: existing },
      { canceled: false, path: '/' },
      { canceled: true },
      { canceled: false, path: capTarget },
    ];
    fs.writeFileSync(path.join(dir, 'nodeless-save-dialog.json'),
      `${JSON.stringify({ schema: 1, grants, results }, null, 2)}\n`);
    const files = ['index.html', 'package.json', 'src/main.js', 'nodeless-save-dialog.json'];
    writeSourceManifest(path.join(dir, 'source-manifest.json'),
      buildSourceManifest(dir, 'index.html', 'nodeless-dialog', files));

    const { result, report } = run(binary, dir,
      ['--window', '--save-dialog-selftest', '--entry', 'src/main.js']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(report, 'missing JSON report');
    assert.equal(report.status, 'PASS');
    assert.equal(report.saveDialogSelftestOk, true);
    assert.equal(report.saveDialogSelftest.ok, true);
    assert.equal(report.saveDialogSelftest.cap, 'EFBIG');
    assert.equal(report.saveDialogSelftest.newFile.canceled, false);
    assert.equal(fs.existsSync(capTarget), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('invalid main save dialog scenarios fail closed before app dispatch', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-dialog-app');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-save-invalid-'));
  const validPath = path.join(outside, 'valid.md');
  fs.writeFileSync(validPath, 'valid\n');
  const tooManyResults = Array.from({ length: 17 }, () => ({ canceled: true }));
  const tooManyGrants = Array.from({ length: 65 }, () => ({ path: validPath, mode: 'read' }));
  const overBound = Array.from({ length: 16 },
    () => ({ canceled: false, path: `/${'x'.repeat(600)}` }));
  const cases = [
    ['missing scenario', null],
    ['schema 2', { schema: 2, results: [{ canceled: true }] }],
    ['results missing', { schema: 1 }],
    ['empty results', { schema: 1, results: [] }],
    ['too many results', { schema: 1, results: tooManyResults }],
    ['canceled with path', { schema: 1, results: [{ canceled: true, path: validPath }] }],
    ['non-canceled without path', { schema: 1, results: [{ canceled: false }] }],
    ['relative path', { schema: 1, results: [{ canceled: false, path: 'relative.md' }] }],
    ['non-string path', { schema: 1, results: [{ canceled: false, path: 7 }] }],
    ['overlong path', { schema: 1, results: [{ canceled: false, path: `/${'x'.repeat(4100)}` }] }],
    ['invalid grant mode', {
      schema: 1,
      grants: [{ path: validPath, mode: 'execute' }],
      results: [{ canceled: true }],
    }],
    ['too many grants', { schema: 1, grants: tooManyGrants, results: [{ canceled: true }] }],
    ['payload over bound', { schema: 1, results: overBound }],
  ];
  try {
    for (const [label, scenario] of cases) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-save-case-'));
      try {
        fs.cpSync(source, dir, { recursive: true });
        let manifestFiles = ['index.html', 'package.json', 'src/main.js'];
        if (scenario !== null) {
          fs.writeFileSync(path.join(dir, 'nodeless-save-dialog.json'),
            `${JSON.stringify(scenario)}\n`);
          manifestFiles = manifestFiles.concat('nodeless-save-dialog.json');
          writeSourceManifest(path.join(dir, 'source-manifest.json'),
            buildSourceManifest(dir, 'index.html', 'nodeless-dialog', manifestFiles));
        }
        const { result, report } = run(binary, dir,
          ['--window', '--save-dialog-selftest', '--entry', 'src/main.js']);
        assert.notEqual(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
        assert.ok(report, `${label}: missing JSON report`);
        assert.equal(report.status, 'FAIL', label);
        assert.equal(report.code, 'ELECTRON_MBT_NODELESS_SAVE_DIALOG', label);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
