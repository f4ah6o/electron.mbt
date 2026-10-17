'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fail(message) { throw new Error(`ELECTRON_MBT_ADAPTED_ADAPTER: ${message}`); }
function validName(value) { return typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value); }
function buildAdapter(manifest) {
  if (!manifest || manifest.schema !== 1 || !validName(manifest.name) || !Array.isArray(manifest.methods)) {
    fail('expected schema 1, identifier name and methods array');
  }
  const methods = manifest.methods.map(method => {
    if (!method || !validName(method.name) || typeof method.returns !== 'string') fail('invalid method');
    return `    ${method.name}: function () { return ${JSON.stringify(method.returns)}; }`;
  });
  const source = `'use strict';
(function () {
  const api = Object.freeze({
${methods.join(',\n')}
  });
  Object.defineProperty(window, ${JSON.stringify(manifest.name)}, {
    value: api, enumerable: true, configurable: false, writable: false
  });
})();
`;
  return { source, sha256: crypto.createHash('sha256').update(source).digest('hex') };
}
function writeAdapter(manifestPath, outPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const adapter = buildAdapter(manifest);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, adapter.source);
  return adapter;
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
    if (!args.manifest || !args.out) throw new Error('--manifest and --out are required');
    const adapter = writeAdapter(args.manifest, args.out);
    process.stdout.write(`${JSON.stringify({ ok: true, out: path.relative(process.cwd(), path.resolve(args.out)), sha256: adapter.sha256 })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { buildAdapter, writeAdapter };
