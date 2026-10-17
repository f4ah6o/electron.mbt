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
  process.once('exit', () => { runtime.releaseSingleInstanceLock(); runtime.abort(); detach(runtime); });
  let failed = false;
  const reportFailure = reason => {
    if (failed) return;
    failed = true;
    const code = reason && typeof reason.code === 'string' ? reason.code : 'ELECTRON_MBT_APP_ERROR';
    const message = reason && reason.message ? String(reason.message) : String(reason);
    try { runtime.releaseSingleInstanceLock(); runtime.abort(); } catch {}
    detach(runtime);
    process.stdout.write(`${JSON.stringify({ ok: false, compatible: false, code, message })}\n`);
    process.exitCode = 1;
    process.exit(1);
  };
  process.on('unhandledRejection', reportFailure);
  process.on('uncaughtException', reportFailure);
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
