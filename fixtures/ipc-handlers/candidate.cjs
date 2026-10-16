'use strict';
const fs = require('node:fs');
const core = require('../../dist/core.cjs');
const { createIpcMain } = require('../../bridges/node/ipc-main.cjs');
const { channel, runScenario } = require('./scenario.cjs');
const runtime = core.new_runtime();
const ipc = createIpcMain(core, runtime, name => () => { throw new Error(`unsupported ${name}`); });
const call = op => {
  const value = JSON.parse(core.dispatch(runtime, typeof op === 'string' ? op : JSON.stringify(op)));
  if (!value.ok) throw new Error(JSON.stringify(value));
  return value;
};
// This driver is not a renderer or native attestation adapter. It exercises the
// production invocation kernel with explicit synthetic host metadata only.
call('ready');
const window = call({ op: 'window.reserve' }).window;
call({ op: 'window.confirm', window });
const generation = call({ op: 'window.navigate', window }).generation;
call({ op: 'document.activate', window, generation, host_origin: 'file:///fixture/' });
call({ op: 'grant', window, generation, channel });
const sender = { window, generation, host_origin: 'file:///fixture/', main_frame: true };
runScenario(ipc.ipcMain, (channel, args) => ipc.invoke(sender, channel, args, { testOnly: true })).then(trace => {
  const observed = {
    status: 'completed', moduleIdentity: core === require('../../dist/core.cjs'), trace,
    observation: { profile: 'invoke-handler-tiny-json-v1', scenarios: trace.length },
    versions: { node: process.versions.node }, platform: process.platform, arch: process.arch,
  };
  fs.writeSync(1, `ELECTRON_MBT_INVOKE=${JSON.stringify(observed)}\n`);
  ipc.dispose();
  call('stop');
}).catch(error => { ipc.dispose(); console.error(error); process.exitCode = 1; });
