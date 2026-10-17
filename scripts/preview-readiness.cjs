'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}
function check(id, status, detail) {
  return { id, status, detail };
}
function buildReport() {
  const profiles = readJson('compatibility/runtime-profiles-v1.json');
  const manifest = readJson('compatibility/manifest.json');
  const apps = ['moji-v1.0.5', 'jmd-v0.2.3'];
  const closures = new Map(apps.map(id => [id, readJson(`compatibility/apps/${id}/production-closure.json`)]));
  const sboms = new Map(apps.map(id => [id, readJson(`compatibility/apps/${id}/sbom.cdx.json`)]));
  const evidence = new Map(apps.map(id => [id, readJson(`compatibility/apps/${id}/evidence-index.json`)]));
  const mojiPreload = readJson('compatibility/apps/moji-v1.0.5/preload-capabilities.json');
  const checks = [];

  const verifiedRows = [];
  for (const [id, index] of evidence) {
    for (const item of index.evidence || []) if (item.status === 'verified') verifiedRows.push(`${id}:${item.id}`);
  }
  for (const [index, row] of (manifest.rows || []).entries()) if (row.status === 'verified') verifiedRows.push(`manifest.rows[${index}]`);
  checks.push(check('no-verified-claims', verifiedRows.length === 0 ? 'PASS' : 'FAIL',
    verifiedRows.length === 0 ? 'No verified rows found' : `Verified rows: ${verifiedRows.join(', ')}`));
  checks.push(check('compatible-false', manifest.compatible === false ? 'PASS' : 'FAIL',
    `manifest.compatible=${manifest.compatible}`));

  const strict = profiles.profiles['electron-nodeless-v1'];
  const adapted = profiles.profiles['electron-nodeless-adapted-v1'];
  checks.push(check('strict-profile-blocked', strict.gate === 'blocked' && strict.compatible === false ? 'PASS' : 'FAIL',
    `electron-nodeless-v1 gate=${strict.gate} compatible=${strict.compatible}`));
  checks.push(check('adapted-profile-contract', adapted.implementation === 'partial' && adapted.preloadMode.includes('generated-adapter') ? 'PASS' : 'FAIL',
    `electron-nodeless-adapted-v1 implementation=${adapted.implementation} verification=${adapted.verification} preloadMode=${adapted.preloadMode.join(',')}`));
  const adaptedRecord = readJson('compatibility/adapted-preload-v1.json');
  const adapterSource = fs.readFileSync(path.join(root, adaptedRecord.adapter.path));
  const adapterHash = require('node:crypto').createHash('sha256').update(adapterSource).digest('hex');
  const adapterOk = adaptedRecord.profile === 'electron-nodeless-adapted-v1' &&
    adaptedRecord.originalPreload === 'NOT_EXECUTED' &&
    adaptedRecord.adapter.world === 'page' &&
    adaptedRecord.adapter.injection === 'document-start' &&
    adapterHash === adaptedRecord.adapter.sha256;
  checks.push(check('adapted-adapter-fixture', adapterOk ? 'PASS' : 'FAIL',
    `page-world document-start adapter ${adaptedRecord.adapter.path}; hash=${adapterHash}`));
  const sourceManifest = readJson('fixtures/native-app/source-manifest.json');
  const sourceFiles = Array.isArray(sourceManifest.files) ? sourceManifest.files : [];
  const sourceSnapshot = adaptedRecord.sourceSnapshot || {};
  const recordedFiles = Array.isArray(sourceSnapshot.files) ? sourceSnapshot.files : [];
  let sourceOk = sourceManifest.schema === 2 &&
    sourceManifest.entry === 'index.html' &&
    sourceFiles.length === 2 &&
    recordedFiles.length === sourceFiles.length &&
    sourceSnapshot.schema === 2 &&
    sourceSnapshot.entry === sourceManifest.entry &&
    sourceSnapshot.manifest === 'fixtures/native-app/source-manifest.json' &&
    sourceSnapshot.staging === 'private-temporary-directory';
  for (const file of sourceFiles) {
    const bytes = fs.readFileSync(path.join(root, 'fixtures/native-app', file.path));
    const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    const recorded = recordedFiles.find(item => item && item.path === file.path);
    if (!recorded || hash !== file.sha256 || bytes.length !== file.bytes ||
        recorded.sha256 !== file.sha256 || recorded.bytes !== file.bytes) {
      sourceOk = false;
    }
  }
  const sourceEntry = sourceFiles.find(file => file.path === sourceManifest.entry);
  checks.push(check('adapted-source-snapshot', sourceOk ? 'PASS' : 'FAIL',
    `private staging files=${sourceFiles.length}; entry=${sourceManifest.entry}; hash=${sourceEntry ? sourceEntry.sha256 : ''}`));
  checks.push(check('adapted-native-ingress', adaptedRecord.semantics.nativeIngress === 'test-only-selftest' ? 'PASS' : 'FAIL',
    `page-world electronMbtApp selftest=${adaptedRecord.nativeIngress?.operation || 'absent'}; queue=${adaptedRecord.nativeIngress?.queueRelease || 'absent'}; application RPC ingress=${adaptedRecord.semantics.ingress}`));
  checks.push(check('adapted-main-roundtrip', adaptedRecord.mainDispatch?.mode === 'quickjs-fixture' ? 'PASS' : 'FAIL',
    `QuickJS Main fixture dispatches ${adaptedRecord.mainDispatch?.applicationOperations?.join(',') || 'none'}; scenario=${adaptedRecord.mainDispatch?.appScenario || 'none'}`));
  checks.push(check('adapted-moji-runtime', 'NOT_RUN',
    'Fixture adapter only; Moji preload IPC, renderer ingress and app boot are not connected'));

  for (const [id, closure] of closures) {
    const closureOk = closure.status === 'PASS' && closure.nativeAddons.length === 0;
    checks.push(check(`production-closure:${id}`, closureOk ? 'PASS' : 'FAIL',
      `${closure.productionPackages.length} packages, nativeAddons=${closure.nativeAddons.length}`));
    const sbom = sboms.get(id);
    const hashCount = sbom.components.filter(component => Array.isArray(component.hashes) && component.hashes.length > 0).length;
    const sbomOk = sbom.components.length === closure.productionPackages.length && hashCount === sbom.components.length;
    checks.push(check(`sbom:${id}`, sbomOk ? 'PASS' : 'FAIL',
      `${sbom.components.length} components, ${hashCount} with SHA-512`));
  }

  checks.push(check('moji-preload-gate', mojiPreload.runtimeStatus === 'NOT_IMPLEMENTED' ? 'PASS' : 'FAIL',
    `runtimeStatus=${mojiPreload.runtimeStatus}; first blocker=${mojiPreload.m1Observation.detail}`));
  checks.push(check('moji-preload-runtime', 'FAIL',
    'functional contextBridge/ipcRenderer is not implemented'));
  const boot = readJson('compatibility/apps/moji-v1.0.5/production-closure.json').bootAttempt;
  checks.push(check('moji-m1-boot', boot.status === 'FAIL' ? 'FAIL' : 'NOT_RUN',
    boot.code ? `${boot.code}: ${boot.blocker}` : 'No boot attempt'));
  checks.push(check('supervisor-handshake', String(manifest.nativeSupervisor.result).startsWith('PASS') ? 'PASS' : 'FAIL',
    manifest.nativeSupervisor.result));
  checks.push(check('node-less-moji-app-main', 'NOT_RUN', 'Only a fixture app main is executed; Moji main is not booted'));
  checks.push(check('preview-signing', 'NOT_RUN', 'No Developer ID signing, notarization or clean-install evidence'));
  checks.push(check('clean-install', 'NOT_RUN', 'No clean machine install has been executed'));
  checks.push(check('interactive-ime-ax', 'NOT_RUN', 'No IME, focus or accessibility acceptance run'));

  const failures = checks.filter(item => item.status === 'FAIL');
  const notRun = checks.filter(item => item.status === 'NOT_RUN');
  return {
    schema: 1,
    status: failures.length > 0 ? 'NOT_READY' : (notRun.length > 0 ? 'INCOMPLETE' : 'READY'),
    compatible: false,
    gates: {
      G0: 'partial',
      G1: 'partial',
      G2: 'partial',
      G3: 'NOT_RUN',
      G4: 'partial',
    },
    counts: { checks: checks.length, pass: checks.filter(item => item.status === 'PASS').length, fail: failures.length, notRun: notRun.length },
    checks,
    note: 'Readiness validator only; PASS means an invariant or honest record passed, not app compatibility. Overall NOT_READY blocks a preview claim.',
  };
}
if (require.main === module) {
  const report = buildReport();
  const output = path.join(root, 'compatibility/reports/preview-readiness.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, status: report.status, counts: report.counts, out: path.relative(root, output) })}\n`);
  if (report.status === 'NOT_READY') process.exitCode = 2;
}
module.exports = { buildReport };
