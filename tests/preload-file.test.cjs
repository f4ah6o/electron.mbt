'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { readPreload, MAX_PRELOAD_BYTES } = require('../bridges/node/preload-file.cjs');

function fixture(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-mbt-preload-'));
  const root = path.join(temp, 'app');
  fs.mkdirSync(root);
  try { return fn({ root, temp }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
test('What: unchanged UTF-8 CJS is hashed and bounded for isolated injection', () => {
  fixture(({ root }) => {
    const file = path.join(root, 'safe.cjs');
    const bytes = Buffer.from("module.exports = '日本語';\n");
    fs.writeFileSync(file, bytes);
    const result = readPreload(root, file);
    assert.equal(result.preloadSource, bytes.toString('utf8'));
    assert.equal(result.preloadSHA256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(Object.keys(result).sort(), ['preloadSHA256', 'preloadSource']);
    assert.equal(MAX_PRELOAD_BYTES, 65536);
  });
});
test('What: relative, missing, symlink-escaped and sibling paths cannot load', () => {
  fixture(({ root, temp }) => {
    const sibling = path.join(temp, 'app-evil.cjs');
    fs.writeFileSync(sibling, 'module.exports = true;');
    fs.symlinkSync(sibling, path.join(root, 'escaped.cjs'));
    for (const filename of ['safe.cjs', '', null, undefined,
      path.join(root, 'absent.cjs'), sibling, path.join(root, 'escaped.cjs')]) {
      assert.throws(() => readPreload(root, filename), {
        code: 'ELECTRON_MBT_PRELOAD_PATH_DENIED',
      });
    }
    const valid = path.join(root, 'valid.cjs');
    fs.writeFileSync(valid, 'module.exports = true;');
    assert.equal(typeof readPreload(root, valid).preloadSHA256, 'string');
    fs.symlinkSync(valid, path.join(root, 'same-root.cjs'));
    assert.equal(readPreload(root, path.join(root, 'same-root.cjs')).preloadSource,
      'module.exports = true;');
  });
});
test('What: invalid extension, size and UTF-8 reject before native execution', () => {
  fixture(({ root }) => {
    const variants = [
      ['empty.cjs', Buffer.alloc(0), 'ELECTRON_MBT_PRELOAD_LIMIT'],
      ['oversized.cjs', Buffer.alloc(MAX_PRELOAD_BYTES + 1, 97), 'ELECTRON_MBT_PRELOAD_LIMIT'],
      ['invalid.cjs', Buffer.from([0xff, 0xfe]), 'ELECTRON_MBT_PRELOAD_INVALID_ENCODING'],
      ['nul.cjs', Buffer.from([97, 0, 98]), 'ELECTRON_MBT_PRELOAD_INVALID_ENCODING'],
      ['text.txt', Buffer.from('module.exports=1'), 'ELECTRON_MBT_PRELOAD_PATH_DENIED'],
    ];
    for (const [filename, bytes, code] of variants) {
      const file = path.join(root, filename);
      fs.writeFileSync(file, bytes);
      assert.throws(() => readPreload(root, file), { code });
    }
    const max = path.join(root, 'largest.js');
    fs.writeFileSync(max, Buffer.alloc(MAX_PRELOAD_BYTES, 97));
    assert.equal(Buffer.byteLength(readPreload(root, max).preloadSource), MAX_PRELOAD_BYTES);
  });
});
