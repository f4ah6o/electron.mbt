'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-supervisor-retry-'));
const counter = path.join(temp, 'counter');
const wrapper = path.join(temp, 'flaky-host.sh');
const host = path.join(root, 'dist/electron-mbt-native-host');
fs.writeFileSync(wrapper, `#!/bin/sh
n=$(cat "$ELECTRON_MBT_SUPERVISOR_TEST_COUNTER" 2>/dev/null || echo 0)
n=$((n+1))
echo "$n" > "$ELECTRON_MBT_SUPERVISOR_TEST_COUNTER"
if [ "$n" -le 1 ]; then exit 1; fi
exec "${host}" "$@"
`, { mode: 0o755 });
try {
  const result = spawnSync('moon', ['run', '--target', 'native', 'native/supervisor'], {
    cwd: root, encoding: 'utf8', timeout: 90000,
    env: {
      ...process.env,
      ELECTRON_MBT_SUPERVISOR_BINARY: wrapper,
      ELECTRON_MBT_SUPERVISOR_TEST_COUNTER: counter,
    },
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n').map(line => line.trim()).filter(Boolean);
  const report = lines.filter(line => line.startsWith('{') && line.endsWith('}')).at(-1);
  let parsed;
  try { parsed = JSON.parse(report); } catch {
    throw new Error(`no JSON report\n${result.stdout}\n${result.stderr}`);
  }
  const attempts = Number(fs.readFileSync(counter, 'utf8').trim());
  const ok = result.status === 0 && parsed.status === 'PASS' && parsed.attempts === 2 &&
    attempts >= 2 && parsed.restarts === 1 && parsed.secondExitStatus === 0;
  if (!ok) throw new Error(`unexpected retry result ${JSON.stringify(parsed)} spawns=${attempts} status=${result.status}`);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', probe: 'native-supervisor-retry', attempts: parsed.attempts, spawns: attempts, compatible: false })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(path.join(root, 'fixtures/native-app/broker-output.txt'), { force: true });
  fs.rmSync(path.join(root, 'fixtures/native-app/broker-save-as.txt'), { force: true });
}
