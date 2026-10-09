'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const result = spawnSync('moon', ['build', '--target', 'js', '--release'], { cwd: root, stdio: 'inherit', timeout: 120000 });
if (result.error) console.error(`ELECTRON_MBT_BUILD: ${result.error.message}`);
if (result.status !== 0) process.exit(1);
const outputs = ['_build', 'target'].map(base => path.join(root, base, 'js/release/build/bridge/bridge.js')).filter(fs.existsSync);
if (outputs.length !== 1) { console.error('ELECTRON_MBT_BUILD: expected one MoonBit bridge output'); process.exit(1); }
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.copyFileSync(outputs[0], path.join(root, 'dist/core.cjs'));
