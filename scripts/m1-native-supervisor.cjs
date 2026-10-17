'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const result = spawnSync('moon', ['run', '--target', 'native', 'native/supervisor'], {
  cwd: root, encoding: 'utf8', timeout: 90000,
});
if (result.error) {
  process.stderr.write(`ELECTRON_MBT_NATIVE_SUPERVISOR: ${result.error.message}\n`);
  process.exitCode = 1;
  process.exit();
}
const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n').map(line => line.trim()).filter(Boolean);
const report = lines.filter(line => line.startsWith('{') && line.endsWith('}')).at(-1);
let parsed;
try { parsed = JSON.parse(report); } catch {
  process.stderr.write(`ELECTRON_MBT_NATIVE_SUPERVISOR: no JSON report\n${result.stdout}\n${result.stderr}\n`);
  process.exitCode = 1;
  process.exit();
}
const ok = result.status === 0 && parsed.status === 'PASS' &&
  parsed.probe === 'native-supervisor-window-load' &&
  parsed.backend === 'AppKit+WKWebView' &&
  Number.isInteger(parsed.childPid) && parsed.childPid > 0 &&
  parsed.exitStatus === 0 && parsed.windowLoaded === true && parsed.event === 'isolated-preload-attested' && parsed.mainEvaluated === true && parsed.appMain === 'native-fixture' && parsed.appEntry === 'src/main.js' && parsed.appTitle === 'native-app-window' && parsed.creator === 'moonbit-native' &&
  parsed.compatible === false;
if (!ok) {
  process.stderr.write(`ELECTRON_MBT_NATIVE_SUPERVISOR: invalid report ${JSON.stringify(parsed)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify(parsed)}\n`);
}
