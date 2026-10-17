'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fail(message) {
  const error = new Error(message);
  error.code = 'ELECTRON_MBT_SBOM';
  throw error;
}
function sha512Hex(integrity) {
  if (typeof integrity !== 'string') return null;
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  if (!match) return null;
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length !== 64) return null;
  return bytes.toString('hex');
}
function purl(name, version) {
  const encodedName = name.startsWith('@') ? encodeURIComponent(name) : name;
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}
function safePackagePath(value) {
  return typeof value === 'string' && value.startsWith('node_modules/') &&
    !value.includes('..') && !path.isAbsolute(value) && !value.includes('\\');
}
function buildSbom(closure) {
  if (!closure || closure.schema !== 1 || closure.status !== 'PASS' || typeof closure.appId !== 'string') {
    fail('production closure must be schema 1 with PASS status and appId');
  }
  if (!Array.isArray(closure.productionPackages)) fail('productionPackages must be an array');
  const seen = new Set();
  const components = [];
  for (const pkg of closure.productionPackages) {
    if (!pkg || typeof pkg !== 'object') fail('invalid package entry');
    if (!safePackagePath(pkg.path)) fail(`unsafe package path ${pkg.path}`);
    if (typeof pkg.name !== 'string' || pkg.name.length === 0) fail('package name is required');
    if (typeof pkg.version !== 'string' || pkg.version.length === 0) fail('package version is required');
    if (seen.has(pkg.path)) fail(`duplicate package path ${pkg.path}`);
    seen.add(pkg.path);
    const hash = sha512Hex(pkg.integrity);
    const component = {
      'bom-ref': `npm:${pkg.path}`,
      type: 'library',
      name: pkg.name,
      version: pkg.version,
      purl: purl(pkg.name, pkg.version),
    };
    if (hash) component.hashes = [{ alg: 'SHA-512', content: hash }];
    if (pkg.optional === true) component.scope = 'optional';
    components.push(component);
  }
  components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));
  const properties = [
    ['electron-mbt:appId', closure.appId],
    ['electron-mbt:appFileHash', closure.appFileHash],
    ['electron-mbt:packageFileHash', closure.packageFileHash],
    ['electron-mbt:packageLockHash', closure.packageLockHash],
  ].filter(([, value]) => typeof value === 'string')
    .map(([name, value]) => ({ name, value }));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      tools: [{ type: 'application', name: 'electron-mbt-app-sbom', version: '1' }],
      component: {
        'bom-ref': `app:${closure.appId}`,
        type: 'application',
        name: closure.name || closure.appId,
        version: closure.version || '0.0.0',
      },
      properties,
    },
    components,
  };
}
function writeSbom(closurePath, outPath) {
  const closure = JSON.parse(fs.readFileSync(closurePath, 'utf8'));
  const sbom = buildSbom(closure);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(sbom, null, 2)}\n`);
  return sbom;
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`invalid argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}
if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.closure || !args.out) throw new Error('--closure and --out are required');
    const sbom = writeSbom(args.closure, args.out);
    process.stdout.write(`${JSON.stringify({ ok: true, out: path.relative(process.cwd(), path.resolve(args.out)), components: sbom.components.length })}\n`);
  } catch (error) {
    process.stderr.write(`ELECTRON_MBT_SBOM: ${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { buildSbom, writeSbom, sha512Hex, purl };
