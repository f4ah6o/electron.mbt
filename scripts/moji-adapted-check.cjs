'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}
function sha256(relative) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
}
function sha256File(absolute) {
  return crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}
function check() {
  const record = readJson('compatibility/apps/moji-v1.0.5/adapted-preload.json');
  const provenance = readJson('compatibility/apps/moji-v1.0.5/build-provenance.json');
  const manifest = readJson(record.adapter.manifest);
  const adapterHash = sha256(record.adapter.path);
  const mojiRoot = process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji';
  const preloadPath = path.join(mojiRoot, record.preload.path);
  const preloadFileAvailable = fs.existsSync(preloadPath);
  const preloadHash = preloadFileAvailable ? sha256File(preloadPath) : record.preload.sha256;
  const errors = [];
  if (record.schema !== 1) errors.push('record schema must be 1');
  if (record.profile !== 'electron-nodeless-adapted-v1') errors.push('profile id mismatch');
  if (record.appId !== 'moji-v1.0.5') errors.push('app id mismatch');
  if (record.originalPreload !== 'NOT_EXECUTED') errors.push('original preload must not execute');
  if (preloadFileAvailable && preloadHash !== record.preload.sha256) {
    errors.push('pinned preload hash mismatch');
  }
  if (provenance.hashes.preload !== record.preload.sha256) {
    errors.push('preload hash differs from build provenance');
  }
  if (adapterHash !== record.adapter.sha256) errors.push('adapter hash mismatch');
  if (record.adapter.world !== 'page' || record.adapter.injection !== 'document-start') {
    errors.push('adapter must be page-world document-start');
  }
  if (manifest.schema !== 3) errors.push('Moji adapter manifest schema must be 3');
  if (manifest.name !== record.api.name || manifest.version !== record.api.version) {
    errors.push('API name/version mismatch');
  }
  if (!Array.isArray(manifest.calls) || manifest.calls.length !== record.api.calls) {
    errors.push('call count mismatch');
  }
  if (!Array.isArray(manifest.topics) || manifest.topics.length !== record.api.topics) {
    errors.push('topic count mismatch');
  }
  const unsupported = new Set((manifest.unsupported || []).map(entry => entry.name));
  for (const name of record.api.unsupported) {
    if (!unsupported.has(name)) errors.push(`missing unsupported API: ${name}`);
  }
  if (JSON.stringify(manifest.queue) !== JSON.stringify(record.queue)) {
    errors.push('queue limits mismatch');
  }
  const filePolicy = manifest.filePolicy || {};
  if (filePolicy.open !== 'open-for-edit' ||
      !Array.isArray(filePolicy.rights) ||
      !filePolicy.rights.includes('read') ||
      !filePolicy.rights.includes('replace-selected') ||
      filePolicy.write !== 'atomic-replace-v1' ||
      filePolicy.restart !== 'reauthorize') {
    errors.push('Moji adapter must record the open-for-edit file policy');
  }
  if (JSON.stringify(record.filePolicy) !== JSON.stringify(filePolicy)) {
    errors.push('file policy mismatch');
  }
  const semantics = record.semantics || {};
  if (semantics.contextBridge !== false || semantics.ipcRenderer !== false ||
      semantics.webUtils !== false || semantics.originalPreloadExecuted !== false) {
    errors.push('unsupported bridge semantics must stay false');
  }
  if (semantics.runtime !== 'NOT_IMPLEMENTED') errors.push('runtime must remain NOT_IMPLEMENTED');
  return {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    appId: record.appId,
    adapter: record.adapter.path,
    adapterSHA256: adapterHash,
    preloadSHA256: preloadHash,
    preloadFileAvailable,
    calls: manifest.calls.length,
    topics: manifest.topics.length,
    unsupported: record.api.unsupported,
    filePolicy,
    runtime: semantics.runtime,
    errors,
    compatible: false,
    note: 'Generated Moji API shape only; original preload and Moji handlers are not executed.',
  };
}
if (require.main === module) {
  const result = check();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}
module.exports = { check };
