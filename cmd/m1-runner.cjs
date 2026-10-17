'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectApp } = require('../bridges/node/app-files.cjs');
const { installElectronFacade, loadCjs } = require('../bridges/node/cjs-loader.cjs');
const { ExperimentalRuntime, attach, detach } = require('../bridges/node/context-runtime.cjs');
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
  const explicitRoot = process.env.ELECTRON_MBT_M1_USER_DATA_ROOT;
  const userDataRoot = explicitRoot ? path.resolve(explicitRoot) : fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-m1-'));
  const ownsRoot = !explicitRoot;
  const runtime = new ExperimentalRuntime(app, { userDataRoot });
  if (ownsRoot) process.once('exit', () => { try { fs.rmSync(userDataRoot, { recursive: true, force: true }); } catch {} });
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
