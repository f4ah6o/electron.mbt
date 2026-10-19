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
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
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

test('main fs reads app files and atomically writes appData without Node', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
}, () => {
  const binary = buildBinary();
  const source = path.join(root, 'fixtures/nodeless-fs-app');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-nodeless-fs-'));
  try {
    fs.cpSync(source, dir, { recursive: true });
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
    assert.equal(report.userFileSelftest.writeReadBack, true);
    assert.equal(report.userFileSelftest.writeAsync, true);
    assert.equal(report.userFileSelftest.existsWrite, true);
    assert.equal(report.userFileSelftest.deniedRead, 'EACCES');
    assert.equal(report.userFileSelftest.deniedExists, false);
    assert.equal(report.userFileSelftest.deniedWrite, 'EACCES');
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

test('fs selftest requires the native window host', () => {
  const binary = buildBinary();
  const { result, report } = run(binary, fixture, ['--fs-selftest']);
  assert.notEqual(result.status, 0);
  assert.ok(report);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.code, 'ELECTRON_MBT_NODELESS_USAGE');
});

test('a Node-less adapted app serves modules and dispatches page API calls to QuickJS main', {
  skip: process.platform !== 'darwin' || !fs.existsSync(path.join(root, 'dist/electron-mbt-native-host')),
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
  assert.equal(report.adapted.ingress.admitted, 2);
  assert.equal(report.adapted.ingress.denied, 0);
  assert.equal(report.hostShutdown, true);
  assert.equal(report.liveLeases, 0);
  assert.equal(report.nodeProcesses, 0);
  assert.equal(report.compatible, false);
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
