'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const addon = require(workerData.addon);

parentPort.on('message', message => {
  try {
    const bytes = addon.request(workerData.fd, message.raw, message.timeout);
    parentPort.postMessage({ request: message.request, bytes });
  } catch (error) {
    parentPort.postMessage({
      request: message.request,
      code: error.code || 'ELECTRON_MBT_TRANSPORT_CLOSED',
      detail: error.message || 'Async native channel failed',
    });
  }
});
