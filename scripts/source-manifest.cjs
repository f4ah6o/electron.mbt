'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 1048576;

function fail(message) { throw new Error(`ELECTRON_MBT_SOURCE_MANIFEST: ${message}`); }

function buildSourceManifest(root, entry, app) {
  if (typeof root !== 'string' || root.length === 0) fail('root is required');
  if (typeof entry !== 'string' || entry.length === 0 || entry.length > 256 ||
      path.isAbsolute(entry) || entry.split('/').includes('..')) {
    fail('invalid entry');
  }
  const canonicalRoot = fs.realpathSync(root);
  if (!fs.statSync(canonicalRoot).isDirectory()) fail('root must be a directory');
  const requested = path.resolve(canonicalRoot, entry);
  let canonical;
  try {
    canonical = fs.realpathSync(requested);
  } catch {
    fail('entry does not exist');
  }
  if (!canonical.startsWith(canonicalRoot + path.sep)) fail('entry escapes root');
  const stat = fs.statSync(canonical);
  if (!stat.isFile()) fail('entry must be a regular file');
  if (stat.size <= 0 || stat.size > MAX_BYTES) fail('entry size out of bounds');
  const data = fs.readFileSync(canonical);
  if (data.length !== stat.size) fail('entry changed while reading');
  const relative = path.relative(canonicalRoot, canonical).split(path.sep).join('/');
  return {
    schema: 1,
    app: typeof app === 'string' && app.length > 0 ? app : path.basename(canonicalRoot),
    entry: relative,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
  };
}

function writeSourceManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(path.resolve(manifestPath)), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
    if (!args.root || !args.entry || !args.out) throw new Error('--root, --entry and --out are required');
    const manifest = buildSourceManifest(args.root, args.entry, args.app);
    writeSourceManifest(args.out, manifest);
    process.stdout.write(`${JSON.stringify({ ok: true, out: path.relative(process.cwd(), path.resolve(args.out)), sha256: manifest.sha256, bytes: manifest.bytes })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildSourceManifest, writeSourceManifest, MAX_BYTES };
