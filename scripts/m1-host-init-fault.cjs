'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NativeHost } = require('../bridges/node/native-host.cjs');
const addon = require('../dist/sync_channel.node');

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS native fault acceptance required');
  const root = path.resolve(__dirname, '../fixtures/m1');
  const descriptors = () => fs.readdirSync('/dev/fd').length;
  const baseline = descriptors();

  let pairCalls = 0;
  assert.throws(() => new NativeHost(root, {
    testingPairFactory() {
      if (++pairCalls === 3) throw new Error('INJECTED_THIRD_PAIR_FAILURE');
      return addon.pair();
    },
  }), /INJECTED_THIRD_PAIR_FAILURE/);
  assert.equal(pairCalls, 3);
  assert.ok(descriptors() <= baseline + 1, 'partial pair failure leaked a descriptor');

  let child;
  let closed;
  assert.throws(() => new NativeHost(root, {
    testingWorkerScript: 'invalid-worker-script',
    testingOnSpawn(processHandle) {
      child = processHandle;
      closed = new Promise(resolve => child.once('close', resolve));
    },
  }), { code: 'ERR_WORKER_PATH' });
  assert.ok(child && Number.isInteger(child.pid));
  const timer = new Promise((_, reject) => setTimeout(() =>
    reject(new Error('Native child orphaned after worker constructor failure')), 4500));
  await Promise.race([closed, timer]);
  assert.ok(child.exitCode !== null || child.signalCode !== null,
    'The child must be reaped, not merely signaled');
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(descriptors() <= baseline + 1,
    'Worker constructor failure leaked parent/native descriptors');
  console.log(JSON.stringify({
    probe: 'm1-constructor-rollback', status: 'PASS',
    thirdPairFailureCleaned: true, workerConstructionFailureCleaned: true,
    childPidReaped: true, descriptorCountRecovered: true, compatible: false,
  }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
