'use strict';
// Node reference implementation of the Electromoon developer commands.
// The native `emoon` CLI mirrors this contract; the JS output is the oracle.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectApp, inside } = require('../bridges/node/app-files.cjs');
const { scanSymbols } = require('./app-inventory.cjs');
const { buildSourceManifest } = require('./source-manifest.cjs');
const { buildAdapter } = require('./adapted-adapter.cjs');

const WORKSPACE = '.emoon';
const LIMITS = Object.freeze({
  files: 4096,
  totalBytes: 64 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  scanBytes: 4 * 1024 * 1024,
});
const RENDERER_CANDIDATES = ['out/renderer', 'dist/renderer', 'build/renderer'];
const INSPECT_SKIP = ['.git', '.emoon', 'node_modules'];

function codeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function fail(code, message) { throw codeError(code, message); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function readJson(file, limit = 16 * 1024 * 1024) {
  let text;
  try {
    const info = fs.lstatSync(file);
    if (info.isSymbolicLink()) fail('ELECTRON_MBT_MIGRATE_SYMLINK', `symlink is not admitted: ${file}`);
    if (!info.isFile()) fail('ELECTRON_MBT_MIGRATE_IO', `not a regular file: ${file}`);
    if (info.size > limit) fail('ELECTRON_MBT_MIGRATE_LIMIT', `file exceeds its read limit: ${file}`);
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code && String(error.code).startsWith('ELECTRON_MBT_')) throw error;
    fail('ELECTRON_MBT_MIGRATE_IO', `cannot read ${file}: ${error.message}`);
  }
  try { return JSON.parse(text); }
  catch { fail('ELECTRON_MBT_MIGRATE_JSON', `invalid JSON: ${file}`); }
}
function writeJsonAtomic(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch (error) { fail('ELECTRON_MBT_MIGRATE_IO', `cannot write ${file}: ${error.message}`); }
}
function parseArgs(argv) {
  const result = { appDir: '.', positional: [], include: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { result.positional.push(arg); continue; }
    const key = arg.slice(2);
    if (key === 'force' || key === 'reset-data' || key === 'dry-run' || key === 'json' || key === 'help' || key === 'no-launch') {
      result[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail('ELECTRON_MBT_MIGRATE_USAGE', `${arg} requires a value`);
    i += 1;
    if (key === 'include') result.include.push(...value.split(',').map(item => item.trim()).filter(Boolean));
    else if (key === 'app-dir') result.appDir = value;
    else result[key] = value;
  }
  if (result.positional.length > 1) fail('ELECTRON_MBT_MIGRATE_USAGE', 'only one app directory is accepted');
  if (result.positional.length === 1) result.appDir = result.positional[0];
  return result;
}
function normalizeRelative(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) fail('ELECTRON_MBT_MIGRATE_USAGE', `${label} is required`);
  if (path.isAbsolute(value) || value.split('/').includes('..') || value.split('\\').includes('..')) {
    fail('ELECTRON_MBT_PATH_ESCAPE', `${label} must be app-relative`);
  }
  return value.split(path.sep).join('/');
}
function resolveInside(root, relative, label) {
  const resolved = path.resolve(root, relative);
  if (!inside(root, resolved)) fail('ELECTRON_MBT_PATH_ESCAPE', `${label} escapes the app root`);
  return resolved;
}
function packageOf(appDir) {
  let root;
  try { root = fs.realpathSync(appDir); }
  catch { fail('ELECTRON_MBT_INVALID_APP', 'cannot resolve the app directory'); }
  if (!fs.statSync(root).isDirectory()) fail('ELECTRON_MBT_INVALID_APP', 'app root must be a directory');
  const pkg = readJson(path.join(root, 'package.json'), 65536);
  if (typeof pkg.main !== 'string' || pkg.main.length === 0 || path.isAbsolute(pkg.main)) {
    fail('ELECTRON_MBT_INVALID_APP', 'package.json main must be an app-relative path');
  }
  const main = normalizeRelative(pkg.main, 'main');
  return { root, pkg, main };
}
function detectRenderer(root) {
  for (const candidate of RENDERER_CANDIDATES) {
    const resolved = path.resolve(root, candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return candidate;
  }
  return null;
}
function stagePath(root, config, options) {
  return path.resolve(root, options.out || path.join(config.workspace, 'app'));
}
function configPath(root, options) {
  if (!options.config) return path.join(root, WORKSPACE, 'config.json');
  if (path.isAbsolute(options.config)) fail('ELECTRON_MBT_PATH_ESCAPE', '--config must be app-relative');
  const resolved = path.resolve(root, normalizeRelative(options.config, 'config'));
  if (!inside(root, resolved)) fail('ELECTRON_MBT_PATH_ESCAPE', '--config escapes the app root');
  return resolved;
}
function loadConfig(root, options) {
  const file = configPath(root, options);
  if (fs.existsSync(file)) {
    const config = readJson(file);
    if (!config || config.schema !== 1) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'unsupported .emoon/config.json schema');
    const configuredInclude = Array.isArray(config.include) ? config.include.map(value => normalizeRelative(value, 'include')) : [];
    const include = [...new Set([...configuredInclude, ...(options.include || []).map(value => normalizeRelative(value, 'include'))])];
    const api = options.api !== undefined
      ? (options.api ? normalizeRelative(options.api, 'api') : null)
      : (config.api === null || config.api === undefined ? null : normalizeRelative(config.api, 'api'));
    return {
      schema: 1,
      main: normalizeRelative(config.main, 'main'),
      renderer: options.renderer ? normalizeRelative(options.renderer, 'renderer') : normalizeRelative(config.renderer, 'renderer'),
      page: options.page
        ? normalizeRelative(options.page, 'page')
        : normalizeRelative(config.page || `${options.renderer ? normalizeRelative(options.renderer, 'renderer') : normalizeRelative(config.renderer, 'renderer')}/index.html`, 'page'),
      include,
      api,
      configFile: file,
      workspace: path.dirname(file),
    };
  }
  if (!options.renderer) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'no .emoon/config.json; run `emoon init --renderer <dir>` first');
  return {
    schema: 1,
    main: normalizeRelative(packageOf(root).main, 'main'),
    renderer: normalizeRelative(options.renderer, 'renderer'),
    page: options.page ? normalizeRelative(options.page, 'page') : `${normalizeRelative(options.renderer, 'renderer')}/index.html`,
    include: options.include || [],
    api: options.api ? normalizeRelative(options.api, 'api') : null,
    configFile: file,
    workspace: path.join(root, WORKSPACE),
  };
}
function buildOutputInfo(file, main) {
  let info;
  try { info = fs.lstatSync(file); }
  catch {
    fail('ELECTRON_MBT_MIGRATE_BUILD_MISSING',
      `package.json main "${main}" does not exist; build the app first (npm run build) or pass emoon dev --build`);
  }
  if (info.isSymbolicLink()) fail('ELECTRON_MBT_MIGRATE_SYMLINK', `symlink is not admitted: ${file}`);
  return info;
}
function ensureNotSymlink(file) {
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink()) fail('ELECTRON_MBT_MIGRATE_SYMLINK', `symlink is not admitted: ${file}`);
  return info;
}
function statConfig(file, label) {
  let info;
  try { info = fs.lstatSync(file); }
  catch { fail('ELECTRON_MBT_MIGRATE_CONFIG', `${label} does not exist: ${file}`); }
  if (info.isSymbolicLink()) fail('ELECTRON_MBT_MIGRATE_SYMLINK', `symlink is not admitted: ${file}`);
  return info;
}
function isSkippedPath(relative) {
  const parts = relative.split('/');
  return parts.includes('.git') || parts.includes('.emoon') || parts.includes('node_modules');
}
function collectTree(root, relative, out, limitState) {
  const absolute = resolveInside(root, relative, relative);
  const info = ensureNotSymlink(absolute);
  if (info.isFile()) {
    if (info.size <= 0) return;
    if (info.size > LIMITS.fileBytes) fail('ELECTRON_MBT_MIGRATE_LIMIT', `file exceeds 16 MiB: ${relative}`);
    out.add(relative);
    limitState.files += 1;
    limitState.bytes += info.size;
    if (limitState.files > LIMITS.files || limitState.bytes > LIMITS.totalBytes) fail('ELECTRON_MBT_MIGRATE_LIMIT', 'stage exceeds file or byte limits');
    return;
  }
  if (!info.isDirectory()) fail('ELECTRON_MBT_MIGRATE_TYPE', `not a regular file or directory: ${relative}`);
  for (const name of fs.readdirSync(absolute).sort()) {
    const child = `${relative}/${name}`;
    if (isSkippedPath(child)) continue;
    collectTree(root, child, out, limitState);
  }
}
function collectFiles(root, config, options) {
  const files = new Set();
  const state = { files: 0, bytes: 0 };
  files.add('package.json');
  const mainInfo = ensureNotSymlink(resolveInside(root, config.main, 'main'));
  if (!mainInfo.isFile() || mainInfo.size <= 0) fail('ELECTRON_MBT_MIGRATE_TYPE', 'main entry must be a non-empty regular file');
  files.add(config.main);
  state.files += 1;
  state.bytes += mainInfo.size;
  const pageInfo = ensureNotSymlink(resolveInside(root, config.page, 'page'));
  if (!pageInfo.isFile() || pageInfo.size <= 0) fail('ELECTRON_MBT_MIGRATE_TYPE', 'page must be a non-empty regular file');
  files.add(config.page);
  state.files += 1;
  state.bytes += pageInfo.size;
  const mainDirectory = path.dirname(config.main);
  if (mainDirectory !== '.' && mainDirectory !== '') {
    const directoryInfo = ensureNotSymlink(resolveInside(root, mainDirectory, 'main'));
    if (!directoryInfo.isDirectory()) fail('ELECTRON_MBT_MIGRATE_TYPE', 'main directory must be a directory');
    collectTree(root, mainDirectory, files, state);
  }
  collectTree(root, config.renderer, files, state);
  for (const include of config.include) collectTree(root, include, files, state);
  // A generated stage must not be admitted into itself.
  const stage = stagePath(root, config, options);
  for (const file of [...files]) {
    if (inside(stage, path.resolve(root, file))) files.delete(file);
  }
  return [...files];
}
function inspectReport(root, pkg, config, options) {
  const app = inspectApp(root, INSPECT_SKIP);
  if (app.inventory.links.length > 0) {
    fail('ELECTRON_MBT_MIGRATE_SYMLINK', `symlink is not admitted: ${app.inventory.links[0].path}`);
  }
  const stageRelative = path.relative(root, stagePath(root, config, options)).split(path.sep).join('/');
  const inventory = {
    ...app.inventory,
    files: app.inventory.files.filter(file => file.path !== stageRelative && !file.path.startsWith(`${stageRelative}/`)),
  };
  let symbols;
  try { symbols = scanSymbols(root, inventory, 'original-cjs'); }
  catch (error) { fail('ELECTRON_MBT_MIGRATE_SCAN', error.message); }
  const mainPath = resolveInside(root, config.main, 'main');
  let preloadReferenced = false;
  const info = ensureNotSymlink(mainPath);
  if (info.isFile() && info.size <= 1024 * 1024) {
    preloadReferenced = /\bpreload\s*:/.test(fs.readFileSync(mainPath, 'utf8'));
  }
  const blockers = [];
  if (app.nativeAddons) blockers.push({ code: 'ELECTRON_MBT_MIGRATE_NATIVE_ADDON', message: 'native addons are not supported' });
  if (app.asar) blockers.push({ code: 'ELECTRON_MBT_MIGRATE_ASAR', message: 'ASAR archives are not supported' });
  if (app.entryType !== 'commonjs') blockers.push({ code: 'ELECTRON_MBT_MIGRATE_MODULE_TYPE', message: `entry type ${app.entryType} is not supported` });
  const tier = blockers.length > 0 ? 'blocked' : (preloadReferenced || config.api ? 'adapted' : 'plain');
  const warnings = [];
  if (preloadReferenced && !config.api) warnings.push({ code: 'WARN_PRELOAD_NOT_EXECUTED', message: 'the original preload is not executed; provide --api adapted-preload.json for an adapted build' });
  return {
    schema: 1,
    tool: { name: 'emoon', version: '0.1.0', impl: 'node' },
    command: 'inspect',
    status: 'inspected',
    compatible: false,
    claim: 'not-a-compatibility-result',
    tier,
    source: {
      appDir: root,
      packageName: typeof pkg.name === 'string' ? pkg.name : path.basename(root),
      packageVersion: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
      entry: config.main,
      page: config.page,
      renderer: config.renderer,
    },
    stage: null,
    observations: {
      entryType: app.entryType,
      nativeAddons: app.nativeAddons,
      asar: app.asar,
      preloadReferenced,
      page: config.page,
      api: config.api,
      builtins: symbols.builtins,
      packages: symbols.packages,
      localImports: symbols.localImports,
      scan: { scannedFiles: symbols.scannedFiles, scannedBytes: symbols.scannedBytes, skippedLargeFiles: symbols.skippedLargeFiles, completeness: symbols.completeness },
    },
    blockers,
    warnings,
    generated: [],
    notClaimed: ['compatibility', 'security', 'packaging', 'production consent'],
  };
}
function cliInit(argv) {
  const options = parseArgs(argv);
  const root = fs.realpathSync(options.appDir);
  if (!fs.statSync(root).isDirectory()) fail('ELECTRON_MBT_INVALID_APP', 'app root must be a directory');
  const { pkg, main } = packageOf(root);
  const mainPath = resolveInside(root, main, 'main');
  const mainInfo = buildOutputInfo(mainPath, main);
  if (!mainInfo.isFile() || mainInfo.size <= 0) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'main must be a non-empty regular file');
  const renderer = options.renderer ? normalizeRelative(options.renderer, 'renderer') : detectRenderer(root);
  if (!renderer) {
    fail('ELECTRON_MBT_MIGRATE_CONFIG',
      'could not detect a renderer directory (checked out/renderer, dist/renderer, build/renderer); build the app or pass --renderer <dir>');
  }
  const rendererPath = resolveInside(root, renderer, 'renderer');
  if (!statConfig(rendererPath, 'renderer').isDirectory()) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'renderer must be a directory');
  const page = options.page ? normalizeRelative(options.page, 'page') : `${renderer}/index.html`;
  const pagePath = resolveInside(root, page, 'page');
  const pageInfo = statConfig(pagePath, 'page');
  if (!pageInfo.isFile() || pageInfo.size <= 0) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'page must be a non-empty regular file');
  const include = (options.include || []).map(value => normalizeRelative(value, 'include'));
  for (const item of include) statConfig(resolveInside(root, item, 'include'), 'include');
  const api = options.api ? normalizeRelative(options.api, 'api') : null;
  if (api && !fs.existsSync(resolveInside(root, api, 'api'))) fail('ELECTRON_MBT_MIGRATE_CONFIG', 'api manifest does not exist');
  const file = configPath(root, options);
  let configInfo = null;
  try { configInfo = fs.lstatSync(file); } catch { configInfo = null; }
  if (configInfo && configInfo.isSymbolicLink()) fail('ELECTRON_MBT_MIGRATE_SYMLINK', `symlink is not admitted: ${file}`);
  if (configInfo && !options.force) fail('ELECTRON_MBT_MIGRATE_EXISTS', '.emoon/config.json already exists; pass --force to replace it');
  const config = { schema: 1, main, renderer, page, include, api };
  writeJsonAtomic(file, config);
  const gitignore = path.join(path.dirname(file), '.gitignore');
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, 'app/\napp.stale*/\n');
  const report = {
    schema: 1,
    tool: { name: 'emoon', version: '0.1.0', impl: 'node' },
    command: 'init',
    status: 'initialized',
    compatible: false,
    claim: 'not-a-compatibility-result',
    config: path.relative(root, file).split(path.sep).join('/'),
    source: { appDir: root, packageName: typeof pkg.name === 'string' ? pkg.name : path.basename(root), entry: main, page, renderer },
    blockers: [],
    notClaimed: ['compatibility', 'security', 'packaging'],
  };
  console.log(JSON.stringify(report));
  return 0;
}
function cliInspect(argv) {
  const options = parseArgs(argv);
  const { root, pkg } = packageOf(options.appDir);
  const config = loadConfig(root, options);
  const report = inspectReport(root, pkg, config, options);
  console.log(JSON.stringify(report));
  return report.tier === 'blocked' ? 2 : 0;
}
function copyFile(root, relative, stage) {
  const source = resolveInside(root, relative, relative);
  const info = ensureNotSymlink(source);
  if (!info.isFile() || info.size <= 0) return null;
  if (info.size > LIMITS.fileBytes) fail('ELECTRON_MBT_MIGRATE_LIMIT', `file exceeds 16 MiB: ${relative}`);
  const destination = resolveInside(stage, relative, relative);
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, info.mode & 0o777);
  } catch (error) { fail('ELECTRON_MBT_MIGRATE_IO', `cannot stage ${relative}: ${error.message}`); }
  return { path: relative, sha256: sha256(fs.readFileSync(destination)), bytes: info.size };
}
function dataPresent(stage) {
  for (const name of ['.appData', '.userData']) {
    const candidate = path.join(stage, name);
    if (fs.existsSync(candidate) && fs.readdirSync(candidate).length > 0) return true;
  }
  return false;
}
function moveStageAside(stage) {
  for (let index = 0; index < 100; index += 1) {
    const stale = `${stage}.stale${index === 0 ? '' : `-${index}`}`;
    let exists = false;
    try { fs.lstatSync(stale); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') return null; }
    if (exists) continue;
    try { fs.renameSync(stage, stale); return stale; }
    catch { return null; }
  }
  return null;
}
function prepareStage(root, config, options) {
  const stage = stagePath(root, config, options);
  if (stage === root || !inside(root, stage)) fail('ELECTRON_MBT_MIGRATE_OUT', 'stage must be inside the app root');
  if (fs.existsSync(stage)) {
    const info = fs.lstatSync(stage);
    if (info.isSymbolicLink()) fail('ELECTRON_MBT_MIGRATE_SYMLINK', 'stage is a symlink');
    if (!options.force) fail('ELECTRON_MBT_MIGRATE_EXISTS', 'stage already exists; pass --force to replace it');
    if (dataPresent(stage) && !options['reset-data']) fail('ELECTRON_MBT_MIGRATE_DATA_PRESENT', 'stage contains app data; pass --reset-data to delete it');
    try { fs.rmSync(stage, { recursive: true, force: true }); }
    catch (error) {
      const stale = moveStageAside(stage);
      if (!stale) fail('ELECTRON_MBT_MIGRATE_IO', `cannot remove or move the existing stage: ${error.message}`);
      const display = path.relative(root, stale).split(path.sep).join('/');
      console.error(`[emoon] existing stage was not removable; moved it to ${display} (remove it manually)`);
    }
  }
  try { fs.mkdirSync(stage, { recursive: true }); }
  catch (error) { fail('ELECTRON_MBT_MIGRATE_IO', `cannot create the stage: ${error.message}`); }
  return stage;
}
function cliMigrate(argv) {
  const options = parseArgs(argv);
  const { root, pkg } = packageOf(options.appDir);
  const config = loadConfig(root, options);
  const inspected = inspectReport(root, pkg, config, options);
  if (inspected.tier === 'blocked') {
    inspected.command = 'migrate';
    inspected.status = 'blocked';
    console.log(JSON.stringify(inspected));
    return 2;
  }
  const files = collectFiles(root, config, options);
  if (files.length === 0) fail('ELECTRON_MBT_MIGRATE_EMPTY', 'no files to stage');
  if (options['dry-run']) {
    const report = { ...inspected, command: 'migrate', status: 'inspected', stage: { root: path.relative(root, stagePath(root, config, options)).split(path.sep).join('/'), files: files.length, bytes: files.reduce((sum, file) => sum + fs.statSync(path.resolve(root, file)).size, 0), manifestSha256: null } };
    console.log(JSON.stringify(report));
    return 0;
  }
  const stage = prepareStage(root, config, options);
  const generated = [];
  for (const relative of files) {
    const copied = copyFile(root, relative, stage);
    if (copied) generated.push(copied);
  }
  let adapter = null;
  if (config.api) {
    if (!inside(root, path.resolve(root, config.api))) fail('ELECTRON_MBT_PATH_ESCAPE', 'api manifest escapes the app root');
    const apiManifest = readJson(resolveInside(root, config.api, 'api'));
    let built;
    try { built = buildAdapter(apiManifest); }
    catch (error) { fail('ELECTRON_MBT_MIGRATE_ADAPTER', error.message); }
    if (Buffer.byteLength(built.source) > 65536) fail('ELECTRON_MBT_MIGRATE_ADAPTER', 'generated adapter exceeds 64 KiB');
    const adapterRelative = 'adapted/page-api.js';
    fs.mkdirSync(path.join(stage, 'adapted'), { recursive: true });
    fs.writeFileSync(path.join(stage, adapterRelative), built.source);
    fs.writeFileSync(path.join(stage, 'nodeless-app.json'), `${JSON.stringify({ schema: 1, profile: 'electron-nodeless-adapted-v1', adapter: adapterRelative }, null, 2)}\n`);
    files.push(adapterRelative, 'nodeless-app.json');
    generated.push({ path: adapterRelative, sha256: sha256(built.source), bytes: Buffer.byteLength(built.source) });
    generated.push({ path: 'nodeless-app.json', sha256: sha256(fs.readFileSync(path.join(stage, 'nodeless-app.json'))), bytes: fs.statSync(path.join(stage, 'nodeless-app.json')).size });
    adapter = adapterRelative;
  }
  let manifest;
  try { manifest = buildSourceManifest(stage, config.page, typeof pkg.name === 'string' ? pkg.name : path.basename(root), files); }
  catch (error) { fail('ELECTRON_MBT_MIGRATE_MANIFEST', error.message); }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(stage, 'source-manifest.json'), manifestText);
  const manifestSha256 = sha256(manifestText);
  generated.unshift({ path: 'source-manifest.json', sha256: manifestSha256, bytes: Buffer.byteLength(manifestText) });
  const report = {
    ...inspected,
    command: 'migrate',
    status: 'staged',
    tier: config.api ? 'adapted' : 'plain',
    stage: {
      root: path.relative(root, stage).split(path.sep).join('/'),
      files: manifest.files.length,
      bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      manifestSha256,
    },
    adapted: adapter ? { adapter } : null,
    generated,
    sourceUnchanged: true,
  };
  writeJsonAtomic(path.join(config.workspace, 'migration-report.json'), report);
  console.log(JSON.stringify(report));
  return 0;
}
function main(argv) {
  const command = argv[0];
  if (command === 'init') return cliInit(argv.slice(1));
  if (command === 'inspect') return cliInspect(argv.slice(1));
  if (command === 'migrate') return cliMigrate(argv.slice(1));
  fail('ELECTRON_MBT_MIGRATE_USAGE', 'use init|inspect|migrate');
}
module.exports = { cliInit, cliInspect, cliMigrate, main, parseArgs, LIMITS, WORKSPACE };
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    console.log(JSON.stringify({ ok: false, compatible: false, code: error.code || 'ELECTRON_MBT_MIGRATE_IO', message: error.message }));
    process.exitCode = 1;
  }
}
