'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 4096;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function fail(message) { throw new Error(`ELECTRON_MBT_SOURCE_MANIFEST: ${message}`); }

function canonicalEntry(root, relative) {
  if (typeof relative !== 'string' || relative.length === 0 || relative.length > 256 ||
      path.isAbsolute(relative) || relative.split('/').includes('..')) {
    fail('invalid file path');
  }
  const requested = path.resolve(root, relative);
  let canonical;
  try {
    canonical = fs.realpathSync(requested);
  } catch {
    fail(`file does not exist: ${relative}`);
  }
  if (!canonical.startsWith(root + path.sep)) fail(`file escapes root: ${relative}`);
  const stat = fs.statSync(canonical);
  if (!stat.isFile()) fail(`file is not regular: ${relative}`);
  if (stat.size <= 0 || stat.size > MAX_BYTES) fail(`file size out of bounds: ${relative}`);
  const data = fs.readFileSync(canonical);
  if (data.length !== stat.size) fail(`file changed while reading: ${relative}`);
  return {
    path: path.relative(root, canonical).split(path.sep).join('/'),
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
  };
}

function buildSourceManifest(root, entry, app, files) {
  if (typeof root !== 'string' || root.length === 0) fail('root is required');
  const canonicalRoot = fs.realpathSync(root);
  if (!fs.statSync(canonicalRoot).isDirectory()) fail('root must be a directory');
  const requested = Array.isArray(files) && files.length > 0 ? files : [entry];
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > MAX_FILES) {
    fail('files must be a non-empty bounded array');
  }
  if (!requested.includes(entry)) fail('entry must be listed in files');
  if (new Set(requested).size !== requested.length) fail('duplicate file');
  const ordered = [entry, ...requested.filter(item => item !== entry)];
  const built = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const relative of ordered) {
    const file = canonicalEntry(canonicalRoot, relative);
    if (seen.has(file.path)) fail(`duplicate resolved file: ${relative}`);
    seen.add(file.path);
    totalBytes += file.bytes;
    if (totalBytes > MAX_TOTAL_BYTES) fail('total file bytes out of bounds');
    built.push(file);
  }
  return {
    schema: 2,
    app: typeof app === 'string' && app.length > 0 ? app : path.basename(canonicalRoot),
    entry: built[0].path,
    files: built,
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
    const files = args.files ? args.files.split(',').map(value => value.trim()).filter(Boolean) : [args.entry];
    const manifest = buildSourceManifest(args.root, args.entry, args.app, files);
    writeSourceManifest(args.out, manifest);
    process.stdout.write(`${JSON.stringify({ ok: true, out: path.relative(process.cwd(), path.resolve(args.out)), entry: manifest.entry, files: manifest.files.length, sha256: manifest.files[0].sha256 })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildSourceManifest, writeSourceManifest, MAX_BYTES, MAX_FILES, MAX_TOTAL_BYTES };
