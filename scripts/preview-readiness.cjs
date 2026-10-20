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
    sourceFiles.length >= 2 &&
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
    `QuickJS Main fixture dispatches ${adaptedRecord.mainDispatch?.applicationOperations?.join(',') || 'none'}; loader=${adaptedRecord.mainDispatch?.loader || 'none'}; builtins=${adaptedRecord.mainDispatch?.builtins?.join(',') || 'none'}; scenario=${adaptedRecord.mainDispatch?.appScenario || 'none'}; close=${adaptedRecord.mainDispatch?.closeRequest || 'none'}`));
  const mojiAdapted = readJson('compatibility/apps/moji-v1.0.5/adapted-preload.json');
  const mojiManifest = readJson(mojiAdapted.adapter.manifest);
  const mojiAdapterHash = require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(root, mojiAdapted.adapter.path))).digest('hex');
  const mojiApiOk = mojiAdapted.originalPreload === 'NOT_EXECUTED' &&
    mojiManifest.schema === 3 &&
    Array.isArray(mojiManifest.calls) && mojiManifest.calls.length === mojiAdapted.api.calls &&
    Array.isArray(mojiManifest.topics) && mojiManifest.topics.length === mojiAdapted.api.topics &&
    mojiAdapterHash === mojiAdapted.adapter.sha256 &&
    mojiAdapted.semantics.runtime === 'NOT_IMPLEMENTED';
  const fileBroker = adaptedRecord.fileBroker || {};
  const fileBrokerOk = fileBroker.status === 'partial' &&
    fileBroker.bounds && fileBroker.bounds.readBytes > 0 &&
    fileBroker.bounds.saveBytes > 0 && fileBroker.bounds.imageBytes > 0 &&
    fileBroker.grants && typeof fileBroker.dialogs === 'string' &&
    typeof fileBroker.export === 'string';
  checks.push(check('adapted-file-broker', fileBrokerOk ? 'PASS' : 'FAIL',
    `File broker: read=${fileBroker.bounds?.readBytes || 0}B, save=${fileBroker.bounds?.saveBytes || 0}B, image=${fileBroker.bounds?.imageBytes || 0}B, grants=${fileBroker.grants || 'none'}; dialogs=${fileBroker.dialogs || 'none'}; export=${fileBroker.export || 'none'}`));
  const dialogGrantOk = fileBroker.dialogGrants === true &&
    /test-injected/.test(fileBroker.dialogs || '');
  checks.push(check('adapted-dialog-grant', dialogGrantOk ? 'PASS' : 'FAIL',
    `Dialog grant path: ${fileBroker.dialogs || 'none'}`));
  let dialogUI = null;
  try { dialogUI = readJson('compatibility/reports/moji-dialog-ui.json'); } catch {}
  const dialogUIOk = dialogUI !== null && dialogUI.status === 'PASS' &&
    dialogUI.panelOpened === true && dialogUI.panelCompleted === true &&
    dialogUI.panelCanceled === true && dialogUI.selection === false;
  checks.push(check('adapted-dialog-ui', dialogUI === null ? 'NOT_RUN' : (dialogUIOk ? 'PASS' : 'FAIL'),
    dialogUI === null
      ? 'Native NSOpenPanel/NSSavePanel UI is compiled but not exercised'
      : `Native NSOpenPanel opened/canceled: opened=${dialogUI.panelOpened}, completed=${dialogUI.panelCompleted}, canceled=${dialogUI.panelCanceled}, selection=${dialogUI.selection}`));
  let nodelessDialogUI = null;
  try { nodelessDialogUI = readJson('compatibility/reports/nodeless-dialog-ui.json'); } catch {}
  const nodelessDialogUIOk = nodelessDialogUI !== null && nodelessDialogUI.status === 'PASS' &&
    nodelessDialogUI.panelOpened === true && nodelessDialogUI.panelCompleted === true &&
    nodelessDialogUI.panelCanceled === true && nodelessDialogUI.selection === false &&
    nodelessDialogUI.savePanelOpened === true && nodelessDialogUI.savePanelCompleted === true &&
    nodelessDialogUI.savePanelCanceled === true && nodelessDialogUI.saveSelection === false;
  checks.push(check('nodeless-main-dialog-ui',
    nodelessDialogUI === null ? 'NOT_RUN' : (nodelessDialogUIOk ? 'PASS' : 'FAIL'),
    nodelessDialogUI === null
      ? 'Node-less main open/save-panel smoke report is absent'
      : `Node-less main NSOpenPanel/NSSavePanel opened/canceled: open=${nodelessDialogUI.panelOpened}/${nodelessDialogUI.panelCanceled}, save=${nodelessDialogUI.savePanelOpened}/${nodelessDialogUI.savePanelCanceled}, selection=${nodelessDialogUI.selection || nodelessDialogUI.saveSelection}; test-injected write grants are separate evidence; human save selection and overwrite confirmation remain NOT RUN`));
  const exportMark = fileBroker.export || '';
  checks.push(check('adapted-export-html', /test-injected HTML/.test(exportMark) ? 'PASS' : 'FAIL',
    `Export HTML: ${exportMark || 'none'}`));
  checks.push(check('adapted-export-png', /diagram PNG/.test(exportMark) ? 'PASS' : 'FAIL',
    `Export diagram PNG: ${exportMark || 'none'}`));
  checks.push(check('adapted-export-pdf', 'NOT_RUN',
    'PDF/PNG document rendering export is not implemented'));
  checks.push(check('adapted-moji-api', mojiApiOk ? 'PASS' : 'FAIL',
    `Moji ${mojiAdapted.appId}: calls=${mojiAdapted.api.calls}, topics=${mojiAdapted.api.topics}, unsupported=${(mojiAdapted.api.unsupported || []).join(',')}, handlers=${mojiAdapted.semantics.applicationHandlers || 'none'}, runtime=${mojiAdapted.semantics.runtime}, originalPreload=${mojiAdapted.originalPreload}`));
  checks.push(check('adapted-moji-runtime', 'NOT_RUN',
    'Node-less Moji renderer boot passes; real file/dialog/export/update behavior and the original preload remain NOT_RUN'));

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
  const mojiProvenance = readJson('compatibility/apps/moji-v1.0.5/build-provenance.json');
  const mojiHarnessHash = require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'fixtures/moji-boot/harness.js'))).digest('hex');
  let mojiBoot = null;
  try { mojiBoot = readJson('compatibility/reports/moji-boot.json'); } catch {}
  const mojiBootOk = mojiBoot !== null && mojiBoot.status === 'PASS' &&
    mojiBoot.mainEvaluated === true && mojiBoot.whenReady === true &&
    mojiBoot.windows >= 1 && mojiBoot.ipcHandlers === 14 &&
    mojiBoot.preloadPresent === true && mojiBoot.preloadExecuted === false &&
    mojiBoot.mainSHA256 === mojiProvenance.hashes.main &&
    mojiBoot.harnessSHA256 === mojiHarnessHash &&
    mojiBoot.preloadVirtualExecuted === true && mojiBoot.preloadMethods === 18 &&
    mojiBoot.handlerResults && mojiBoot.handlerResults.settingsBefore &&
    mojiBoot.handlerResults.settingsBefore.previewTheme === 'dark' &&
    mojiBoot.handlerResults.settingsSet &&
    mojiBoot.handlerResults.settingsSet.previewTheme === 'light' &&
    mojiBoot.handlerResults.settingsAfter &&
    mojiBoot.handlerResults.settingsAfter.previewTheme === 'light' &&
    mojiBoot.handlerResults.updateState &&
    mojiBoot.handlerResults.updateState.status === 'unsupported' &&
    mojiBoot.handlerResults.readSample && mojiBoot.handlerResults.readSample.ok === true;
  checks.push(check('moji-main-boot', mojiBoot === null ? 'NOT_RUN' : (mojiBootOk ? 'PASS' : 'FAIL'),
    mojiBoot === null
      ? 'Moji main boot report is absent'
      : `Moji main boot: entry=${mojiBoot.entry}, whenReady=${mojiBoot.whenReady}, windows=${mojiBoot.windows}, ipcHandlers=${mojiBoot.ipcHandlers}, handlers=${mojiBoot.handlerResults ? Object.keys(mojiBoot.handlerResults).length : 0}, preloadExecuted=${mojiBoot.preloadExecuted}, preloadVirtual=${mojiBoot.preloadVirtualExecuted}, preloadMethods=${mojiBoot.preloadMethods}, mainSHA256=${mojiBoot.mainSHA256}`));
  let mojiNative = null;
  try { mojiNative = readJson('compatibility/reports/moji-adapted-native.json'); } catch {}
  const mojiNativeAdapterHash = require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(root, mojiAdapted.adapter.path))).digest('hex');
  const mojiNativeOk = mojiNative !== null && mojiNative.status === 'PASS' &&
    mojiNative.pageLoaded === true && mojiNative.apiPresent === true &&
    mojiNative.settingsTheme === 'dark' && mojiNative.updateStatus === 'unsupported' &&
    mojiNative.mainHandlers === true && mojiNative.preloadExecuted === false &&
    mojiNative.mainSHA256 === mojiProvenance.hashes.main &&
    mojiNative.preloadSHA256 === mojiProvenance.hashes.preload &&
    mojiNative.adapterSHA256 === mojiNativeAdapterHash &&
    mojiNative.harnessSHA256 === mojiHarnessHash;
  checks.push(check('moji-adapted-native', mojiNative === null ? 'NOT_RUN' : (mojiNativeOk ? 'PASS' : 'FAIL'),
    mojiNative === null
      ? 'Moji adapted native E2E report is absent'
      : `Moji page adapter -> native ingress -> Moji handlers: page=${mojiNative.pageLoaded}, api=${mojiNative.apiPresent}, settings=${mojiNative.settingsTheme}, update=${mojiNative.updateStatus}, preloadExecuted=${mojiNative.preloadExecuted}`));
  let mojiRenderer = null;
  try { mojiRenderer = readJson('compatibility/reports/moji-renderer.json'); } catch {}
  let mojiRendererApi = {};
  try { mojiRendererApi = JSON.parse((mojiRenderer && mojiRenderer.apiProbe) || '{}'); } catch {}
  const mojiRendererApiOk = mojiRendererApi.state === 'done' &&
    mojiRendererApi.openOk === true && mojiRendererApi.saveAsOk === true &&
    mojiRendererApi.exportOk === true && mojiRendererApi.pngOk === true &&
    mojiRendererApi.pdfOk === true && mojiRendererApi.pdfLandscapeOk === true &&
    mojiRendererApi.docPngOk === true &&
    mojiRendererApi.updateCheckOk === true && mojiRendererApi.saveOk === true && mojiRendererApi.readOk === true &&
    mojiRendererApi.sampleOk === true && mojiRendererApi.settingsTheme === 'dark';
  const mojiRendererOk = mojiRenderer !== null && mojiRenderer.status === 'PASS' &&
    mojiRenderer.rendererLoaded === true && mojiRenderer.apiPresent === true &&
    mojiRenderer.rootChildren >= 1 && typeof mojiRenderer.pageText === 'string' &&
    mojiRenderer.pageText.length > 0 && mojiRenderer.preloadExecuted === false &&
    mojiRenderer.mainSHA256 === mojiProvenance.hashes.main &&
    mojiRenderer.preloadSHA256 === mojiProvenance.hashes.preload &&
    mojiRenderer.adapterSHA256 === mojiNativeAdapterHash &&
    mojiRenderer.harnessSHA256 === mojiHarnessHash && mojiRendererApiOk;
  checks.push(check('moji-renderer', mojiRenderer === null ? 'NOT_RUN' : (mojiRendererOk ? 'PASS' : 'FAIL'),
    mojiRenderer === null
      ? 'Moji renderer report is absent'
      : `Moji renderer: title=${mojiRenderer.pageTitle}, rootChildren=${mojiRenderer.rootChildren}, api=${mojiRenderer.apiPresent}, open=${mojiRendererApi.openOk}, saveAs=${mojiRendererApi.saveAsOk}, export=${mojiRendererApi.exportOk}, png=${mojiRendererApi.pngOk}, pdf=${mojiRendererApi.pdfOk}, landscape=${mojiRendererApi.pdfLandscapeOk}, docPng=${mojiRendererApi.docPngOk}, updateCheck=${mojiRendererApi.updateCheckOk}, save=${mojiRendererApi.saveOk}, read=${mojiRendererApi.readOk}, sample=${mojiRendererApi.sampleOk}, preloadExecuted=${mojiRenderer.preloadExecuted}`));
  let nodelessApp = null;
  try { nodelessApp = readJson('compatibility/reports/moji-nodeless-app.json'); } catch {}
  const nodelessAppOk = nodelessApp !== null && nodelessApp.status === 'PASS' &&
    nodelessApp.rendererLoaded === true && nodelessApp.preloadExecuted === false &&
    nodelessApp.pageURL === 'electron-mbt-app://app/out/renderer/index.html' &&
    typeof nodelessApp.pageTitle === 'string' && nodelessApp.pageTitle.includes('Moji') &&
    Number.isInteger(nodelessApp.rootChildren) && nodelessApp.rootChildren > 0 &&
    nodelessApp.apiPresent === true &&
    nodelessApp.adapted && nodelessApp.adapted.observed === true &&
    nodelessApp.adapted.released === true &&
    Number.isInteger(nodelessApp.adapted.requests) && nodelessApp.adapted.requests >= 2 &&
    nodelessApp.adapted.replyErrors === 0 &&
    nodelessApp.ingress && nodelessApp.ingress.admitted >= 2 &&
    nodelessApp.ingress.denied === 0 &&
    nodelessApp.mainSHA256 === mojiProvenance.hashes.main &&
    nodelessApp.preloadSHA256 === mojiProvenance.hashes.preload &&
    nodelessApp.adapterSHA256 === mojiNativeAdapterHash &&
    nodelessApp.mainError === '' && nodelessApp.lastRejection === '' &&
    nodelessApp.hostShutdown === true && nodelessApp.liveLeases === 0 &&
    nodelessApp.compatible === false;
  checks.push(check('nodeless-moji-app',
    nodelessApp === null || nodelessApp.status === 'NOT_RUN' ? 'NOT_RUN' :
      (nodelessAppOk ? 'PASS' : 'FAIL'),
    nodelessApp === null
      ? 'Node-less Moji renderer report is absent'
      : `Node-less Moji: status=${nodelessApp.status}, title=${nodelessApp.pageTitle}, url=${nodelessApp.pageURL}, rootChildren=${nodelessApp.rootChildren}, api=${nodelessApp.apiPresent}, requests=${nodelessApp.adapted && nodelessApp.adapted.requests}, preloadExecuted=${nodelessApp.preloadExecuted}`));
  const nodelessBroker = nodelessApp && nodelessApp.broker ? nodelessApp.broker : null;
  const nodelessApi = nodelessApp && nodelessApp.apiProbe ? nodelessApp.apiProbe : {};
  const nodelessOutputs = nodelessApp && nodelessApp.brokerOutputs ? nodelessApp.brokerOutputs : {};
  const nodelessBrokerOk = nodelessApp !== null && nodelessApp.status === 'PASS' &&
    nodelessBroker !== null && nodelessBroker.configured === true &&
    nodelessBroker.mode === 'test-injected' && nodelessBroker.grants === 1 &&
    nodelessBroker.dialogs === 6 && nodelessBroker.triggered === true &&
    nodelessBroker.error === '' && nodelessApi.state === 'done' &&
    nodelessApi.openOk === true && nodelessApi.saveAsOk === true &&
    nodelessApi.exportOk === true && nodelessApi.pngOk === true &&
    nodelessApi.pdfOk === true && nodelessApi.pdfLandscapeOk === true &&
    nodelessApi.docPngOk === true && nodelessApi.saveOk === true &&
    nodelessApi.readOk === true && nodelessApi.sampleOk === true &&
    nodelessApi.updateCheckOk === true && nodelessApi.settingsTheme === 'dark' &&
    nodelessApi.settingsSetOk === true && nodelessApi.settingsLanguage === 'ja' &&
    nodelessApp.settingsPersisted === true &&
    Object.values(nodelessOutputs).length === 6 &&
    Object.values(nodelessOutputs).every(value => value === true);
  checks.push(check('nodeless-moji-broker',
    nodelessApp === null || nodelessApp.status === 'NOT_RUN' ? 'NOT_RUN' :
      (nodelessBrokerOk ? 'PASS' : 'FAIL'),
    nodelessBroker === null
      ? 'Node-less Moji broker report is absent'
      : `Node-less broker (test-injected): grants=${nodelessBroker.grants}, dialogs=${nodelessBroker.dialogs}, triggered=${nodelessBroker.triggered}, open=${nodelessApi.openOk}, saveAs=${nodelessApi.saveAsOk}, export=${nodelessApi.exportOk}, pdf=${nodelessApi.pdfOk}, png=${nodelessApi.pngOk}, read=${nodelessApi.readOk}, sample=${nodelessApi.sampleOk}, update=${nodelessApi.updateCheckOk}, settings=${nodelessApi.settingsLanguage}, persisted=${nodelessApp.settingsPersisted}, files=${JSON.stringify(nodelessOutputs)}`));
  let mojiEditSave = null;
  try { mojiEditSave = readJson('compatibility/reports/moji-nodeless-edit-save.json'); } catch {}
  const editSavePhaseOk = (phase, deniedMinimum) => {
    const block = phase && phase.block ? phase.block : null;
    const probe = block && block.probe ? block.probe : null;
    const ingress = phase && phase.ingress ? phase.ingress : null;
    const store = phase && phase.grantStore ? phase.grantStore : null;
    return phase !== null && phase.status === 'PASS' && block !== null && block.ok === true &&
      probe !== null && probe.state === 'done' && probe.open === true &&
      probe.editor === true && probe.inserted === true && probe.dirty === true &&
      probe.saved === true && probe.saveError === '' &&
      ['execCommand-insertText', 'replace'].includes(probe.editMechanism) &&
      ingress !== null && ingress.fileSaveAdmitted === 1 &&
      ingress.fileSaveDenied >= deniedMinimum &&
      store !== null && store.loaded === true && store.persisted === true &&
      phase.preloadExecuted === false && phase.hostShutdown === true &&
      phase.liveLeases === 0 && phase.nodeProcesses === 0 &&
      typeof phase.pageTitle === 'string' && phase.pageTitle.includes('note.md');
  };
  const editSaveOk = mojiEditSave !== null && mojiEditSave.status === 'PASS' &&
    mojiEditSave.mode === 'test-injected' && mojiEditSave.humanInput === false &&
    mojiEditSave.preloadExecuted === false && mojiEditSave.compatible === false &&
    mojiEditSave.openForEdit && mojiEditSave.openForEdit.grants === 0 &&
    mojiEditSave.openForEdit.dialogs === 1 &&
    mojiEditSave.openForEdit.beforeOpenSave === 'ELECTRON_MBT_FILE_DENIED' &&
    mojiEditSave.openForEdit.siblingSave === 'ELECTRON_MBT_FILE_DENIED' &&
    editSavePhaseOk(mojiEditSave.phase1, 2) &&
    editSavePhaseOk(mojiEditSave.phase2, 0) &&
    mojiEditSave.phase2.block.probe.reopenMarkerPresent === true &&
    mojiEditSave.phase3 && mojiEditSave.phase3.status === 'PASS' &&
    mojiEditSave.phase3.block && mojiEditSave.phase3.block.ok === true &&
    mojiEditSave.phase3.block.probe.open === true &&
    mojiEditSave.phase3.block.probe.saveFailure === 'ELECTRON_MBT_FILE_LINK' &&
    mojiEditSave.phase3.ingress &&
    mojiEditSave.phase3.ingress.fileSaveAdmitted === 0 &&
    mojiEditSave.phase3.ingress.fileSaveDenied >= 1 &&
    mojiEditSave.phase3.ingress.lastCode === 'ELECTRON_MBT_FILE_LINK' &&
    mojiEditSave.document && mojiEditSave.document.initialSHA256 !== mojiEditSave.document.finalSHA256 &&
    mojiEditSave.document.finalBytes > mojiEditSave.document.initialBytes;
  checks.push(check('nodeless-moji-edit-save',
    mojiEditSave === null || mojiEditSave.status === 'NOT_RUN' ? 'NOT_RUN' :
      (editSaveOk ? 'PASS' : 'FAIL'),
    mojiEditSave === null
      ? 'Moji edit/save/restart report is absent'
      : `Moji open-for-edit (test-injected, synthetic edit): status=${mojiEditSave.status}, grants=${mojiEditSave.openForEdit && mojiEditSave.openForEdit.grants}, dialogs=${mojiEditSave.openForEdit && mojiEditSave.openForEdit.dialogs}, phase1=${mojiEditSave.phase1 && mojiEditSave.phase1.block && mojiEditSave.phase1.block.probe && mojiEditSave.phase1.block.probe.editMechanism}, phase2=${mojiEditSave.phase2 && mojiEditSave.phase2.block && mojiEditSave.phase2.block.probe && mojiEditSave.phase2.block.probe.reopenMarkerPresent}, hardlink=${mojiEditSave.phase3 && mojiEditSave.phase3.block && mojiEditSave.phase3.block.probe && mojiEditSave.phase3.block.probe.saveFailure}, save1=${mojiEditSave.phase1 && mojiEditSave.phase1.ingress && mojiEditSave.phase1.ingress.fileSaveAdmitted}, save2=${mojiEditSave.phase2 && mojiEditSave.phase2.ingress && mojiEditSave.phase2.ingress.fileSaveAdmitted}, bytes=${mojiEditSave.document && mojiEditSave.document.finalBytes}, humanInput=${mojiEditSave.humanInput}`));
  checks.push(check('node-less-moji-app-main', mojiRendererOk && nodelessAppOk ? 'PASS' : 'NOT_RUN',
    mojiRendererOk && nodelessAppOk
      ? 'Moji main boots and the adapted Moji renderer loads Node-lessly; original preload NOT_EXECUTED'
      : 'Moji main boot or the real renderer is not recorded under the Node-less runtime'));
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
