'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { NativeHost } = require('../bridges/node/native-host.cjs');
const { ExperimentalRuntime } = require('../bridges/node/runtime-session.cjs');
const { inspectApp } = require('../bridges/node/app-files.cjs');

function fdCount() {
  return fs.readdirSync('/dev/fd').length;
}
async function withDeadline(promise, ms, reason) {
  let deadline;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error(reason)), ms);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}
async function verifyFailedSpawn(app) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-unlaunchable-'));
  const binary = path.join(dir, 'not-executable');
  try {
    fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
    fs.chmodSync(binary, 0o600);
    const before = fdCount();
    assert.throws(
      () => new NativeHost(app.root, { testingExecutable: binary }),
      { code: 'ELECTRON_MBT_TRANSPORT_SPAWN' },
    );
    assert.throws(
      () => new ExperimentalRuntime(app, {
        nativeHostOptions: { testingExecutable: binary },
      }),
      { code: 'ELECTRON_MBT_TRANSPORT_SPAWN' },
    );
    // Both ChildProcess objects can emit asynchronous error+close only after
    // the constructors throw. The listener must be installed before that turn.
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(fdCount() <= before + 2,
      'Native descriptors leaked when child had no executable permission');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function verifyAbortBeforeReady(app) {
  const runtime = new ExperimentalRuntime(app);
  let ready = 0, lost = 0;
  runtime.app.on('ready', () => { ready++; });
  runtime.app.on('runtime-host-gone', () => { lost++; });
  const whenReady = assert.rejects(runtime.app.whenReady(),
    { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
  runtime.host.abort();
  runtime.start();
  await whenReady;
  assert.equal(ready, 0);
  assert.equal(lost, 1);
  assert.equal(runtime.terminated, true);
  assert.equal(runtime.host.dead, true);
  await withDeadline(once(runtime.host.process, 'close'), 5000,
    'Native host did not close after abort-before-ready');
}
async function verifyUnexpectedExitAfterReady(app) {
  const runtime = new ExperimentalRuntime(app);
  try {
    runtime.start();
    await runtime.app.whenReady();
    const window = new runtime.BrowserWindow({ show: false });
    let closed = 0, lost = 0;
    window.on('closed', () => { closed++; });
    runtime.app.on('runtime-host-gone', () => { lost++; });
    const lostSignal = once(runtime.app, 'runtime-host-gone');
    runtime.host.process.kill('SIGKILL');
    await withDeadline(lostSignal, 5000,
      'Runtime did not observe child exit and revoke its session');
    assert.equal(lost, 1);
    assert.equal(runtime.terminated, true);
    assert.equal(runtime.host.dead, true);
    assert.equal(window.isDestroyed(), true);
    assert.equal(runtime.BrowserWindow.getAllWindows().length, 0);
    assert.equal(closed, 0,
      'Host loss must not forge a successful window close ACK');
    assert.throws(() => window.show(), {
      code: 'ELECTRON_MBT_WINDOW_DESTROYED',
    });
  } finally {
    runtime.abort();
  }
}
async function main() {
  if (process.platform !== 'darwin')
    throw new Error('This test requires the native macOS host');
  const app = inspectApp(path.resolve(__dirname, '../fixtures/m1-app'));
  await verifyFailedSpawn(app);
  await verifyAbortBeforeReady(app);
  await verifyUnexpectedExitAfterReady(app);
  console.log(JSON.stringify({
    probe: 'm1-native-host-loss', status: 'PASS',
    nonExecutableSpawnRejected: true, noUnhandledAsyncSpawnError: true,
    failedLaunchDescriptorsRecovered: true,
    beforeReadyPromiseRejected: true, noSpuriousReady: true,
    unexpectedChildExitEmitsRuntimeHostGone: true,
    nativeWindowStateRevokedWithoutFakeClosedEvent: true,
    compatible: false,
  }));
}
main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
