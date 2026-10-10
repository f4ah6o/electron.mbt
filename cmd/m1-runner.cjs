'use strict';
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');
const { installElectronFacade, loadCjs } = require('../bridges/node/cjs-loader.cjs');
const { ExperimentalRuntime, attach, detach } = require('../bridges/node/runtime-session.cjs');
const { runtimeError } = require('../bridges/node/errors.cjs');

function run(appDir) {
  if (process.platform !== 'darwin') {
    throw runtimeError('ELECTRON_MBT_UNSUPPORTED_PLATFORM', 'Experimental M1 runner requires macOS');
  }
  const app = inspectApp(appDir);
  if (app.entryType !== 'commonjs' || app.nativeAddons || app.asar) {
    throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API',
      'Experimental M1 accepts only unpacked CommonJS main without native addons');
  }
  const runtime = new ExperimentalRuntime(app);
  attach(runtime);
  process.once('exit', () => { runtime.abort(); detach(runtime); });
  try {
    installElectronFacade(path.resolve(__dirname, '../bridges/node/runtime-facade.cjs'));
    loadCjs(app.entry);
    runtime.start();
  } catch (error) {
    runtime.abort();
    detach(runtime);
    throw error;
  }
  return 0;
}
module.exports = { run };
