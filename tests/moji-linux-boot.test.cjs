'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji';
const sourceMain = path.join(sourceRoot, 'out/main/main.js');
const hostBinary = path.join(root, 'dist/emoon-host');

test('the pinned Moji main and real renderer boot on the Linux native host', {
  skip: process.platform !== 'linux' ||
    !fs.existsSync(sourceMain) ||
    !fs.existsSync(hostBinary),
}, () => {
  const result = spawnSync(process.execPath, ['scripts/nodeless-moji-linux.cjs'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    env: {
      ...process.env,
      ELECTRON_MBT_MOJI_ROOT: sourceRoot,
      DISPLAY: process.env.DISPLAY || ':10.0',
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  assert.ok(lines.length > 0, 'missing moji-linux-boot report');
  const report = JSON.parse(lines.at(-1));
  assert.equal(report.status, 'PASS');
  assert.equal(report.mode, 'linux-native-boot');
  assert.equal(report.app.id, 'moji-v1.0.5');
  assert.equal(report.window.pageTitle, 'Moji v1.0.5');
  assert.equal(report.window.pageURL, 'electron-mbt-app://app/out/renderer/index.html');
  assert.equal(report.window.rendererLoaded, true);
  assert.equal(report.adapted.observed, true);
  assert.equal(report.adapted.released, true);
  assert.ok(report.adapted.requests >= 2);
  assert.equal(report.adapted.replyErrors, 0);
  assert.ok(report.adapted.ingress.admitted >= 2);
  assert.equal(report.adapted.ingress.denied, 0);
  assert.equal(report.main.error, '');
  assert.equal(report.main.hostShutdown, true);
  assert.equal(report.main.liveLeases, 0);
  assert.equal(report.main.nodeProcesses, 0);
  assert.equal(report.preloadExecuted, false);
  assert.equal(report.broker, 'NOT_IMPLEMENTED');
  assert.equal(report.humanInput, false);
  assert.equal(report.compatible, false);
  assert.ok(report.notVerified.includes('file-broker'));
  assert.ok(report.notVerified.includes('linux-native-sender-frame-authority'));
  const recorded = JSON.parse(fs.readFileSync(
    path.join(root, 'compatibility/reports/moji-linux-boot.json'), 'utf8'));
  assert.equal(recorded.status, 'PASS');
  assert.equal(recorded.compatible, false);
});
