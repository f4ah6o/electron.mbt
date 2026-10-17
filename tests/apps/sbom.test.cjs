'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildSbom, sha512Hex, purl } = require('../../scripts/app-sbom.cjs');

function closure(overrides = {}) {
  return {
    schema: 1, status: 'PASS', appId: 'fixture', name: 'fixture', version: '1.0.0',
    appFileHash: 'a'.repeat(64), packageFileHash: 'b'.repeat(64), packageLockHash: 'c'.repeat(64),
    productionPackages: [
      { path: 'node_modules/plain', name: 'plain', version: '2.0.0', optional: false, integrity: 'sha512-' + crypto.createHash('sha512').update('plain').digest('base64') },
      { path: 'node_modules/@scope/pkg', name: '@scope/pkg', version: '3.0.0', optional: true, integrity: null },
    ],
    ...overrides,
  };
}

test('CycloneDX SBOM includes sorted components, purls and SHA-512 hashes', () => {
  const sbom = buildSbom(closure());
  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.equal(sbom.specVersion, '1.5');
  assert.equal(sbom.metadata.component['bom-ref'], 'app:fixture');
  assert.equal(sbom.components.length, 2);
  assert.equal(sbom.components[0].name, '@scope/pkg');
  assert.equal(sbom.components[0].purl, 'pkg:npm/%40scope%2Fpkg@3.0.0');
  assert.equal(sbom.components[0].scope, 'optional');
  assert.equal(sbom.components[1].purl, 'pkg:npm/plain@2.0.0');
  assert.match(sbom.components[1].hashes[0].content, /^[a-f0-9]{128}$/);
  assert.equal(sbom.metadata.properties.find(p => p.name === 'electron-mbt:appId').value, 'fixture');
});

test('SBOM rejects unsafe paths, missing versions and non-PASS closures', () => {
  assert.throws(() => buildSbom(closure({ status: 'FAIL' })), { code: 'ELECTRON_MBT_SBOM' });
  assert.throws(() => buildSbom(closure({ productionPackages: [{ path: '/abs', name: 'x', version: '1' }] })), { code: 'ELECTRON_MBT_SBOM' });
  assert.throws(() => buildSbom(closure({ productionPackages: [{ path: 'node_modules/../x', name: 'x', version: '1' }] })), { code: 'ELECTRON_MBT_SBOM' });
  assert.throws(() => buildSbom(closure({ productionPackages: [{ path: 'node_modules/x', name: 'x' }] })), { code: 'ELECTRON_MBT_SBOM' });
  assert.throws(() => buildSbom(closure({ productionPackages: [{ path: 'node_modules/x', name: 'x', version: '1' }, { path: 'node_modules/x', name: 'x', version: '2' }] })), { code: 'ELECTRON_MBT_SBOM' });
});

test('purl and integrity helpers are strict', () => {
  assert.equal(purl('left-pad', '1.0.0'), 'pkg:npm/left-pad@1.0.0');
  assert.equal(sha512Hex('sha1-abc'), null);
  assert.equal(sha512Hex('sha512-AAAA'), null);
});
