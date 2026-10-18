// Test-only bounded value codec and keyed message integrity for the M0 B5
// contextBridge spike. This file is not a production bridge primitive.
//
// Why not a plain shared-DOM JSON channel: the existing M0 probe showed that a
// page can overwrite a shared-DOM reply. This codec signs every message with a
// secret that only the two host-injected document-start closures receive.
//
// Why not the platform WebCrypto Promise API: the synchronous page->isolated
// call cannot await. The SHA-256/HMAC below is a test-only synchronous
// implementation, validated against Node's crypto in
// tests/m0-context-bridge-codec.test.cjs. A production bridge must use a
// reviewed primitive or engine-level proxies instead.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__m0CbCodec = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Captured at document start, before any page script can replace them.
  const jsonStringify = JSON.stringify;
  const jsonParse = JSON.parse;
  const isArray = Array.isArray;
  const objectKeys = Object.keys;
  const reflectOwnKeys = Reflect.ownKeys;
  const getPrototypeOf = Object.getPrototypeOf;
  const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  const defineProperty = Object.defineProperty;
  const freeze = Object.freeze;
  const create = Object.create;
  const setPrototypeOf = Object.setPrototypeOf;
  const objectPrototype = Object.prototype;
  const numberIsFinite = Number.isFinite;
  const StringCtor = String;
  const ErrorCtor = Error;
  const TextEncoderCtor = TextEncoder;
  const encoder = typeof TextEncoderCtor === 'function' ? new TextEncoderCtor() : null;
  const encodeText = encoder ? encoder.encode.bind(encoder) : null;
  const Uint8ArrayCtor = Uint8Array;
  const Uint32ArrayCtor = Uint32Array;
  const DataViewCtor = DataView;
  const uint8Set = Uint8ArrayCtor.prototype.set;
  const dataViewGetUint32 = DataViewCtor.prototype.getUint32;
  const dataViewSetUint32 = DataViewCtor.prototype.setUint32;
  const mathFloor = Math.floor;
  const numberToString = Number.prototype.toString;
  const stringCharCodeAt = String.prototype.charCodeAt;
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  const hasOwn = (object, key) => hasOwnProperty.call(object, key);

  const CONTEXT_PREFIX = 'm0cb1';
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H0 = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  function rotr(value, shift) {
    return ((value >>> shift) | (value << (32 - shift))) >>> 0;
  }

  function utf8(text) {
    if (typeof encodeText !== 'function') {
      throw new Error('ELECTRON_MBT_BRIDGE_CODEC: TextEncoder unavailable');
    }
    return encodeText(StringCtor(text));
  }

  function sha256Bytes(bytes) {
    const length = bytes.length;
    const paddedLength = (((length + 9) >> 6) + 1) << 6;
    const padded = new Uint8ArrayCtor(paddedLength);
    uint8Set.call(padded, bytes);
    padded[length] = 0x80;
    const view = new DataViewCtor(padded.buffer);
    dataViewSetUint32.call(view, paddedLength - 8, mathFloor(length / 0x20000000));
    dataViewSetUint32.call(view, paddedLength - 4, (length << 3) >>> 0);
    const w = new Uint32ArrayCtor(64);
    const h = new Uint32ArrayCtor(H0);
    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let t = 0; t < 16; t += 1) w[t] = dataViewGetUint32.call(view, offset + t * 4);
      for (let t = 16; t < 64; t += 1) {
        const x = w[t - 15];
        const y = w[t - 2];
        const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
        const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3];
      let e = h[4]; let f = h[5]; let g = h[6]; let i = h[7];
      for (let t = 0; t < 64; t += 1) {
        const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const temp1 = (i + s1 + ch + K[t] + w[t]) >>> 0;
        const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const temp2 = (s0 + maj) >>> 0;
        i = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
      h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + i) >>> 0;
    }
    const out = new Uint8ArrayCtor(32);
    const outView = new DataViewCtor(out.buffer);
    for (let index = 0; index < 8; index += 1) {
      dataViewSetUint32.call(outView, index * 4, h[index]);
    }
    return out;
  }

  function concatBytes(left, right) {
    const out = new Uint8ArrayCtor(left.length + right.length);
    uint8Set.call(out, left, 0);
    uint8Set.call(out, right, left.length);
    return out;
  }

  function hmacSha256Bytes(keyBytes, messageBytes) {
    let key = keyBytes;
    if (key.length > 64) key = sha256Bytes(key);
    const block = new Uint8ArrayCtor(64);
    uint8Set.call(block, key);
    const inner = new Uint8ArrayCtor(64);
    const outer = new Uint8ArrayCtor(64);
    for (let index = 0; index < 64; index += 1) {
      inner[index] = block[index] ^ 0x36;
      outer[index] = block[index] ^ 0x5c;
    }
    return sha256Bytes(concatBytes(outer, sha256Bytes(concatBytes(inner, messageBytes))));
  }

  function bytesToHex(bytes) {
    let out = '';
    for (let index = 0; index < bytes.length; index += 1) {
      out += (bytes[index] < 16 ? '0' : '') + numberToString.call(bytes[index], 16);
    }
    return out;
  }

  function timingSafeHexEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' ||
        left.length !== right.length || left.length % 2 !== 0) return false;
    let diff = 0;
    for (let index = 0; index < left.length; index += 1) {
      diff |= stringCharCodeAt.call(left, index) ^ stringCharCodeAt.call(right, index);
    }
    return diff === 0;
  }

  function contextString(direction, sessionId, messageId, payloadJson) {
    // Length-prefixing avoids ambiguous concatenations of caller-supplied ids.
    return CONTEXT_PREFIX + '|' + direction.length + ':' + direction +
      '|' + sessionId.length + ':' + sessionId +
      '|' + messageId.length + ':' + messageId +
      '|' + payloadJson;
  }

  function makeRecord(entries) {
    const record = create(null);
    if (entries) {
      for (let index = 0; index < entries.length; index += 1) {
        record[entries[index][0]] = entries[index][1];
      }
    }
    return record;
  }

  function makeArray() {
    const array = [];
    // Why not inherit Array.prototype: JSON.stringify consults toJSON, and a
    // page script can otherwise poison serialization.
    setPrototypeOf(array, null);
    return array;
  }

  function arrayPush(array, value) {
    array[array.length] = value;
    return array;
  }

  function codecError(code, message) {
    const error = new ErrorCtor(message);
    error.name = 'BridgeCodecError';
    error.code = code;
    return error;
  }

  function createCodec(options) {
    const opts = options || {};
    if (typeof opts.secret !== 'string' || opts.secret.length < 32) {
      throw codecError('ELECTRON_MBT_BRIDGE_CODEC_SECRET', 'a bounded secret is required');
    }
    const configured = opts.limits || {};
    const limits = {
      maxBytes: numberIsFinite(configured.maxBytes) && configured.maxBytes > 0
        ? configured.maxBytes : 65536,
      maxDepth: numberIsFinite(configured.maxDepth) && configured.maxDepth > 0
        ? configured.maxDepth : 8,
      maxNodes: numberIsFinite(configured.maxNodes) && configured.maxNodes > 0
        ? configured.maxNodes : 512,
      maxString: numberIsFinite(configured.maxString) && configured.maxString > 0
        ? configured.maxString : 32768,
      maxHandles: numberIsFinite(configured.maxHandles) && configured.maxHandles > 0
        ? configured.maxHandles : 256,
    };
    const secretBytes = utf8(opts.secret);
    // Why not an object literal containing "__proto__": that key sets the
    // prototype instead of creating an own data property.
    const forbiddenKeys = makeRecord([
      ['__proto__', true], ['prototype', true], ['constructor', true],
    ]);

    function hmac(direction, sessionId, messageId, payloadJson) {
      if (typeof direction !== 'string' || typeof sessionId !== 'string' ||
          typeof messageId !== 'string' || typeof payloadJson !== 'string') {
        throw codecError('ELECTRON_MBT_BRIDGE_CODEC_CONTEXT', 'invalid message context');
      }
      return bytesToHex(hmacSha256Bytes(
        secretBytes, utf8(contextString(direction, sessionId, messageId, payloadJson))));
    }

    function verify(direction, sessionId, messageId, payloadJson, mac) {
      try {
        return timingSafeHexEqual(hmac(direction, sessionId, messageId, payloadJson), mac);
      } catch (_) {
        return false;
      }
    }

    function encode(value, hooks) {
      const optionsForEncode = hooks || {};
      const state = { nodes: 0, depth: 0, inPath: [], allowFunctions: !!optionsForEncode.allowFunctions,
        allowPromises: !!optionsForEncode.allowPromises, allowUndefined: !!optionsForEncode.allowUndefined,
        onFunction: optionsForEncode.onFunction, onPromise: optionsForEncode.onPromise };
      const encoded = encodeValue(value, state);
      const json = jsonStringify(encoded);
      if (json.length > limits.maxBytes) {
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_SIZE', 'encoded value exceeds the byte limit');
      }
      return json;
    }

    function encodeValue(value, state) {
      state.nodes += 1;
      if (state.nodes > limits.maxNodes) {
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_NODES', 'value exceeds the node limit');
      }
      if (state.depth > limits.maxDepth) {
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_DEPTH', 'value exceeds the depth limit');
      }
      if (value === undefined) {
        if (state.allowUndefined) return makeRecord([['t', 'u']]);
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_UNDEFINED', 'undefined is not supported');
      }
      if (value === null) return makeRecord([['t', 'null']]);
      const type = typeof value;
      if (type === 'boolean') return makeRecord([['t', 'bool'], ['v', value]]);
      if (type === 'number') {
        if (!numberIsFinite(value)) {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_NUMBER', 'non-finite numbers are not supported');
        }
        return makeRecord([['t', 'num'], ['v', value]]);
      }
      if (type === 'string') {
        if (value.length > limits.maxString) {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_STRING', 'string exceeds the length limit');
        }
        return makeRecord([['t', 'str'], ['v', value]]);
      }
      if (type === 'bigint' || type === 'symbol') {
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_TYPE', type + ' is not supported');
      }
      if (type === 'function') {
        if (!state.allowFunctions || typeof state.onFunction !== 'function') {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_FUNCTION', 'functions are not supported here');
        }
        const handle = state.onFunction(value);
        if (typeof handle !== 'string' || handle.length === 0) {
          throw codecError('ELECTRON_MBT_BRIDGE_HANDLE', 'function handle must be a string');
        }
        return makeRecord([['t', 'fn'], ['h', handle]]);
      }
      if (value instanceof ErrorCtor) {
        return makeRecord([['t', 'err'],
          ['name', StringCtor(value.name || 'Error').slice(0, 64)],
          ['message', StringCtor(value.message || '').slice(0, 1024)]]);
      }
      if (typeof value.then === 'function') {
        if (!state.allowPromises || typeof state.onPromise !== 'function') {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_PROMISE', 'Promises are not supported here');
        }
        const handle = state.onPromise(value);
        if (typeof handle !== 'string' || handle.length === 0) {
          throw codecError('ELECTRON_MBT_BRIDGE_HANDLE', 'Promise handle must be a string');
        }
        return makeRecord([['t', 'promise'], ['h', handle]]);
      }
      for (let index = 0; index < state.inPath.length; index += 1) {
        if (state.inPath[index] === value) {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_CYCLE', 'cycles are not supported');
        }
      }
      state.inPath[state.inPath.length] = value;
      state.depth += 1;
      try {
        if (isArray(value)) {
          const items = makeArray();
          for (let index = 0; index < value.length; index += 1) {
            if (!hasOwn(value, index)) {
              throw codecError('ELECTRON_MBT_BRIDGE_VALUE_HOLE', 'sparse arrays are not supported');
            }
            arrayPush(items, encodeValue(value[index], state));
          }
          return makeRecord([['t', 'arr'], ['v', items]]);
        }
        const prototype = getPrototypeOf(value);
        if (prototype !== objectPrototype && prototype !== null) {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_OBJECT', 'only plain objects are supported');
        }
        // Symbol-keyed properties are not representable in the page copy;
        // reject them instead of silently dropping them.
        const allKeys = reflectOwnKeys(value);
        for (let index = 0; index < allKeys.length; index += 1) {
          if (typeof allKeys[index] !== 'string') {
            throw codecError('ELECTRON_MBT_BRIDGE_VALUE_SYMBOL', 'symbol keys are not supported');
          }
        }
        const descriptors = getOwnPropertyDescriptors(value);
        const keys = objectKeys(descriptors);
        const pairs = makeArray();
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index];
          if (forbiddenKeys[key] === true) {
            throw codecError('ELECTRON_MBT_BRIDGE_VALUE_KEY', 'forbidden object key');
          }
          const descriptor = descriptors[key];
          if (!descriptor || !descriptor.enumerable) continue;
          if (!('value' in descriptor)) {
            throw codecError('ELECTRON_MBT_BRIDGE_VALUE_ACCESSOR', 'accessors are not supported');
          }
          if (key.length > 256) {
            throw codecError('ELECTRON_MBT_BRIDGE_VALUE_KEY', 'object key exceeds the length limit');
          }
          arrayPush(pairs, makeArray());
          arrayPush(pairs[pairs.length - 1], key);
          arrayPush(pairs[pairs.length - 1], encodeValue(descriptor.value, state));
        }
        return makeRecord([['t', 'obj'], ['v', pairs]]);
      } finally {
        state.inPath.length -= 1;
        state.depth -= 1;
      }
    }

    function decode(json, hooks) {
      if (typeof json !== 'string' || json.length > limits.maxBytes) {
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_SIZE', 'encoded value is missing or too large');
      }
      let parsed;
      try { parsed = jsonParse(json); } catch (_) {
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_JSON', 'invalid encoded value');
      }
      const optionsForDecode = hooks || {};
      const state = { nodes: 0, freeze: !!optionsForDecode.freeze,
        onFunction: optionsForDecode.onFunction, onPromise: optionsForDecode.onPromise };
      return decodeValue(parsed, state);
    }

    function decodeValue(encoded, state) {
      state.nodes += 1;
      if (state.nodes > limits.maxNodes) {
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_NODES', 'decoded value exceeds the node limit');
      }
      if (!encoded || typeof encoded !== 'object' || isArray(encoded)) {
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_JSON', 'invalid encoded value node');
      }
      if (!hasOwn(encoded, 't')) {
        throw codecError('ELECTRON_MBT_BRIDGE_VALUE_JSON', 'missing encoded value tag');
      }
      const tag = encoded.t;
      if (tag === 'u') return undefined;
      if (tag === 'null') return null;
      if (tag === 'bool') {
        if (typeof encoded.v !== 'boolean') throw codecError('ELECTRON_MBT_BRIDGE_VALUE_JSON', 'invalid boolean');
        return encoded.v;
      }
      if (tag === 'num') {
        if (typeof encoded.v !== 'number' || !numberIsFinite(encoded.v)) {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_NUMBER', 'invalid number');
        }
        return encoded.v;
      }
      if (tag === 'str') {
        if (typeof encoded.v !== 'string' || encoded.v.length > limits.maxString) {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_STRING', 'invalid string');
        }
        return encoded.v;
      }
      if (tag === 'fn') {
        if (typeof encoded.h !== 'string' || encoded.h.length === 0) {
          throw codecError('ELECTRON_MBT_BRIDGE_HANDLE', 'invalid function handle');
        }
        if (typeof state.onFunction !== 'function') {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_FUNCTION', 'function handles are not supported here');
        }
        return state.onFunction(encoded.h);
      }
      if (tag === 'promise') {
        if (typeof encoded.h !== 'string' || encoded.h.length === 0) {
          throw codecError('ELECTRON_MBT_BRIDGE_HANDLE', 'invalid Promise handle');
        }
        if (typeof state.onPromise !== 'function') {
          throw codecError('ELECTRON_MBT_BRIDGE_VALUE_PROMISE', 'Promise handles are not supported here');
        }
        return state.onPromise(encoded.h);
      }
      if (tag === 'err') {
        const error = new ErrorCtor(typeof encoded.message === 'string' ? encoded.message : 'bridge error');
        if (typeof encoded.name === 'string' && encoded.name) error.name = encoded.name;
        return error;
      }
      if (tag === 'arr') {
        if (!isArray(encoded.v)) throw codecError('ELECTRON_MBT_BRIDGE_VALUE_JSON', 'invalid array node');
        const array = [];
        for (let index = 0; index < encoded.v.length; index += 1) {
          array[index] = decodeValue(encoded.v[index], state);
        }
        return state.freeze ? freeze(array) : array;
      }
      if (tag === 'obj') {
        if (!isArray(encoded.v)) throw codecError('ELECTRON_MBT_BRIDGE_VALUE_JSON', 'invalid object node');
        const object = {};
        for (let index = 0; index < encoded.v.length; index += 1) {
          const pair = encoded.v[index];
          if (!isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') {
            throw codecError('ELECTRON_MBT_BRIDGE_VALUE_JSON', 'invalid object entry');
          }
          if (forbiddenKeys[pair[0]] === true) {
            throw codecError('ELECTRON_MBT_BRIDGE_VALUE_KEY', 'forbidden object key');
          }
          defineProperty(object, pair[0], {
            value: decodeValue(pair[1], state), enumerable: true, writable: true, configurable: true,
          });
        }
        return state.freeze ? freeze(object) : object;
      }
      throw codecError('ELECTRON_MBT_BRIDGE_VALUE_JSON', 'unknown encoded value tag');
    }

    function encodeData(value) {
      return encode(value, { allowFunctions: false, allowPromises: false, allowUndefined: false });
    }

    function decodeData(json) {
      return decode(json, { freeze: false });
    }

    return {
      limits,
      hmac,
      verify,
      encode,
      decode,
      encodeData,
      decodeData,
      makeRecord,
      makeArray,
      arrayPush,
      contextString,
      bytesToHex,
      utf8,
      sha256Hex(text) { return bytesToHex(sha256Bytes(utf8(text))); },
    };
  }

  return { createCodec, makeRecord, makeArray, arrayPush };
});
