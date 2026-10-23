'use strict';
// Node dev flow: stage with the Node reference implementation, then delegate
// preflight and execution to the native `emoon` runtime. The runtime is never
// reimplemented here.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const migrate = require('./migrate-app.cjs');

function isNodeScript(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(96);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const head = buffer.subarray(0, count).toString('utf8');
    return head.startsWith('#!') && /\bnode\b/.test(head.split('\n')[0]);
  } catch { return false; }
}
function executableNames() { return process.platform === 'win32' ? ['emoon.exe'] : ['emoon', 'emoon.exe']; }
function resolveRuntime({ runtime, appDir } = {}) {
  const root = path.resolve(__dirname, '..');
  const candidates = [];
  if (runtime) candidates.push(path.resolve(runtime));
  if (process.env.EMOON_RUNTIME) candidates.push(path.resolve(process.env.EMOON_RUNTIME));
  const bases = [
    path.join(appDir || '.', 'node_modules/electromoon/dist'),
    path.join(appDir || '.', 'node_modules/electromoon'),
    path.join(root, 'dist'),
    path.join(root, '_build/native/release/build/cmd/emoon'),
    path.join(root, '_build/native/debug/build/cmd/emoon'),
  ];
  for (const base of bases) for (const name of executableNames()) candidates.push(path.join(base, name));
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of executableNames()) candidates.push(path.join(directory, name));
  }
  for (const candidate of candidates) {
    try {
      const info = fs.lstatSync(candidate);
      if (!info.isFile() || isNodeScript(candidate)) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch { /* try next */ }
  }
  return null;
}
function resolveHost(runtime) {
  const explicit = process.env.EMOON_HOST;
  if (explicit && fs.existsSync(explicit)) return fs.realpathSync(explicit);
  const names = process.platform === 'win32' ? ['emoon-host.exe'] : ['emoon-host', 'emoon-host.exe'];
  for (const name of names) {
    const sameDirectory = path.join(path.dirname(runtime), name);
    if (fs.existsSync(sameDirectory)) return fs.realpathSync(sameDirectory);
  }
  const root = path.resolve(__dirname, '..');
  for (const name of names) {
    for (const base of [path.join(root, 'dist'), path.join(root, 'dist/native')]) {
      const candidate = path.join(base, name);
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    }
  }
  return null;
}
function delegate(runtime, argv, env) {
  const result = spawnSync(runtime, argv, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) {
    console.log(JSON.stringify({ ok: false, compatible: false, code: 'ELECTRON_MBT_NATIVE_RUNTIME', message: result.error.message }));
    return 1;
  }
  if (result.signal) {
    console.log(JSON.stringify({ ok: false, compatible: false, code: 'ELECTRON_MBT_NATIVE_RUNTIME', message: `native runtime terminated by ${result.signal}` }));
    return 1;
  }
  return result.status === null ? 1 : result.status;
}
function printMissingRuntime() {
  console.log(JSON.stringify({
    ok: false,
    compatible: false,
    code: 'ELECTRON_MBT_NATIVE_RUNTIME',
    message: 'native emoon runtime was not found; install it with `moon binstall f4ah6o/electromoon/cmd/emoon f4ah6o/electromoon/cmd/emoon-host@0.1.0`, set EMOON_RUNTIME, or build `node scripts/build-cli.cjs`',
  }));
}
function migrateArgs(options) {
  const args = ['--app-dir', options.appDir];
  if (options.config) args.push('--config', options.config);
  if (options.renderer) args.push('--renderer', options.renderer);
  for (const include of options.include || []) args.push('--include', include);
  if (options.api) args.push('--api', options.api);
  if (options.out) args.push('--out', options.out);
  if (options.force) args.push('--force');
  if (options['reset-data']) args.push('--reset-data');
  return args;
}
function parseDev(argv) {
  const options = { appDir: '.', include: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { options.appDir = arg; continue; }
    const key = arg.slice(2);
    if (key === 'no-launch' || key === 'force' || key === 'reset-data') { options[key] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      const error = new Error(`${arg} requires a value`);
      error.code = 'ELECTRON_MBT_MIGRATE_USAGE';
      throw error;
    }
    i += 1;
    if (key === 'include') options.include.push(...value.split(',').map(item => item.trim()).filter(Boolean));
    else if (key === 'app-dir') options.appDir = value;
    else options[key] = value;
  }
  return options;
}
function dev(argv) {
  const options = parseDev(argv);
  options.appDir = require('node:fs').realpathSync(options.appDir);
  const configFile = options.config ? path.resolve(options.appDir, options.config) : path.join(options.appDir, '.emoon/config.json');
  const args = migrateArgs(options);
  if (!fs.existsSync(configFile)) {
    const code = migrate.cliInit(args);
    if (code !== 0) return code;
  }
  const inspectCode = migrate.cliInspect(args);
  if (inspectCode !== 0) return inspectCode;
  const migrateCode = migrate.cliMigrate(args);
  if (migrateCode !== 0) return migrateCode;
  const workspace = path.dirname(configFile);
  const reportFile = path.join(workspace, 'migration-report.json');
  let report;
  try { report = JSON.parse(fs.readFileSync(reportFile, 'utf8')); }
  catch (error) {
    console.log(JSON.stringify({ ok: false, compatible: false, code: 'ELECTRON_MBT_MIGRATE_REPORT', message: error.message }));
    return 1;
  }
  const stage = path.resolve(options.appDir, report.stage.root);
  const runtime = resolveRuntime({ runtime: options.runtime, appDir: options.appDir });
  if (!runtime) { printMissingRuntime(); return 1; }
  const host = resolveHost(runtime);
  const env = host ? { EMOON_HOST: host } : {};
  const doctor = delegate(runtime, ['doctor', stage], env);
  if (doctor !== 0) return doctor;
  if (options['no-launch']) return 0;
  const entry = report.source && report.source.entry ? report.source.entry : null;
  const runArgs = entry ? ['run', stage, '--window', '--entry', entry] : ['run', stage, '--window'];
  return delegate(runtime, runArgs, env);
}
function delegateCommand(argv) {
  const command = argv[0];
  const rest = argv.slice(1);
  let runtimeFlag = null;
  let target = null;
  const pass = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--runtime' && i + 1 < rest.length) { runtimeFlag = rest[i + 1]; i += 1; continue; }
    if (!arg.startsWith('-') && target === null) { target = arg; continue; }
    pass.push(arg);
  }
  const appDir = process.cwd();
  const runtime = resolveRuntime({ runtime: runtimeFlag, appDir });
  if (!runtime) { printMissingRuntime(); return 1; }
  const stage = target ? path.resolve(target) : path.join(appDir, '.emoon/app');
  const host = resolveHost(runtime);
  const args = [command, stage, ...pass];
  if (command === 'run' && !pass.includes('--entry')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
      if (typeof pkg.main === 'string' && pkg.main.length > 0) args.push('--entry', pkg.main);
    } catch { /* the native runtime will report the missing package.json */ }
  }
  return delegate(runtime, args, host ? { EMOON_HOST: host } : {});
}
module.exports = { dev, delegateCommand, resolveRuntime, resolveHost, delegate, parseDev };
