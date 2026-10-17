'use strict';
const { runtimeError } = require('./errors.cjs');

const ITEM_KEYS = new Set([
  'label', 'role', 'type', 'submenu', 'click', 'accelerator', 'enabled',
  'checked', 'visible', 'id', 'sublabel', 'toolTip',
]);
const TYPES = new Set(['normal', 'separator', 'submenu', 'checkbox', 'radio']);

function invalid(message) {
  throw runtimeError('ELECTRON_MBT_INVALID_ARGUMENT', message);
}

function validateItem(item, at) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || Object.getPrototypeOf(item) !== Object.prototype) {
    invalid(`${at} must be a plain menu item object`);
  }
  for (const key of Object.keys(item)) {
    if (!ITEM_KEYS.has(key)) invalid(`${at}.${key} is not supported by the M1 menu model`);
  }
  if (item.label !== undefined && (typeof item.label !== 'string' || !item.label.isWellFormed())) {
    invalid(`${at}.label must be a well-formed string`);
  }
  if (item.role !== undefined && typeof item.role !== 'string') invalid(`${at}.role must be a string`);
  if (item.type !== undefined && !TYPES.has(item.type)) invalid(`${at}.type is invalid`);
  if (item.click !== undefined && typeof item.click !== 'function') invalid(`${at}.click must be a function`);
  if (item.accelerator !== undefined && typeof item.accelerator !== 'string') invalid(`${at}.accelerator must be a string`);
  for (const key of ['enabled', 'checked', 'visible']) {
    if (item[key] !== undefined && typeof item[key] !== 'boolean') invalid(`${at}.${key} must be a boolean`);
  }
  for (const key of ['id', 'sublabel', 'toolTip']) {
    if (item[key] !== undefined && typeof item[key] !== 'string') invalid(`${at}.${key} must be a string`);
  }
  const copy = { ...item };
  if (item.submenu !== undefined) {
    if (!Array.isArray(item.submenu)) invalid(`${at}.submenu must be an array`);
    copy.submenu = item.submenu.map((child, index) => validateItem(child, `${at}.submenu[${index}]`));
  }
  return Object.freeze(copy);
}

function buildFromTemplate(template) {
  if (!Array.isArray(template)) invalid('Menu.buildFromTemplate expects an array');
  return Object.freeze({ items: Object.freeze(template.map((item, index) => validateItem(item, `template[${index}]`))) });
}

// A bounded main-local menu model. It validates and retains application menu
// state, but does not install an NSMenu or claim native role/click acceptance.
function createMenu() {
  let applicationMenu = null;
  let disposed = false;
  const methods = {
    buildFromTemplate(template) {
      if (disposed) throw runtimeError('ELECTRON_MBT_INVALID_STATE', 'Menu belongs to a stopped runtime');
      return buildFromTemplate(template);
    },
    setApplicationMenu(menu) {
      if (disposed) throw runtimeError('ELECTRON_MBT_INVALID_STATE', 'Menu belongs to a stopped runtime');
      if (menu !== null && (!menu || !Array.isArray(menu.items))) {
        invalid('Menu.setApplicationMenu expects null or a menu from buildFromTemplate');
      }
      applicationMenu = menu;
    },
    getApplicationMenu() {
      return applicationMenu;
    },
  };
  const proxy = new Proxy(methods, {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || property in target) return Reflect.get(target, property, receiver);
      throw runtimeError('ELECTRON_MBT_UNSUPPORTED_API',
        `Menu.${String(property)} is not available in the experimental M1 profile`);
    },
  });
  return {
    menu: proxy,
    dispose() { disposed = true; applicationMenu = null; },
  };
}

module.exports = { createMenu, buildFromTemplate };
