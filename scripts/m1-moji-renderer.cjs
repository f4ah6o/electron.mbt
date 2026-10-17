'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { buildSourceManifest, writeSourceManifest } = require('./source-manifest.cjs');

const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.ELECTRON_MBT_MOJI_ROOT || '/tmp/electron-mbt-apps/moji';
const sourceMain = path.join(sourceRoot, 'out/main/main.js');
const sourcePreload = path.join(sourceRoot, 'out/preload/preload.js');
const sourceRenderer = path.join(sourceRoot, 'out/renderer');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'compatibility/apps/moji-v1.0.5/build-provenance.json'), 'utf8'));
const record = JSON.parse(fs.readFileSync(path.join(root, 'compatibility/apps/moji-v1.0.5/adapted-preload.json'), 'utf8'));
const adapterPath = path.join(root, record.adapter.path);
const harnessPath = path.join(root, 'fixtures/moji-boot/harness.js');
const reportPath = path.join(root, 'compatibility/reports/moji-renderer.json');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function walk(directory, base) {
  const out = [];
  for (const name of fs.readdirSync(directory)) {
    const absolute = path.join(directory, name);
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) out.push(...walk(absolute, base));
    else if (stat.isFile()) out.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return out;
}
function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.json' || extension === '.map') return 'application/json';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.woff') return 'font/woff';
  if (extension === '.woff2') return 'font/woff2';
  if (extension === '.ttf') return 'font/ttf';
  if (extension === '.otf') return 'font/otf';
  return 'application/octet-stream';
}
function serve(rootDirectory) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        const pathname = decodeURIComponent(url.pathname);
        if (pathname.includes('\0')) { response.writeHead(400); response.end(); return; }
        const requested = path.resolve(rootDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (requested !== rootDirectory && !requested.startsWith(`${rootDirectory}${path.sep}`)) {
          response.writeHead(403); response.end(); return;
        }
        const stat = fs.statSync(requested);
        if (!stat.isFile()) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, {
          'content-type': contentType(requested),
          'cache-control': 'no-store',
        });
        fs.createReadStream(requested).pipe(response);
      } catch {
        response.writeHead(404); response.end();
      }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}
function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  if (!fs.existsSync(sourceMain) || !fs.existsSync(sourcePreload) || !fs.existsSync(sourceRenderer)) {
    process.stdout.write(`${JSON.stringify({
      status: 'NOT_RUN',
      probe: 'moji-renderer-boot',
      reason: `pinned Moji renderer not found at ${sourceRoot}`,
      compatible: false,
    })}\n`);
    return;
  }
  const mainSHA256 = hashFile(sourceMain);
  const preloadSHA256 = hashFile(sourcePreload);
  const adapterSHA256 = hashFile(adapterPath);
  const harnessSHA256 = hashFile(harnessPath);
  if (mainSHA256 !== provenance.hashes.main || preloadSHA256 !== provenance.hashes.preload ||
      adapterSHA256 !== record.adapter.sha256) {
    process.stderr.write('ELECTRON_MBT_MOJI_RENDERER: source hash mismatch\n');
    process.exitCode = 1;
    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-moji-renderer-'));
  let assetServer = null;
  try {
    fs.mkdirSync(path.join(temp, 'out/main'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'out/preload'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'adapted'), { recursive: true });
    fs.cpSync(sourceRenderer, path.join(temp, 'out/renderer'), { recursive: true });
    fs.copyFileSync(sourceMain, path.join(temp, 'out/main/main.js'));
    fs.copyFileSync(sourcePreload, path.join(temp, 'out/preload/preload.js'));
    fs.copyFileSync(adapterPath, path.join(temp, 'adapted/page-api.js'));
    fs.copyFileSync(harnessPath, path.join(temp, 'harness.js'));
    fs.writeFileSync(path.join(temp, 'package.json'),
      `${JSON.stringify({ name: 'moji', version: '1.0.5', main: 'out/main/main.js' }, null, 2)}\n`);
    const rendererFiles = walk(path.join(temp, 'out/renderer'), temp);
    const files = [
      ...rendererFiles,
      'adapted/page-api.js',
      'package.json',
      'out/main/main.js',
      'out/preload/preload.js',
      'harness.js',
    ];
    const manifest = buildSourceManifest(temp, 'out/renderer/index.html', 'moji-renderer', files);
    writeSourceManifest(path.join(temp, 'source-manifest.json'), manifest);
    const served = await serve(temp);
    assetServer = served.server;
    const pageUrl = `${served.origin}/out/renderer/index.html`;
    const result = await run('moon', ['run', '--target', 'native', 'native/supervisor'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        ELECTRON_MBT_MOJI_APP: '1',
        ELECTRON_MBT_MOJI_BOOT_ROOT: temp,
        ELECTRON_MBT_MOJI_PAGE: 'out/renderer/index.html',
        ELECTRON_MBT_MOJI_URL: pageUrl,
      },
    });
    const lines = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n')
      .map(line => line.trim()).filter(Boolean);
    const raw = lines.filter(line => line.startsWith('{') && line.endsWith('}')).at(-1);
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      process.stderr.write(`ELECTRON_MBT_MOJI_RENDERER: no JSON report\n${result.stdout}\n${result.stderr}\n`);
      process.exitCode = 1;
      return;
    }
    const pageText = typeof parsed.pageText === 'string' ? parsed.pageText : '';
    const ok = result.code === 0 && parsed.status === 'PASS' &&
      parsed.probe === 'moji-adapted-native' && parsed.rendererLoaded === true &&
      parsed.apiPresent === true && Number.isInteger(parsed.rootChildren) &&
      parsed.rootChildren > 0 && pageText.length > 0 &&
      !/error|failed|unsupported api/i.test(pageText) && parsed.compatible === false;
    const report = {
      ...parsed,
      status: ok ? 'PASS' : 'FAIL',
      probe: 'moji-renderer-boot',
      rendererLoaded: ok,
      pageUrl: 'http://127.0.0.1:<loopback>/out/renderer/index.html',
      sourceRoot,
      mainSHA256,
      preloadSHA256,
      adapterSHA256,
      harnessSHA256,
      bootGraphFiles: manifest.files.length,
      preloadExecuted: false,
      compatible: false,
      note: 'Pinned Moji renderer loaded under the adapted profile over a loopback asset server; original preload NOT_EXECUTED.',
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!ok) process.exitCode = 1;
  } finally {
    if (assetServer !== null) assetServer.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`ELECTRON_MBT_MOJI_RENDERER: ${error && error.message || error}\n`);
  process.exitCode = 1;
});
