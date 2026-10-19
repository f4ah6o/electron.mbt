'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'fixtures/nodeless-dialog-app');
const binary = path.join(root, '_build/native/debug/build/native/nodeless/nodeless.exe');
const hostBinary = path.join(root, 'dist/electron-mbt-native-host-main-dialog-cancel-sim');
const reportPath = path.join(root, 'compatibility/reports/nodeless-dialog-ui.json');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, reportPath);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
if (process.platform !== 'darwin') {
  // Do not overwrite the committed macOS evidence with a non-macOS NOT_RUN.
  process.stdout.write(`${JSON.stringify({
    schema: 1,
    status: 'NOT_RUN',
    probe: 'nodeless-dialog-ui',
    reason: 'the native NSOpenPanel smoke requires macOS',
    compatible: false,
  })}\n`);
  process.exit(0);
}
const build = spawnSync('moon', ['build', '--target', 'native', 'native/nodeless'], {
  cwd: root, encoding: 'utf8', timeout: 180000,
});
if (build.status !== 0 || !fs.existsSync(binary)) {
  writeReport({
    schema: 1,
    status: 'FAIL',
    probe: 'nodeless-dialog-ui',
    reason: 'the Node-less binary did not build',
    compatible: false,
  });
  process.exit(1);
}
const hostBuild = spawnSync(process.execPath,
  ['scripts/build-macos-host.cjs', '--simulate-main-dialog-cancel'], {
    cwd: root, encoding: 'utf8', timeout: 120000,
  });
if (hostBuild.status !== 0 || !fs.existsSync(hostBinary)) {
  writeReport({
    schema: 1,
    status: 'FAIL',
    probe: 'nodeless-dialog-ui',
    reason: 'the auto-cancel native host did not build',
    compatible: false,
  });
  process.exit(1);
}
const run = spawnSync(binary,
  ['run', fixture, '--window', '--dialog-ui-selftest', '--entry', 'src/main.js'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      ELECTRON_MBT_TEST_MODE: '1',
      ELECTRON_MBT_TEST_NATIVE_HOST: 'dist/electron-mbt-native-host-main-dialog-cancel-sim',
    },
  });
const lines = `${run.stdout || ''}\n${run.stderr || ''}`.split('\n')
  .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
let parsed = null;
try { parsed = JSON.parse(lines.at(-1)); } catch { parsed = null; }
const dialogUI = parsed && parsed.dialogUI && typeof parsed.dialogUI === 'object'
  ? parsed.dialogUI : {};
const dialogMain = parsed && parsed.dialogSelftest && typeof parsed.dialogSelftest === 'object'
  ? parsed.dialogSelftest : {};
const saveDialogUI = parsed && parsed.saveDialogUI && typeof parsed.saveDialogUI === 'object'
  ? parsed.saveDialogUI : {};
const saveDialogMain = parsed && parsed.saveDialogSelftest &&
  typeof parsed.saveDialogSelftest === 'object' ? parsed.saveDialogSelftest : {};
const savePanelOk = saveDialogUI.opened === true &&
  saveDialogUI.completed === true && saveDialogUI.canceled === true &&
  saveDialogUI.selection === false;
const ok = run.status === 0 && parsed !== null && parsed.status === 'PASS' &&
  parsed.dialogUIOk === true && dialogUI.opened === true &&
  dialogUI.completed === true && dialogUI.canceled === true &&
  dialogUI.selection === false && dialogMain.ok === true &&
  dialogMain.canceled === true && parsed.saveDialogUIOk === true &&
  savePanelOk && saveDialogMain.ok === true && saveDialogMain.canceled === true &&
  parsed.compatible === false;
const manifestPath = path.join(fixture, 'source-manifest.json');
const mainPath = path.join(fixture, 'src/main.js');
const report = {
  schema: 1,
  status: ok ? 'PASS' : 'FAIL',
  probe: 'nodeless-dialog-ui',
  panelOpened: dialogUI.opened === true,
  panelCompleted: dialogUI.completed === true,
  panelCanceled: dialogUI.canceled === true,
  selection: dialogUI.selection === true,
  mainCanceled: dialogMain.canceled === true,
  savePanelOpened: saveDialogUI.opened === true,
  savePanelCompleted: saveDialogUI.completed === true,
  savePanelCanceled: saveDialogUI.canceled === true,
  saveSelection: saveDialogUI.selection === true,
  saveMainCanceled: saveDialogMain.canceled === true,
  compatible: false,
  testHost: path.relative(root, hostBinary).split(path.sep).join('/'),
  hostSHA256: fs.existsSync(hostBinary) ? hashFile(hostBinary) : '',
  binarySHA256: fs.existsSync(binary) ? hashFile(binary) : '',
  mainSHA256: fs.existsSync(mainPath) ? hashFile(mainPath) : '',
  manifestSHA256: fs.existsSync(manifestPath) ? hashFile(manifestPath) : '',
  note: 'Native NSOpenPanel and NSSavePanel were opened and programmatically canceled in a test-only build; no human selection, overwrite confirmation, write consent or production consent was exercised.',
};
writeReport(report);
if (!ok) process.exitCode = 1;
