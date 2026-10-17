'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NativeHost } = require('../bridges/node/native-host.cjs');
const { buildSourceManifest } = require('./source-manifest.cjs');
const { expectNativeTitle } = require('./native-title-observation.cjs');

function writeManifest(root, manifest) {
  fs.writeFileSync(path.join(root, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
function snapshotDirs() {
  return new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('electron-mbt-snapshot-')));
}
async function waitForExit(host) {
  if (host.process.exitCode !== null || host.process.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      host.process.kill('SIGKILL');
      reject(new Error('native host did not exit within 4 seconds'));
    }, 4000);
    host.process.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}
async function withHost(root, run) {
  const host = new NativeHost(root, { watchdogMs: 15000 });
  try {
    assert.equal(host.request('hello').backend, 'AppKit+WKWebView');
    assert.equal(host.request('ready').backend, 'AppKit+WKWebView');
    assert.equal(host.request('create-window', 1, 0, {
      width: 320, height: 240, title: 'source snapshot probe', show: false,
    }).webViewAttached, true);
    return await run(host);
  } finally {
    const exited = new Promise(resolve => host.process.once('exit', resolve));
    try { host.close(); } catch {}
    await Promise.race([exited, waitForExit(host)]);
  }
}

async function mutationIsolation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-positive-'));
  const before = snapshotDirs();
  try {
    fs.writeFileSync(path.join(root, 'index.html'),
      '<!doctype html><title>prepared-title</title><p>prepared-content</p>');
    const manifest = buildSourceManifest(root, 'index.html', 'source-probe');
    writeManifest(root, manifest);
    const result = await withHost(root, async host => {
      const prepared = host.request('prepare-source', 1, 0, { file: 'index.html' });
      assert.equal(prepared.prepared, true);
      assert.equal(prepared.sha256, manifest.sha256);
      assert.equal(prepared.bytes, manifest.bytes);
      // Mutate the working tree only after the snapshot was prepared.
      fs.writeFileSync(path.join(root, 'index.html'),
        '<!doctype html><title>mutated-title</title><p>mutated-content</p>');
      assert.equal(host.request('begin-load', 1, 1).generation, 1);
      const loaded = await host.requestAsync('load-file', 1, 1, {
        file: path.join(root, 'index.html'),
      });
      assert.equal(loaded.didFinishLoad, true);
      assert.match(loaded.url, /\/electron-mbt-snapshot-[^/]+\/index\.html$/);
      await expectNativeTitle(
        () => host.request('get-web-contents-title', 1, 1).title,
        'prepared-title',
      );
      assert.notEqual(host.request('get-web-contents-title', 1, 1).title, 'mutated-title');
      const identity = host.request('get-document-identity', 1, 1);
      assert.deepEqual(identity, {
        generation: 1, source: 'snapshot', sha256: manifest.sha256,
      });
      return {
        preparedSHA256: prepared.sha256,
        documentIdentity: identity.source,
        loadedFromSnapshot: true,
      };
    });
    const created = [...snapshotDirs()].filter(name => !before.has(name));
    assert.deepEqual(created, [], 'snapshot staging directory was not removed');
    return result;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function hashMismatchRejected() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-mismatch-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>mismatch</title>');
    const manifest = buildSourceManifest(root, 'index.html', 'source-probe');
    manifest.sha256 = '0'.repeat(64);
    writeManifest(root, manifest);
    return await withHost(root, host => {
      assert.throws(() => host.request('prepare-source', 1, 0, { file: 'index.html' }), {
        code: 'ELECTRON_MBT_SOURCE_MISMATCH',
      });
      return true;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function symlinkEscapeRejected() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-symlink-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-outside-'));
  try {
    const outside = path.join(outsideRoot, 'outside.html');
    fs.writeFileSync(outside, '<!doctype html><title>outside</title>');
    fs.symlinkSync(outside, path.join(root, 'escape.html'));
    const data = fs.readFileSync(outside);
    writeManifest(root, {
      schema: 1,
      app: 'source-probe',
      entry: 'escape.html',
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      bytes: data.length,
    });
    return await withHost(root, host => {
      assert.throws(() => host.request('prepare-source', 1, 0, { file: 'escape.html' }), {
        code: 'ELECTRON_MBT_SOURCE_DENIED',
      });
      return true;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
}

async function nonRegularRejected() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-directory-'));
  try {
    fs.mkdirSync(path.join(root, 'directory'));
    writeManifest(root, {
      schema: 1,
      app: 'source-probe',
      entry: 'directory',
      sha256: 'a'.repeat(64),
      bytes: 1,
    });
    return await withHost(root, host => {
      assert.throws(() => host.request('prepare-source', 1, 0, { file: 'directory' }), {
        code: 'ELECTRON_MBT_SOURCE_DENIED',
      });
      return true;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function missingManifestRejected() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-source-missing-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>missing manifest</title>');
    return await withHost(root, host => {
      assert.throws(() => host.request('prepare-source', 1, 0, { file: 'index.html' }), {
        code: 'ELECTRON_MBT_SOURCE_MANIFEST',
      });
      return true;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('ELECTRON_MBT_UNSUPPORTED_PLATFORM');
  const positive = await mutationIsolation();
  const mismatch = await hashMismatchRejected();
  const symlink = await symlinkEscapeRejected();
  const nonRegular = await nonRegularRejected();
  const missing = await missingManifestRejected();
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    probe: 'm1-source-snapshot',
    backend: 'AppKit+WKWebView',
    ...positive,
    hashMismatchRejected: mismatch,
    symlinkEscapeRejected: symlink,
    nonRegularRejected: nonRegular,
    missingManifestRejected: missing,
    compatible: false,
  })}\n`);
}

main().catch(error => {
  process.stderr.write(`ELECTRON_MBT_SOURCE_SNAPSHOT: ${error.message}\n`);
  process.exitCode = 1;
});
