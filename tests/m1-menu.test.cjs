'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMenu } = require('../bridges/node/menu.cjs');

test('the M1 menu model validates templates and retains application-menu state', () => {
  const state = createMenu();
  const click = () => 1;
  const menu = state.menu.buildFromTemplate([
    { label: 'Moji', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Quit', accelerator: 'Command+Q', click }] },
    { role: 'editMenu' },
  ]);
  assert.equal(menu.items.length, 2);
  assert.equal(menu.items[0].submenu[2].click, click);
  assert.equal(state.menu.getApplicationMenu(), null);
  state.menu.setApplicationMenu(menu);
  assert.equal(state.menu.getApplicationMenu(), menu);
  state.menu.setApplicationMenu(null);
  assert.equal(state.menu.getApplicationMenu(), null);
  state.dispose();
});

test('malformed menu templates, unknown methods and disposed state fail closed', () => {
  const state = createMenu();
  for (const value of [null, {}, 'menu']) {
    assert.throws(() => state.menu.buildFromTemplate(value), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  }
  assert.throws(() => state.menu.buildFromTemplate([{ label: 'x', unknown: true }]), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.throws(() => state.menu.buildFromTemplate([{ type: 'bogus' }]), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.throws(() => state.menu.buildFromTemplate([{ click: 1 }]), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.throws(() => state.menu.buildFromTemplate([{ submenu: {} }]), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.throws(() => state.menu.setApplicationMenu({}), { code: 'ELECTRON_MBT_INVALID_ARGUMENT' });
  assert.throws(() => state.menu.showPopup({}), { code: 'ELECTRON_MBT_UNSUPPORTED_API' });
  state.dispose();
  assert.throws(() => state.menu.buildFromTemplate([]), { code: 'ELECTRON_MBT_INVALID_STATE' });
});
