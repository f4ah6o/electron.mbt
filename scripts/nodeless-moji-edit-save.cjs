'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('./source-manifest.cjs');

const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji';
const sourceMain = path.join(sourceRoot, 'out/main/main.js');
const sourcePreload = path.join(sourceRoot, 'out/preload/preload.js');
const sourceRenderer = path.join(sourceRoot, 'out/renderer');
const sourceSample = path.join(sourceRoot, 'samples/markdown-guide.en.md');
const provenance = JSON.parse(fs.readFileSync(
  path.join(root, 'compatibility/apps/moji-v1.0.5/build-provenance.json'), 'utf8'));
const adapted = JSON.parse(fs.readFileSync(
  path.join(root, 'compatibility/apps/moji-v1.0.5/adapted-preload.json'), 'utf8'));
const adapterPath = path.join(root, adapted.adapter.path);
const reportPath = path.join(root, 'compatibility/reports/moji-nodeless-edit-save.json');
const binary = path.join(root, '_build/native/debug/build/cmd/emoon/emoon.exe');
const hostBinary = path.join(root, 'dist/emoon-host');

const documentRelative = 'documents/note.md';
const markerA = '\n<!-- electron-mbt-edit -->\n';
const markerB = '\n<!-- electron-mbt-reopen -->\n';
const initialDocument = '# ノート\n\n元の内容 🚀\n\nORIGINAL_TOKEN\n';

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function walk(directory, base) {
  const out = [];
  for (const name of fs.readdirSync(directory)) {
    const absolute = path.join(directory, name);
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) out.push(...walk(absolute, base));
    else if (stat.isFile()) out.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return out;
}
function writeReport(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, reportPath);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
function parseReport(result) {
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
    .map(line => line.trim()).filter(line => line.startsWith('{') && line.endsWith('}'));
  if (lines.length === 0) return null;
  try { return JSON.parse(lines.at(-1)); } catch { return null; }
}
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function filteredStore(report) {
  const store = report && report.grantStore ? report.grantStore : {};
  return {
    loaded: store.loaded === true,
    persisted: store.persisted === true,
    error: typeof store.error === 'string' ? store.error : '',
    files: Array.isArray(store.files)
      ? store.files.map(entry => ({ mode: entry.mode }))
      : [],
    directories: Array.isArray(store.directories) ? store.directories.length : 0,
  };
}
function summarize(report, phaseKey) {
  const block = report ? report[phaseKey] : null;
  const probe = block && block.probe ? block.probe : null;
  return {
    status: report ? report.status : 'MISSING',
    pageTitle: report ? report.pageTitle : '',
    pageURL: report ? report.pageURL : '',
    rendererLoaded: report ? report.rendererLoaded === true : false,
    preloadExecuted: report ? report.preloadExecuted === true : null,
    compatible: report ? report.compatible === true : null,
    hostShutdown: report ? report.hostShutdown === true : false,
    liveLeases: report ? report.liveLeases : null,
    nodeProcesses: report ? report.nodeProcesses : null,
    adapted: report && report.adapted ? {
      configured: report.adapted.configured === true,
      observed: report.adapted.observed === true,
      released: report.adapted.released === true,
      requests: report.adapted.requests,
      replyErrors: report.adapted.replyErrors,
      rejected: report.adapted.rejected,
      ingress: report.adapted.ingress || null,
    } : null,
    scenario: report ? report.mojiScenario || null : null,
    block: block ? {
      ok: block.ok === true,
      phase: block.phase,
      error: block.error,
      probe: probe ? {
        state: probe.state,
        code: probe.code || '',
        message: probe.message || '',
        open: probe.open === true,
        editor: probe.editor === true,
        inserted: probe.inserted === true,
        dirty: probe.dirty === true,
        saved: probe.saved === true,
        saveError: probe.saveError || '',
        editMechanism: probe.editMechanism || '',
        reopenMarkerPresent: probe.reopenMarkerPresent === true,
        saveFailure: probe.saveFailure || '',
        beforeOpenSave: probe.beforeOpenSave || '',
        siblingSave: probe.siblingSave || '',
        documentTitle: probe.documentTitle || '',
        titleAfterEdit: probe.titleAfterEdit || '',
        titleAfterSave: probe.titleAfterSave || '',
        notice: probe.notice || '',
        execCommand: probe.execCommand === true,
      } : null,
    } : null,
    grantStore: filteredStore(report),
    ingress: report && report.adapted && report.adapted.ingress
      ? report.adapted.ingress
      : null,
  };
}
function checkPhase(report, phase, expectedSaveDeniedMin) {
  requireValue(report, `${phase}: missing JSON report`);
  requireValue(report.status === 'PASS', `${phase}: runtime status ${report.status}`);
  requireValue(report.mojiScenario && report.mojiScenario.configured === true,
    `${phase}: mojiScenario is not configured`);
  requireValue(report.mojiScenario.mode === 'test-injected-open-for-edit',
    `${phase}: unexpected moji scenario mode`);
  requireValue(report.mojiScenario.grants === 0,
    `${phase}: the open-for-edit scenario must not inject grants`);
  requireValue(report.mojiScenario.dialogs === 1,
    `${phase}: the open-for-edit scenario must use one open dialog`);
  requireValue(report.mojiScenario.triggered === true,
    `${phase}: renderer edit/save was not triggered`);
  requireValue(report.mojiScenario.error === '',
    `${phase}: scenario error ${report.mojiScenario.error}`);
  const key = phase === 'edit-save' ? 'mojiEditSave' : 'mojiReopen';
  const block = report[key];
  requireValue(block && block.ok === true, `${phase}: ${key}.ok is false`);
  const probe = block.probe;
  requireValue(probe && probe.state === 'done', `${phase}: probe state is not done`);
  for (const field of ['open', 'editor', 'inserted', 'dirty', 'saved']) {
    requireValue(probe[field] === true, `${phase}: ${field} is not true`);
  }
  requireValue(probe.saveError === '', `${phase}: save error ${probe.saveError}`);
  requireValue(['execCommand-insertText', 'replace'].includes(probe.editMechanism),
    `${phase}: unknown edit mechanism ${probe.editMechanism}`);
  if (phase === 'edit-save') {
    requireValue(probe.beforeOpenSave === 'ELECTRON_MBT_FILE_DENIED',
      `${phase}: save before open must be denied`);
    requireValue(probe.siblingSave === 'ELECTRON_MBT_FILE_DENIED',
      `${phase}: sibling save must be denied`);
  } else {
    requireValue(probe.reopenMarkerPresent === true,
      `${phase}: the saved document marker was not visible after restart`);
  }
  const ingress = report.adapted && report.adapted.ingress;
  requireValue(ingress && ingress.fileSaveAdmitted === 1,
    `${phase}: expected one admitted file:save`);
  requireValue(ingress.fileSaveDenied >= expectedSaveDeniedMin,
    `${phase}: expected at least ${expectedSaveDeniedMin} denied file:save calls`);
  requireValue(typeof report.pageTitle === 'string' && report.pageTitle.includes('note.md'),
    `${phase}: document title was not the opened note`);
  requireValue(report.rendererLoaded === true, `${phase}: renderer was not loaded`);
  requireValue(report.preloadExecuted === false, `${phase}: preload must not execute`);
  requireValue(report.compatible === false, `${phase}: compatibility must stay false`);
  requireValue(report.hostShutdown === true, `${phase}: host did not shut down`);
  requireValue(report.liveLeases === 0, `${phase}: live leases remain`);
  requireValue(report.nodeProcesses === 0, `${phase}: Node process observed`);
  const store = report.grantStore;
  requireValue(store && store.loaded === true && store.persisted === true,
    `${phase}: main grant store was not loaded/persisted`);
}

let temp = null;
let fakeBin = null;
const report = {
  status: 'FAIL',
  probe: 'moji-nodeless-edit-save',
  sourceRoot,
  engine: 'quickjs-2026-06-04',
  profile: 'electron-nodeless-adapted-v1',
  strict: 'blocked',
  mainSHA256: null,
  preloadSHA256: null,
  adapterSHA256: null,
  rendererIndexSHA256: null,
  manifestSHA256: null,
  document: { path: documentRelative },
  phase1: null,
  phase2: null,
  openForEdit: null,
  mode: 'test-injected',
  humanInput: false,
  compatible: false,
  preloadExecuted: false,
  limits: [
    'test-injected open dialog; no human picker selection or overwrite confirmation',
    'synthetic DOM editing/replace; no human input, IME or accessibility interaction',
    'NSDataWritingAtomic byte equality only; metadata, ACL, hardlink and TOCTOU are NOT RUN',
    'single Node-less window; strict profile, original preload and Electron differential are NOT RUN',
  ],
  note: 'Pinned Moji renderer drives its own Open/Editor/Save controls under the adapted page API. The open dialog is test-injected and the edit is synthetic. This is not Electron compatibility or human consent.',
};

try {
  if (process.platform !== 'darwin' || !fs.existsSync(hostBinary)) {
    report.status = 'NOT_RUN';
    report.reason = 'the native host is macOS-only or dist/emoon-host is missing';
    writeReport(report);
    process.exit(0);
  }
  if (!fs.existsSync(sourceMain) || !fs.existsSync(sourcePreload) ||
      !fs.existsSync(sourceRenderer) || !fs.existsSync(sourceSample) ||
      !fs.existsSync(adapterPath)) {
    report.status = 'NOT_RUN';
    report.reason = `pinned Moji source was not found at ${sourceRoot}`;
    writeReport(report);
    process.exit(0);
  }
  report.mainSHA256 = hashFile(sourceMain);
  report.preloadSHA256 = hashFile(sourcePreload);
  report.adapterSHA256 = hashFile(adapterPath);
  requireValue(report.mainSHA256 === provenance.hashes.main,
    'Moji main hash does not match build provenance');
  requireValue(report.preloadSHA256 === provenance.hashes.preload,
    'Moji preload hash does not match build provenance');
  requireValue(report.adapterSHA256 === adapted.adapter.sha256,
    'adapted page API hash does not match its record');

  const build = spawnSync('moon', ['build', '--target', 'native', 'cmd/emoon'], {
    cwd: root, encoding: 'utf8', timeout: 180000,
  });
  requireValue(build.status === 0 && fs.existsSync(binary),
    `moon build failed\n${build.stdout}\n${build.stderr}`);

  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-edit-save-'));
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-edit-save-path-'));
  fs.mkdirSync(path.join(temp, 'out/main'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'out/preload'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'adapted'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'samples'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'documents'), { recursive: true });
  fs.cpSync(sourceRenderer, path.join(temp, 'out/renderer'), { recursive: true });
  fs.copyFileSync(sourceMain, path.join(temp, 'out/main/main.js'));
  fs.copyFileSync(sourcePreload, path.join(temp, 'out/preload/preload.js'));
  fs.copyFileSync(sourceSample, path.join(temp, 'samples/markdown-guide.en.md'));
  fs.copyFileSync(adapterPath, path.join(temp, 'adapted/page-api.js'));
  fs.writeFileSync(path.join(temp, 'package.json'),
    `${JSON.stringify({ name: 'moji', version: '1.0.5', main: 'out/main/main.js' }, null, 2)}\n`);
  fs.writeFileSync(path.join(temp, 'nodeless-app.json'),
    `${JSON.stringify({
      schema: 1,
      profile: 'electron-nodeless-adapted-v1',
      adapter: 'adapted/page-api.js',
      assetSchemes: ['moji-asset'],
    }, null, 2)}\n`);
  // Open-for-edit must come from the dialog selection, not from an injected
  // grant-file entry: grants stay empty for both phases.
  fs.writeFileSync(path.join(temp, 'nodeless-broker.json'),
    `${JSON.stringify({
      schema: 1,
      grants: [],
      dialogs: [{ kind: 'open', path: documentRelative }],
    }, null, 2)}\n`);
  const rendererFiles = walk(path.join(temp, 'out/renderer'), temp);
  const manifest = buildSourceManifest(temp, 'out/renderer/index.html', 'moji-edit-save', [
    ...rendererFiles,
    'adapted/page-api.js',
    'nodeless-app.json',
    'nodeless-broker.json',
    'package.json',
    'out/main/main.js',
    'out/preload/preload.js',
    'samples/markdown-guide.en.md',
  ]);
  writeSourceManifest(path.join(temp, 'source-manifest.json'), manifest);
  report.rendererIndexSHA256 = manifest.files.find(
    file => file.path === 'out/renderer/index.html').sha256;
  report.manifestSHA256 = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(temp, 'source-manifest.json'))).digest('hex');

  fs.writeFileSync(path.join(temp, documentRelative), initialDocument);
  const documentPath = path.join(temp, documentRelative);
  fs.chmodSync(documentPath, 0o640);
  const xattrName = 'user.electron-mbt';
  const xattrValue = 'metadata-preserved';
  const xattrSetup = spawnSync('xattr', ['-w', xattrName, xattrValue, documentPath], {
    encoding: 'utf8',
  });
  requireValue(xattrSetup.status === 0, 'could not set the test xattr');
  report.document.initialBytes = Buffer.byteLength(initialDocument);
  report.document.initialSHA256 = hashBytes(Buffer.from(initialDocument));
  report.document.metadata = {
    modeBefore: '640',
    xattrName,
    xattrBefore: xattrValue,
  };
  const documentMetadata = () => {
    const stat = fs.statSync(documentPath);
    const xattr = spawnSync('xattr', ['-p', xattrName, documentPath], { encoding: 'utf8' });
    return {
      mode: (stat.mode & 0o777).toString(8),
      xattr: xattr.status === 0 ? xattr.stdout.trim() : null,
      nlink: stat.nlink,
    };
  };

  const fakeNode = path.join(fakeBin, 'node');
  fs.writeFileSync(fakeNode, '#!/bin/sh\nexit 99\n');
  fs.chmodSync(fakeNode, 0o700);
  const env = {
    ...process.env,
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
    ELECTRON_MBT_TEST_MODE: '1',
  };
  function runPhase(flag, timeout) {
    const result = spawnSync(binary, [
      'run', temp, '--window', '--entry', 'out/main/main.js', flag,
    ], { cwd: root, encoding: 'utf8', timeout: timeout || 120000, env });
    return { result, report: parseReport(result) };
  }

  const first = runPhase('--moji-edit-save-selftest');
  report.phase1 = summarize(first.report, 'mojiEditSave');
  checkPhase(first.report, 'edit-save', 2);
  const phase1Bytes = fs.readFileSync(path.join(temp, documentRelative));
  const phase1Text = phase1Bytes.toString('utf8');
  const phase1Mechanism = first.report.mojiEditSave.probe.editMechanism;
  // The contenteditable caret sits at the end of the last text line, before a
  // trailing newline, so insertText replaces that final line break with the
  // marker's leading newline. This is still an exact, deterministic byte result.
  const appendAtLineEnd = (text, marker) =>
    text.endsWith('\n') ? `${text.slice(0, -1)}${marker}` : `${text}${marker}`;
  const expected1 = phase1Mechanism === 'replace'
    ? initialDocument.replace('ORIGINAL_TOKEN', `ORIGINAL_TOKEN${markerA}`)
    : appendAtLineEnd(initialDocument, markerA);
  if (phase1Text !== expected1) {
    report.document.phase1Actual = phase1Text;
    report.document.phase1Expected = expected1;
  }
  requireValue(phase1Text === expected1,
    'phase 1 saved bytes do not match the expected document');
  requireValue(phase1Bytes.length === Buffer.byteLength(expected1),
    'phase 1 saved byte length is wrong');
  report.document.phase1Mechanism = phase1Mechanism;
  report.document.phase1SHA256 = hashBytes(phase1Bytes);
  const metadata1 = documentMetadata();
  requireValue(metadata1.mode === '640',
    `phase 1 changed the document mode to ${metadata1.mode}`);
  requireValue(metadata1.xattr === xattrValue,
    `phase 1 lost the document xattr: ${metadata1.xattr}`);
  requireValue(metadata1.nlink === 1, 'phase 1 changed the link count');
  report.document.metadata.phase1 = metadata1;
  report.openForEdit = {
    grants: first.report.mojiScenario.grants,
    dialogs: first.report.mojiScenario.dialogs,
    beforeOpenSave: first.report.mojiEditSave.probe.beforeOpenSave,
    siblingSave: first.report.mojiEditSave.probe.siblingSave,
  };

  const second = runPhase('--moji-reopen-selftest');
  report.phase2 = summarize(second.report, 'mojiReopen');
  checkPhase(second.report, 'reopen-save', 0);
  const phase2Bytes = fs.readFileSync(path.join(temp, documentRelative));
  const phase2Text = phase2Bytes.toString('utf8');
  const phase2Mechanism = second.report.mojiReopen.probe.editMechanism;
  const expected2 = phase2Mechanism === 'replace'
    ? phase1Text.replace('ORIGINAL_TOKEN', `ORIGINAL_TOKEN${markerB}`)
    : appendAtLineEnd(phase1Text, markerB);
  requireValue(phase2Text === expected2,
    'phase 2 saved bytes do not match the expected document');
  requireValue(phase2Bytes.length === Buffer.byteLength(expected2),
    'phase 2 saved byte length is wrong');
  requireValue(phase2Text.includes('electron-mbt-edit'),
    'the first marker is missing after restart');
  const metadata2 = documentMetadata();
  requireValue(metadata2.mode === '640',
    `phase 2 changed the document mode to ${metadata2.mode}`);
  requireValue(metadata2.xattr === xattrValue,
    `phase 2 lost the document xattr: ${metadata2.xattr}`);
  requireValue(metadata2.nlink === 1, 'phase 2 changed the link count');
  report.document.metadata.phase2 = metadata2;
  report.document.phase2Mechanism = phase2Mechanism;

  // A hardlinked document must not be replaced: the other link would keep the
  // old bytes. The direct save call exercises the broker rejection without
  // relying on the app's failure UI.
  const hardlinkRelative = 'documents/note-link.md';
  const hardlinkPath = path.join(temp, hardlinkRelative);
  fs.linkSync(documentPath, hardlinkPath);
  const linkedStat = fs.statSync(documentPath);
  requireValue(linkedStat.nlink === 2, 'hardlink setup did not produce two links');
  const third = runPhase('--moji-save-failure-selftest');
  report.phase3 = summarize(third.report, 'mojiSaveFailure');
  requireValue(third.report, 'hardlink phase: missing JSON report');
  requireValue(third.report.status === 'PASS',
    `hardlink phase: runtime status ${third.report.status}`);
  const failure = third.report.mojiSaveFailure;
  requireValue(failure && failure.ok === true, 'hardlink phase: save failure check is false');
  requireValue(failure.probe && failure.probe.state === 'done',
    'hardlink phase: probe state is not done');
  requireValue(failure.probe.open === true, 'hardlink phase: document did not open');
  requireValue(failure.probe.saveFailure === 'ELECTRON_MBT_FILE_LINK',
    `hardlink phase: unexpected save result ${failure.probe.saveFailure}`);
  requireValue(failure.ingress && failure.ingress.fileSaveAdmitted === 0,
    'hardlink phase: a file:save was admitted');
  requireValue(failure.ingress.fileSaveDenied >= 1,
    'hardlink phase: file:save denial was not observed');
  requireValue(failure.ingress.lastCode === 'ELECTRON_MBT_FILE_LINK',
    `hardlink phase: last ingress code ${failure.ingress.lastCode}`);
  requireValue(third.report.hostShutdown === true, 'hardlink phase: host did not shut down');
  requireValue(third.report.liveLeases === 0, 'hardlink phase: live leases remain');
  requireValue(third.report.nodeProcesses === 0, 'hardlink phase: Node process observed');
  const noteAfterLink = fs.readFileSync(documentPath);
  const linkAfterLink = fs.readFileSync(hardlinkPath);
  requireValue(noteAfterLink.equals(phase2Bytes), 'hardlink phase changed the note bytes');
  requireValue(linkAfterLink.equals(phase2Bytes), 'hardlink phase changed the link bytes');
  const finalStat = fs.statSync(documentPath);
  const finalXattr = spawnSync('xattr', ['-p', xattrName, documentPath], { encoding: 'utf8' });
  requireValue(finalStat.nlink === 2, 'hardlink phase changed the link count');
  requireValue((finalStat.mode & 0o777) === 0o640, 'hardlink phase changed the document mode');
  requireValue(finalXattr.status === 0 && finalXattr.stdout.trim() === xattrValue,
    'hardlink phase lost the document xattr');
  report.document.hardlink = {
    path: hardlinkRelative,
    nlink: finalStat.nlink,
    saveFailure: failure.probe.saveFailure,
    noteBytes: noteAfterLink.length,
    linkBytes: linkAfterLink.length,
    unchanged: true,
  };

  report.document.finalBytes = phase2Bytes.length;
  report.document.finalSHA256 = hashBytes(phase2Bytes);

  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error && error.message ? error.message : error);
} finally {
  if (temp !== null) fs.rmSync(temp, { recursive: true, force: true });
  if (fakeBin !== null) fs.rmSync(fakeBin, { recursive: true, force: true });
}

writeReport(report);
if (report.status !== 'PASS') process.exitCode = 1;
