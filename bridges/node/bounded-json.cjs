'use strict';
const { types } = require('node:util');
const { runtimeError } = require('./errors.cjs');

function fail(message) { throw runtimeError('ELECTRON_MBT_PROTOCOL', message); }

function encodeData(value, limits) {
  const parts = [];
  const seen = new WeakSet();
  let bytes = 0;
  let reservedNodes = 1;
  function account(size) {
    if (size > limits.bytes - bytes) fail('Envelope exceeds byte limit');
    bytes += size;
  }
  function emit(text) { account(Buffer.byteLength(text, 'utf8')); parts.push(text); }
  function reserve(count) {
    if (count > limits.wireNodes - reservedNodes) fail('JSON node limit exceeded');
    reservedNodes += count;
  }
  function quoted(text) {
    // Stringifying first can expand control characters sixfold, even though
    // the unescaped source fits the byte cap. Measure without making a copy.
    const available = limits.bytes - bytes;
    if (text.length > available) fail('Envelope exceeds byte limit');
    let size = 2;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) size += 2;
      else if (c < 32) size += 6;
      else if (c < 128) size++;
      else if (c < 2048) size += 2;
      else if (c >= 0xd800 && c <= 0xdbff) {
        const next = text.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail('Unpaired surrogate');
        size += 4;
      } else if (c >= 0xdc00 && c <= 0xdfff) fail('Unpaired surrogate');
      else size += 3;
      if (size > available) fail('Envelope exceeds byte limit');
    }
    account(size);
    parts.push(JSON.stringify(text));
  }
  function visit(input, depth) {
    if (depth > limits.wireDepth) fail('JSON depth limit exceeded');
    if (input === null) { emit('null'); return; }
    if (typeof input === 'boolean') { emit(input ? 'true' : 'false'); return; }
    if (typeof input === 'string') { quoted(input); return; }
    if (typeof input === 'number') {
      if (!Number.isFinite(input) || Object.is(input, -0)) fail('Unsupported JavaScript number');
      emit(String(input)); return;
    }
    // Coercion and direct property reads could execute application code or
    // erase unsupported values before the MoonBit contract ever sees them.
    if (typeof input !== 'object' || types.isProxy(input) || seen.has(input)) fail('Unsupported JavaScript value');
    seen.add(input);
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) fail('Unsupported JavaScript prototype');
    const length = array ? Object.getOwnPropertyDescriptor(input, 'length').value : 0;
    if (array && length > limits.wireNodes - reservedNodes) fail('JSON node limit exceeded');
    const keys = Reflect.ownKeys(input);
    if (array ? keys.length !== length + 1 : keys.length > limits.wireNodes - reservedNodes) fail('Invalid or excessive own properties');
    if (keys.some(key => typeof key !== 'string')) fail('Symbol keys are not representable');
    reserve(array ? length : keys.length);
    emit(array ? '[' : '{');
    const count = array ? length : keys.length;
    for (let index = 0; index < count; index++) {
      const key = array ? String(index) : keys[index];
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('Accessors and hidden or missing properties are not representable');
      if (index) emit(',');
      if (!array) { quoted(key); emit(':'); }
      visit(descriptor.value, depth + 1);
    }
    emit(array ? ']' : '}');
  }
  visit(value, 0);
  // Parts contain only bounded primitive encodings, never caller objects.
  return parts.join('');
}
module.exports = { encodeData };
