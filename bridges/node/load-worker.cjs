'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const addon = require(workerData.addon);

parentPort.on('message', message => {
  try {
    // A load's watchdog starts in the caller, not after earlier queued loads
    // finish. Never issue a native request with an already expired deadline.
    const remainingNs = message.deadlineNs - process.hrtime.bigint();
    if (remainingNs <= 0n) {
      const error = new Error('Queued native load expired before dispatch');
      error.code = 'ELECTRON_MBT_TRANSPORT_TIMEOUT';
      throw error;
    }
    const remainingMs = Number((remainingNs + 999999n) / 1000000n);
    const timeout = Math.max(1, Math.min(message.timeout, remainingMs));
    const bytes = addon.request(workerData.fd, message.raw, timeout);
    parentPort.postMessage({ request: message.request, bytes });
  } catch (error) {
    parentPort.postMessage({
      request: message.request,
      code: error.code || 'ELECTRON_MBT_TRANSPORT_CLOSED',
      detail: error.message || 'Async native channel failed',
    });
  }
});
