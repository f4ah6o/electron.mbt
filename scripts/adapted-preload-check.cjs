'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
function check() {
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'compatibility/runtime-profiles-v1.json'), 'utf8')).profiles['electron-nodeless-adapted-v1'];
  const record = JSON.parse(fs.readFileSync(path.join(root, 'compatibility/adapted-preload-v1.json'), 'utf8'));
  const adapter = fs.readFileSync(path.join(root, record.adapter.path));
  const hash = crypto.createHash('sha256').update(adapter).digest('hex');
  const errors = [];
  if (record.profile !== 'electron-nodeless-adapted-v1') errors.push('profile id mismatch');
  if (record.originalPreload !== 'NOT_EXECUTED') errors.push('original preload must not execute');
  if (record.adapter.world !== 'page' || record.adapter.injection !== 'document-start') errors.push('adapter must be page-world document-start');
  if (hash !== record.adapter.sha256) errors.push('adapter hash mismatch');
  if (!profile.preloadMode.includes('generated-adapter')) errors.push('profile preloadMode must include generated-adapter');
  if (!Array.isArray(record.api.methods) || record.api.methods.length === 0) errors.push('API methods required');
  return {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    profile: record.profile,
    adapter: record.adapter.path,
    adapterSHA256: hash,
    originalPreload: record.originalPreload,
    errors,
    compatible: false,
    note: 'Fixture adapter contract only; no Moji preload, IPC or app boot.',
  };
}
if (require.main === module) {
  const result = check();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
}
module.exports = { check };
