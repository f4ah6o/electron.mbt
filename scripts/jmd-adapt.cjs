'use strict';
// Build the pinned jmd stage for the adapted profile. The only source edits
// are the JMD_SMOKE dev hook (a computed require the static CJS loader refuses)
// and bypassCSP (not supported by the adapted protocol admission). Both are
// recorded with before/after hashes; the upstream checkout is not modified.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('./source-manifest.cjs');

const root = path.resolve(__dirname, '..');
const source = path.resolve(process.env.JMD_SOURCE || path.join(root, '_build/jmd-positive-src'));
const stage = path.resolve(process.env.JMD_STAGE || path.join(root, '_build/jmd-positive-stage'));
const documentDir = path.resolve(process.env.JMD_DOC_DIR || path.join(root, '_build/jmd-positive-doc'));
const reportPath = path.join(root, 'compatibility/reports/jmd-positive-adaptation.json');
const revision = 'f875fc616feb89ea803a0fc140ec770a2ade041e';

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fail(message) {
  console.error(`ELECTRON_MBT_JMD_ADAPT: ${message}`);
  process.exit(1);
}

function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) fail(`${label}: expected exactly one match, found ${count}`);
  return text.replace(before, after);
}

function copyFile(relative) {
  const from = path.join(source, relative);
  const to = path.join(stage, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyTree(relative) {
  const from = path.join(source, relative);
  const to = path.join(stage, relative);
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) copyTree(child);
    else if (entry.isFile()) copyFile(child);
  }
}

if (!fs.existsSync(path.join(source, 'electron/main.js'))) fail(`missing pinned source at ${source}`);
const head = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
if (head.status !== 0 || head.stdout.trim() !== revision) fail(`source is not pinned ${revision}`);

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(documentDir, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(documentDir, { recursive: true });

for (const file of ['package.json', 'electron/main.js', 'electron/updater.js', 'electron/preload.js']) {
  copyFile(file);
}
copyTree('dist');
if (fs.existsSync(path.join(source, 'build/icon.png'))) copyFile('build/icon.png');

const mainPath = path.join(stage, 'electron/main.js');
const originalMain = fs.readFileSync(mainPath, 'utf8');
const smokeBefore = `  // Development affordance: run a script against the freshly created window
  // (used by \`npm run smoke\` to drive the UI and capture screenshots).
  if (process.env.JMD_SMOKE) {
    require(path.resolve(process.env.JMD_SMOKE))(first, { app });
  }

`;
const smokeAfter = `  // Adapted profile: the JMD_SMOKE dev hook was removed because the static
  // CJS loader rejects the computed require. See compatibility/apps/jmd-v0.2.3.

`;
const privilegesBefore = `  { scheme: 'jmd-file', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },`;
const privilegesAfter = `  { scheme: 'jmd-file', privileges: { standard: true, secure: true, supportFetchAPI: true } },`;
const hookBefore = `  if (canceled || !filePaths.length) return;
  openPath(filePaths[0]);
}

async function openPath(filePath) {`;
const hookAfter = `  if (canceled || !filePaths.length) return;
  openPath(filePaths[0]);
}

// Adapted-profile test hook: let the CLI drive the real open dialog and probe
// the screen/message-box facades from the trusted main realm.
ipcMain.handle('test:open-dialog', async () => {
  await openFileDialog();
  const display = screen.getDisplayNearestPoint({ x: 10, y: 10 });
  const all = screen.getAllDisplays();
  const matching = screen.getDisplayMatching({ x: 0, y: 0, width: 10, height: 10 });
  const box = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: 'jmd adapted facade probe',
  });
  return { open: true, display: display, all: all.length, matching: matching.bounds, box: box };
});

// Adapted-profile test hook: deliver the same menu:save topic the native Save
// menu item would send. The real GTK menu is installed separately; this hook
// keeps the synthetic edit/save path independent of the native menu.
ipcMain.handle('test:menu-save', () => {
  send('menu:save');
  return true;
});

async function openPath(filePath) {`;

let adaptedMain = replaceOnce(originalMain, smokeBefore, smokeAfter, 'JMD_SMOKE removal');
adaptedMain = replaceOnce(adaptedMain, privilegesBefore, privilegesAfter, 'bypassCSP removal');
adaptedMain = replaceOnce(adaptedMain, hookBefore, hookAfter, 'test open-dialog hook');
fs.writeFileSync(mainPath, adaptedMain);

const adapterSource = fs.readFileSync(path.join(root, 'fixtures/jmd-adapted/page-api.js'));
fs.mkdirSync(path.join(stage, 'adapted'), { recursive: true });
fs.writeFileSync(path.join(stage, 'adapted/page-api.js'), adapterSource);
fs.writeFileSync(path.join(stage, 'nodeless-app.json'), `${JSON.stringify({
  schema: 1,
  profile: 'electron-nodeless-adapted-v1',
  adapter: 'adapted/page-api.js',
  assetSchemes: ['jmd-file'],
}, null, 2)}\n`);

const documentPath = path.join(documentDir, 'note.md');
const marker = 'jmd-positive-marker-20261029';
fs.writeFileSync(documentPath, `# jmd positive\n\n${marker}\n\nA pinned jmd renderer opened this document through the adapted open dialog.\n\n![pixel](pixel.png)\n`);
fs.writeFileSync(path.join(documentDir, 'pixel.png'), Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGO8o6Hxn4ECwMLAwMCgfP06WZrvampCDIBxSAEwS5nIshoJjBowasDgMACeF8jNUIyUZmcAzYUMTODIg2AAAAAASUVORK5CYII=',
  'base64'));

const files = [];
(function walk(dir, base) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base);
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join('/'));
  }
})(stage, stage);
const manifest = buildSourceManifest(stage, 'dist/index.html', 'jmd', files);
writeSourceManifest(path.join(stage, 'source-manifest.json'), manifest);

const report = {
  schema: 1,
  probe: 'jmd-positive-adaptation',
  status: 'PASS',
  compatible: false,
  revision,
  source: {
    mainSHA256: hashFile(path.join(source, 'electron/main.js')),
    preloadSHA256: hashFile(path.join(source, 'electron/preload.js')),
    updaterSHA256: hashFile(path.join(source, 'electron/updater.js')),
    packageSHA256: hashFile(path.join(source, 'package.json')),
  },
  build: {
    rendererIndexSHA256: hashFile(path.join(source, 'dist/index.html')),
    source: 'dist/index.html from the pinned Vite build',
  },
  adapted: {
    mainSHA256: hashFile(mainPath),
    pageApiSHA256: hashFile(path.join(stage, 'adapted/page-api.js')),
    manifestSHA256: hashFile(path.join(stage, 'source-manifest.json')),
    files: manifest.files.length,
    stage: path.relative(root, stage),
  },
  edits: [
    {
      id: 'jmd-smoke-computed-require',
      reason: 'the static CJS graph builder rejects computed require before protocol registration',
      beforeSHA256: hashText(smokeBefore),
      afterSHA256: hashText(smokeAfter),
      before: smokeBefore,
      after: smokeAfter,
    },
    {
      id: 'jmd-file-bypassCSP',
      reason: 'the adapted protocol admission rejects bypassCSP',
      beforeSHA256: hashText(privilegesBefore),
      afterSHA256: hashText(privilegesAfter),
      before: privilegesBefore,
      after: privilegesAfter,
    },
    {
      id: 'test-open-dialog-hook',
      reason: 'CLI-only hook to drive the real open dialog and probe the screen/message-box facades in the adapted smoke test',
      beforeSHA256: hashText(hookBefore),
      afterSHA256: hashText(hookAfter),
      before: hookBefore,
      after: hookAfter,
    },
  ],
  document: { marker, path: path.relative(root, documentPath) },
  note: 'The upstream checkout is unchanged; only this staged copy is adapted. app protocol.handle is recorded, not executed.',
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'PASS',
  stage: report.adapted.stage,
  mainSHA256: report.adapted.mainSHA256,
  files: report.adapted.files,
  document: report.document.path,
}));
