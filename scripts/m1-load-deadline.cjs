'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { NativeHost } = require('../bridges/node/native-host.cjs');

const root = path.resolve(__dirname, '../fixtures/m1');
const helper = path.resolve(__dirname, 'm1-load-stall-host.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function childExited(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(2500).then(() => { throw new Error('Native fault fixture child not reaped'); }),
  ]);
}
function makeHost(watchdogMs) {
  return new NativeHost(root, {
    testingExecutable: process.execPath,
    testingArgs: [helper],
    watchdogMs,
  });
}
async function queueDeadline() {
  const host = makeHost(350);
  const child = host.process;
  const start = process.hrtime.bigint();
  try {
    const loads = Array.from({ length: 4 }, (_, index) =>
      host.requestAsync('load-file', index + 1, 1, {}));
    const checked = loads.map(promise => assert.rejects(promise, error =>
      error && ['ELECTRON_MBT_TRANSPORT_TIMEOUT', 'ELECTRON_MBT_TRANSPORT_CLOSED']
        .includes(error.code)));
    await Promise.all(checked);
    const elapsed = Number((process.hrtime.bigint() - start) / 1000000n);
    assert.ok(elapsed < 1100, 'Queued loads exceeded their end-to-end deadline: ' + elapsed);
    assert.equal(host.dead, true);
    return elapsed;
  } finally {
    host.abort();
    await childExited(child);
  }
}
async function workerInterrupt() {
  const host = makeHost(10000);
  const child = host.process;
  const worker = host.loadWorker;
  const exited = new Promise(resolve => worker.once('exit', resolve));
  try {
    const request = host.requestAsync('load-file', 1, 1, {});
    const verified = assert.rejects(request, { code: 'ELECTRON_MBT_TRANSPORT_CLOSED' });
    await delay(230);
    const started = process.hrtime.bigint();
    host.abort();
    await verified;
    await Promise.race([
      exited,
      delay(1200).then(() => { throw new Error('Blocked native Worker did not wake on shutdown'); }),
    ]);
    const elapsed = Number((process.hrtime.bigint() - started) / 1000000n);
    assert.ok(elapsed < 1200, 'Worker remained pinned to long native poll: ' + elapsed);
    assert.equal(host.loadFd, null);
    return elapsed;
  } finally {
    host.abort();
    await childExited(child);
  }
}
async function main() {
  const queueMs = await queueDeadline();
  const wakeMs = await workerInterrupt();
  console.log(JSON.stringify({
    probe: 'm1-native-worker-deadlines', status: 'PASS',
    queuedLoads: 4, queueDeadlineIncluded: true,
    workerWokenBeforeOriginalWatchdog: true, fdReleasedAfterWorkerExit: true,
    queueMs, wakeMs, compatible: false,
  }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
