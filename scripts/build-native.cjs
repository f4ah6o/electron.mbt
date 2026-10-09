'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const include = process.env.NODE_INCLUDE_DIR || path.resolve(path.dirname(process.execPath), '../include/node');
if (!fs.existsSync(path.join(include, 'node_api.h'))) {
  console.error('ELECTRON_MBT_NODE_HEADERS_MISSING: set NODE_INCLUDE_DIR to the matching Node include/node directory');
  process.exit(1);
}
if (!['darwin', 'linux'].includes(process.platform)) {
  console.error('ELECTRON_MBT_UNSUPPORTED_PLATFORM: the control-channel probe supports macOS/Linux only');
  process.exit(1);
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const args = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-DNODE_GYP_MODULE_NAME=sync_channel', '-I', include];
args.push(...(process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC']));
args.push(path.join(root, 'bridges/node/sync_channel.c'), '-o', path.join(root, 'dist/sync_channel.node'));
const result = spawnSync(process.env.CC || 'cc', args, { stdio: 'inherit', timeout: 120000 });
if (result.error) console.error(result.error.message);
process.exit(result.status === 0 ? 0 : 1);
