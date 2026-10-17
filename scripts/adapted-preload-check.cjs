'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function check() {
  const profile = readJson('compatibility/runtime-profiles-v1.json').profiles['electron-nodeless-adapted-v1'];
  const record = readJson('compatibility/adapted-preload-v1.json');
  const manifest = readJson(record.adapter.manifest);
  const adapter = fs.readFileSync(path.join(root, record.adapter.path));
  const hash = crypto.createHash('sha256').update(adapter).digest('hex');
  const errors = [];
  if (record.schema !== 2) errors.push('record schema must be 2');
  if (record.profile !== 'electron-nodeless-adapted-v1') errors.push('profile id mismatch');
  if (record.originalPreload !== 'NOT_EXECUTED') errors.push('original preload must not execute');
  if (record.adapter.world !== 'page' || record.adapter.injection !== 'document-start') {
    errors.push('adapter must be page-world document-start');
  }
  if (hash !== record.adapter.sha256) errors.push('adapter hash mismatch');
  if (!profile.preloadMode.includes('generated-adapter')) errors.push('profile preloadMode must include generated-adapter');
  if (manifest.schema !== 2) errors.push('adapter manifest schema must be 2');
  if (!record.api || record.api.name !== manifest.name || record.api.version !== manifest.version) {
    errors.push('API name/version mismatch');
  }
  if (!Array.isArray(record.topics) || record.topics.length === 0) errors.push('topics required');
  if (!Array.isArray(record.calls) || record.calls.length === 0) errors.push('calls required');
  if (!same(record.topics, manifest.topics)) errors.push('record topics differ from adapter manifest');
  if (!same(record.calls, manifest.calls)) errors.push('record calls differ from adapter manifest');
  if (!same(record.queue, manifest.queue)) errors.push('record queue limits differ from adapter manifest');
  if (!record.queue || !Number.isInteger(record.queue.maxCalls) || record.queue.maxCalls <= 0 ||
      !Number.isInteger(record.queue.maxBytes) || record.queue.maxBytes <= 0 ||
      !Number.isInteger(record.queue.readyTimeoutMs) || record.queue.readyTimeoutMs <= 0) {
    errors.push('bounded queue limits required');
  }
  const semantics = record.semantics || {};
  if (semantics.syncContextBridge !== false || semantics.ipcRenderer !== false ||
      semantics.originalPreloadExecuted !== false) {
    errors.push('unsupported bridge semantics must stay false');
  }
  if (semantics.ingress !== 'ABSENT') errors.push('native ingress must be recorded as ABSENT');
  if (!record.adapter.installationObservation) errors.push('installation observation required');
  const source = adapter.toString('utf8');
  if (source.includes('contextBridge') || source.includes('ipcRenderer')) {
    errors.push('adapter must not expose contextBridge or ipcRenderer');
  }
  return {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    profile: record.profile,
    adapter: record.adapter.path,
    adapterSHA256: hash,
    originalPreload: record.originalPreload,
    topics: Array.isArray(record.topics) ? record.topics.length : 0,
    calls: Array.isArray(record.calls) ? record.calls.length : 0,
    queue: record.queue || null,
    ingress: semantics.ingress || null,
    errors,
    compatible: false,
    note: 'Fixture adapter contract only; no Moji preload, native ingress or app boot.',
  };
}
if (require.main === module) {
  const result = check();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}
module.exports = { check };
