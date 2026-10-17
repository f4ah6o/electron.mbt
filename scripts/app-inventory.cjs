'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');
const { inspectApp, snapshot, inside } = require('../bridges/node/app-files.cjs');

const RECORD_FILES = [
  'target.json', 'inventory.json', 'symbols.json', 'adaptations.json',
  'scenarios.json', 'build-provenance.json', 'evidence-index.json',
];
const INPUT_MODES = ['original-cjs', 'prepared-js', 'ts-build'];
const PRELOAD_MODES = ['original', 'generated-adapter'];
const builtins = new Set(builtinModules);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function assertAppInputs({ appDir, appId, revision, sourceUrl, license, inputMode, preloadMode }) {
  if (!isString(appDir)) throw new Error('app directory is required');
  if (!isString(appId) || !/^[a-z0-9][a-z0-9.-]*$/i.test(appId)) throw new Error('app id is invalid');
  if (!isString(revision) || !/^[0-9a-f]{40}$/i.test(revision)) throw new Error('revision must be a 40-character commit SHA');
  if (!isString(sourceUrl)) throw new Error('source URL is required');
  if (!isString(license)) throw new Error('license is required');
  if (!INPUT_MODES.includes(inputMode)) throw new Error(`input mode must be one of ${INPUT_MODES.join('/')}`);
  if (!PRELOAD_MODES.includes(preloadMode)) throw new Error(`preload mode must be one of ${PRELOAD_MODES.join('/')}`);
}

function readSource(appRoot, relative, limit = 1048576) {
  const resolved = path.resolve(appRoot, relative);
  if (!inside(appRoot, resolved)) throw new Error(`source path escapes app root: ${relative}`);
  const real = fs.realpathSync(resolved);
  if (!inside(appRoot, real)) throw new Error(`source path escapes app root: ${relative}`);
  const info = fs.statSync(real);
  if (!info.isFile() || info.size > limit) throw new Error(`source file exceeds the scan limit: ${relative}`);
  return fs.readFileSync(real, 'utf8');
}

function scanSymbols(appRoot, inventory, inputMode) {
  const builtinImports = new Set();
  const packageImports = new Set();
  const localImports = new Set();
  const patterns = [
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s+['"]([^'"]+)['"]/g,
  ];
  const files = inventory.files.filter((file) => /\.(?:c?js|mjs|ts|tsx)$/.test(file.path));
  let scannedBytes = 0;
  for (const file of files) {
    if (scannedBytes + file.bytes > 4194304) break;
    const text = readSource(appRoot, file.path);
    scannedBytes += Buffer.byteLength(text);
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const specifier = match[1];
        if (specifier.startsWith('.') || specifier.startsWith('/')) localImports.add(specifier);
        else {
          const normalized = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
          if (builtins.has(normalized) || specifier.startsWith('node:')) builtinImports.add(specifier);
          else packageImports.add(specifier);
        }
      }
    }
  }
  return {
    schema: 1,
    status: 'source-reviewed',
    completeness: 'static-source-only',
    inputMode,
    scannedFiles: files.length,
    scannedBytes,
    builtins: [...builtinImports].sort(),
    packages: [...packageImports].sort(),
    localImports: [...localImports].sort(),
    dynamicImport: 'unknown',
    computedRequire: 'unknown',
    note: 'Static scan only. A successful scan does not prove the boot closure; build output and first-use traces are required.',
  };
}

function collectApp({ appDir, appId, revision, sourceUrl, license, inputMode, preloadMode, collectedAt }) {
  assertAppInputs({ appDir, appId, revision, sourceUrl, license, inputMode, preloadMode });
  const app = inspectApp(appDir);
  const target = {
    schema: 1,
    appId,
    sourceUrl,
    revision,
    license,
    inputMode,
    preloadMode,
    package: { name: app.name, version: app.version, main: path.relative(app.root, app.entry).split(path.sep).join('/') },
    entryType: app.entryType,
    collectedAt: collectedAt || new Date().toISOString(),
  };
  const inventory = {
    schema: 1,
    status: 'collected',
    appId,
    sourceHash: app.inventory.sha256,
    fileCount: app.inventory.files.length,
    totalBytes: app.inventory.totalBytes,
    files: app.inventory.files,
    links: app.inventory.links,
    nativeAddons: app.nativeAddons,
    asar: app.asar,
    note: 'Filesystem inventory only. It is not an atomic snapshot against an adversarial filesystem.',
  };
  const symbols = scanSymbols(app.root, app.inventory, inputMode);
  const adaptations = {
    schema: 1,
    appId,
    adaptations: [],
    declaredUnsupported: [],
    note: 'No adaptation is declared by the inventory collector. Build/boot evidence and an explicit adaptation manifest are required before adding one.',
  };
  const scenarios = {
    schema: 1,
    appId,
    status: 'not-run',
    scenarios: [],
    negativeScenarios: [],
    note: 'Scenario results are collected by the native/app lanes, not by source inventory.',
  };
  const buildProvenance = {
    schema: 1,
    appId,
    status: 'NOT_RUN',
    commands: [],
    exitCodes: [],
    hashes: {},
    note: 'No build was executed by this inventory run. Typecheck, emit and build are separate results.',
  };
  const evidenceIndex = {
    schema: 1,
    appId,
    evidence: [],
    note: 'Empty until a native/app lane records immutable evidence.',
  };
  return { 'target.json': target, 'inventory.json': inventory, 'symbols.json': symbols, 'adaptations.json': adaptations, 'scenarios.json': scenarios, 'build-provenance.json': buildProvenance, 'evidence-index.json': evidenceIndex };
}

function validateAppRecord(record) {
  const problems = [];
  for (const name of RECORD_FILES) if (!isObject(record[name])) problems.push(`${name} is not an object`);
  const target = record['target.json'];
  if (target) {
    for (const key of ['appId', 'sourceUrl', 'revision', 'license', 'inputMode', 'preloadMode']) {
      if (!isString(target[key])) problems.push(`target.${key} is missing`);
    }
    if (target.revision && !/^[0-9a-f]{40}$/i.test(target.revision)) problems.push('target.revision is not a 40-character commit SHA');
    if (target.inputMode && !INPUT_MODES.includes(target.inputMode)) problems.push('target.inputMode is invalid');
    if (target.preloadMode && !PRELOAD_MODES.includes(target.preloadMode)) problems.push('target.preloadMode is invalid');
  }
  const inventory = record['inventory.json'];
  if (inventory) {
    if (inventory.status === 'collected') {
      if (!/^[0-9a-f]{64}$/i.test(inventory.sourceHash || '')) problems.push('inventory.sourceHash is not a 64-character sha256');
      if (!Array.isArray(inventory.files)) problems.push('inventory.files is not an array');
      if (!Array.isArray(inventory.links)) problems.push('inventory.links is not an array');
    } else if (inventory.status !== 'not-collected') {
      problems.push('inventory.status is invalid');
    }
  }
  const symbols = record['symbols.json'];
  if (symbols) {
    for (const key of ['builtins', 'packages', 'localImports']) if (!isStringArray(symbols[key])) problems.push(`symbols.${key} is not a string array`);
    if (symbols.completeness !== 'static-source-only') problems.push('symbols.completeness must remain static-source-only');
  }
  const adaptations = record['adaptations.json'];
  if (adaptations) {
    if (!Array.isArray(adaptations.adaptations)) problems.push('adaptations.adaptations is not an array');
    if (!Array.isArray(adaptations.declaredUnsupported)) problems.push('adaptations.declaredUnsupported is not an array');
  }
  const scenarios = record['scenarios.json'];
  if (scenarios) {
    if (!Array.isArray(scenarios.scenarios)) problems.push('scenarios.scenarios is not an array');
    if (!Array.isArray(scenarios.negativeScenarios)) problems.push('scenarios.negativeScenarios is not an array');
  }
  const build = record['build-provenance.json'];
  if (build) {
    if (!['NOT_RUN', 'PASS', 'FAIL'].includes(build.status)) problems.push('build.status is invalid');
    if (!Array.isArray(build.commands)) problems.push('build.commands is not an array');
  }
  const evidence = record['evidence-index.json'];
  if (evidence && !Array.isArray(evidence.evidence)) problems.push('evidence-index.evidence is not an array');
  return { ok: problems.length === 0, problems };
}

function writeAppRecord(outDir, record) {
  const validation = validateAppRecord(record);
  if (!validation.ok) throw new Error(`app record is invalid: ${validation.problems.join('; ')}`);
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of RECORD_FILES) {
    fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(record[name], null, 2)}\n`);
  }
}

// Resolve an existing ancestor so /var and /private/var spellings compare
// consistently on macOS even when the output directory does not exist yet.
function canonicalForOverlap(target) {
  const suffix = [];
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    suffix.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...suffix);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || argv[i + 1] === undefined) throw new Error(`invalid argument ${arg}`);
    out[arg.slice(2)] = argv[++i];
  }
  return out;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.out) throw new Error('--out is required');
    const appRoot = fs.realpathSync(args.app);
    const outRoot = canonicalForOverlap(args.out);
    if (inside(appRoot, outRoot) || inside(outRoot, appRoot)) throw new Error('output directory must not overlap the app source');
    const record = collectApp({
      appDir: appRoot,
      appId: args.id,
      revision: args.revision,
      sourceUrl: args['source-url'],
      license: args.license,
      inputMode: args['input-mode'] || 'original-cjs',
      preloadMode: args['preload-mode'] || 'original',
      collectedAt: args['collected-at'],
    });
    writeAppRecord(outRoot, record);
    process.stdout.write(`${JSON.stringify({ ok: true, out: path.relative(process.cwd(), outRoot), sourceHash: record['inventory.json'].sourceHash, files: record['inventory.json'].fileCount })}\n`);
  } catch (error) {
    process.stderr.write(`ELECTRON_MBT_APP_INVENTORY: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { RECORD_FILES, collectApp, validateAppRecord, writeAppRecord, scanSymbols };
