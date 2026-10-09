'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { registerHooks, createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { runtimeError } = require('./errors.cjs');
function installElectronFacade(facadeFile) {
  if (typeof registerHooks !== 'function') throw runtimeError('ELECTRON_MBT_NODE_UNSUPPORTED', 'This loader requires Node synchronous module hooks');
  if (!path.isAbsolute(facadeFile)) throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', 'Facade must use an absolute runtime-owned path');
  const url = pathToFileURL(fs.realpathSync(facadeFile)).href;
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'electron') {
        if (!new Set(context.conditions).has('require')) throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API', 'ESM Electron imports are not in the CJS probe profile');
        return { url, shortCircuit: true };
      }
      if (specifier.startsWith('electron/')) throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API', 'Electron subpaths are not in the CJS probe profile');
      return nextResolve(specifier, context);
    },
  });
}
function loadCjs(entry) {
  return createRequire(entry)(entry);
}
module.exports = { installElectronFacade, loadCjs };
