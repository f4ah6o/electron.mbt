// Test-only page-world shim for the M0 B5 contextBridge spike.
//
// This file runs in WKContentWorld.pageWorld at document start, before page
// scripts. It materializes the API exposed by the isolated test bridge and
// turns page calls into synchronous shared-DOM requests. It is not a
// production bridge and must not be shipped as one.
//
// Why not a page-world preload: the unchanged preload must stay in the
// isolated world. This shim only holds page-callable wrappers and copied data.
'use strict';

const codecFactory = globalThis.__m0CbCodec;
delete globalThis.__m0CbCodec;
if (!codecFactory) throw new Error('ELECTRON_MBT_BRIDGE_CODEC_UNAVAILABLE');
const codec = codecFactory.createCodec({
  secret: __m0Secret,
  limits: { maxBytes: 65536, maxDepth: 8, maxNodes: 512, maxString: 32768, maxHandles: 256 },
});

const API_KEY = __m0ExposedApiKey;
const META_NAME = 'electron-mbt-m0-bridge';
const REQUEST_EVENT = 'electron-mbt-m0-bridge-request';
const RESPONSE_EVENT = 'electron-mbt-m0-bridge-response';
const HANDSHAKE_SESSION = 'handshake';

const documentObject = document;
const windowObject = window;
const EventCtor = Event;
const dispatchEvent = EventTarget.prototype.dispatchEvent;
const stopImmediatePropagation = Event.prototype.stopImmediatePropagation;
const createElement = Document.prototype.createElement;
const appendChild = Node.prototype.appendChild;
const getAttribute = Element.prototype.getAttribute;
const setAttribute = Element.prototype.setAttribute;
const defineProperty = Object.defineProperty;
const jsonStringify = JSON.stringify;
const jsonParse = JSON.parse;
const isArray = Array.isArray;
const freeze = Object.freeze;
const create = Object.create;
const ErrorCtor = Error;
const PromiseCtor = Promise;
const Uint8ArrayCtor = Uint8Array;
const numberToString = Number.prototype.toString;
const mathRandom = Math.random;
const cryptoObject = globalThis.crypto;
const randomValues = cryptoObject && typeof cryptoObject.getRandomValues === 'function'
  ? cryptoObject.getRandomValues.bind(cryptoObject) : null;

const MAX_MESSAGES = 16;
const MAX_MESSAGE_BYTES = 65536;
const MAX_SESSION_ID = 64;
const MAX_HANDLE = 64;

const pageFunctions = create(null);
const pendingPromises = create(null);
const earlySettlements = create(null);
let callbackSequence = 0;
let callSequence = 0;
let challenge = null;
let sessionId = null;
let materialized = null;
let apiError = null;
let helloStarted = false;
let helloComplete = false;
let transport = null;

function bridgeError(code, message) {
  const error = new ErrorCtor(message || code);
  error.name = 'BridgeError';
  error.code = code;
  return error;
}

function errorPayload(error) {
  return codec.makeRecord([
    ['name', typeof error?.name === 'string' ? error.name : 'Error'],
    ['message', typeof error?.message === 'string' ? error.message : String(error)],
    ['code', typeof error?.code === 'string' ? error.code : null],
  ]);
}

function makeError(payload) {
  if (!payload || typeof payload !== 'object') {
    return bridgeError('ELECTRON_MBT_BRIDGE_REMOTE_ERROR', 'remote error was not an object');
  }
  const error = new ErrorCtor(typeof payload.message === 'string' ? payload.message : 'remote error');
  if (typeof payload.name === 'string' && payload.name) error.name = payload.name;
  if (typeof payload.code === 'string' && payload.code) error.code = payload.code;
  return error;
}

function randomHex(bytes) {
  const array = new Uint8ArrayCtor(bytes);
  if (randomValues) randomValues(array);
  else {
    for (let index = 0; index < bytes; index += 1) {
      array[index] = (mathRandom() * 256) | 0;
    }
  }
  let out = '';
  for (let index = 0; index < bytes; index += 1) {
    out += (array[index] < 16 ? '0' : '') + numberToString.call(array[index], 16);
  }
  return out;
}

function token(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_HANDLE;
}

function getTransport() {
  if (transport) return transport;
  const head = documentObject.head || documentObject.documentElement || documentObject;
  const meta = createElement.call(documentObject, 'meta');
  setAttribute.call(meta, 'name', META_NAME);
  setAttribute.call(meta, 'id', 'm0cb-' + randomHex(8));
  setAttribute.call(meta, 'content', '[]');
  appendChild.call(head, meta);
  transport = meta;
  return meta;
}

function normalizeEnvelope(item) {
  if (!item || typeof item !== 'object' || isArray(item)) return null;
  return codec.makeRecord([
    ['v', item.v], ['dir', item.dir], ['session', item.session], ['kind', item.kind],
    ['id', item.id], ['payload', item.payload], ['mac', item.mac],
  ]);
}

function readMessages(element) {
  if (!element) return codec.makeArray();
  let raw;
  try { raw = getAttribute.call(element, 'content'); } catch (_) { return codec.makeArray(); }
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return codec.makeArray();
  let parsed;
  try { parsed = jsonParse(raw); } catch (_) { return codec.makeArray(); }
  if (!isArray(parsed)) return codec.makeArray();
  const messages = codec.makeArray();
  for (let index = 0; index < parsed.length && index < MAX_MESSAGES; index += 1) {
    const item = normalizeEnvelope(parsed[index]);
    if (item) codec.arrayPush(messages, item);
  }
  return messages;
}

function writeMessages(element, messages) {
  if (!element) return;
  const raw = jsonStringify(messages);
  if (raw.length > MAX_MESSAGE_BYTES) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_MESSAGE_LIMIT', 'bridge message map is full');
  }
  setAttribute.call(element, 'content', raw);
}

function appendMessage(element, envelope) {
  const messages = readMessages(element);
  if (messages.length >= MAX_MESSAGES) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_MESSAGE_LIMIT', 'bridge message queue is full');
  }
  codec.arrayPush(messages, envelope);
  writeMessages(element, messages);
}

function takeAny(element, direction, kind) {
  const messages = readMessages(element);
  let found = null;
  const kept = codec.makeArray();
  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index];
    if (!found && item && item.dir === direction && item.kind === kind) found = item;
    else codec.arrayPush(kept, item);
  }
  if (found) writeMessages(element, kept);
  return found;
}

function takeById(element, direction, kind, id) {
  const messages = readMessages(element);
  let found = null;
  const kept = codec.makeArray();
  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index];
    if (!found && item && item.dir === direction && item.kind === kind && item.id === id) {
      found = item;
    } else {
      codec.arrayPush(kept, item);
    }
  }
  if (found) writeMessages(element, kept);
  return found;
}

function makeEnvelope(direction, session, kind, id, payload) {
  const payloadJson = jsonStringify(payload);
  return codec.makeRecord([
    ['v', 1],
    ['dir', direction],
    ['session', session],
    ['kind', kind],
    ['id', id],
    ['payload', payloadJson],
    ['mac', codec.hmac(direction, session, id, payloadJson)],
  ]);
}

function verifyEnvelope(envelope, direction, session, kind, id) {
  if (!envelope || typeof envelope !== 'object' || isArray(envelope)) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_REPLY_INVALID', 'missing bridge envelope');
  }
  if (envelope.v !== 1 || envelope.dir !== direction || envelope.session !== session ||
      envelope.kind !== kind || envelope.id !== id ||
      typeof envelope.payload !== 'string' || typeof envelope.mac !== 'string') {
    throw bridgeError('ELECTRON_MBT_BRIDGE_REPLY_INVALID', 'unexpected bridge envelope');
  }
  if (!codec.verify(direction, session, id, envelope.payload, envelope.mac)) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_REPLY_FORGED', 'bridge message integrity check failed');
  }
  let payload;
  try { payload = jsonParse(envelope.payload); } catch (_) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_REPLY_INVALID', 'bridge payload is not JSON');
  }
  if (!payload || typeof payload !== 'object' || isArray(payload)) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_REPLY_INVALID', 'bridge payload is not an object');
  }
  return payload;
}

function dispatchOnDocument(name) {
  dispatchEvent.call(documentObject, new EventCtor(name));
}

function makeRemoteCallable(handle) {
  if (!token(handle)) throw bridgeError('ELECTRON_MBT_BRIDGE_HANDLE', 'invalid function handle');
  return function remoteCallable() {
    return callRemote(handle, arguments);
  };
}

function registerPageCallback(fn) {
  callbackSequence += 1;
  if (callbackSequence > 256) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_HANDLE_LIMIT', 'page callback handle limit reached');
  }
  const handle = 'pcb-' + callbackSequence;
  pageFunctions[handle] = fn;
  return handle;
}

function applySettlement(handle, verified) {
  const pending = pendingPromises[handle];
  if (!pending) return false;
  delete pendingPromises[handle];
  if (verified.ok === true) {
    try {
      const value = codec.decode(verified.value, {
        onFunction: makeRemoteCallable,
        onPromise: makePagePromise,
        freeze: false,
      });
      pending.resolve(value);
    } catch (error) {
      pending.reject(error);
    }
  } else {
    pending.reject(makeError(verified.error));
  }
  return true;
}

function makePagePromise(handle) {
  if (!token(handle)) throw bridgeError('ELECTRON_MBT_BRIDGE_HANDLE', 'invalid Promise handle');
  if (pendingPromises[handle]) throw bridgeError('ELECTRON_MBT_BRIDGE_HANDLE', 'duplicate Promise handle');
  let count = 0;
  for (const key in pendingPromises) { void key; count += 1; if (count > 256) break; }
  if (count > 256) throw bridgeError('ELECTRON_MBT_BRIDGE_HANDLE_LIMIT', 'Promise handle limit reached');
  const promise = new PromiseCtor(function (resolve, reject) {
    pendingPromises[handle] = { resolve, reject };
  });
  // A custom thenable may settle synchronously from then(); the settlement
  // event can arrive before the reply carrying this handle is decoded.
  const early = earlySettlements[handle];
  if (early) {
    delete earlySettlements[handle];
    applySettlement(handle, early);
  }
  return promise;
}

function decodeArgs(json) {
  return codec.decode(json, {
    onFunction: makeRemoteCallable,
    onPromise: makePagePromise,
    freeze: false,
  });
}

function callRemote(handle, argumentList) {
  if (!helloComplete) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_NOT_READY', 'bridge handshake did not complete');
  }
  const element = getTransport();
  const elementId = getAttribute.call(element, 'id');
  const args = [];
  for (let index = 0; index < argumentList.length; index += 1) args[index] = argumentList[index];
  const encodedArgs = codec.encode(args, {
    allowFunctions: true,
    allowPromises: false,
    allowUndefined: false,
    onFunction: registerPageCallback,
  });
  callSequence += 1;
  const id = 'call-' + callSequence;
  const payload = codec.makeRecord([
    ['elementId', elementId],
    ['handle', handle],
    ['args', encodedArgs],
  ]);
  const request = makeEnvelope('p2i', sessionId, 'call', id, payload);
  appendMessage(element, request);
  dispatchOnDocument(REQUEST_EVENT);
  const reply = takeById(element, 'i2p', 'reply', id);
  if (!reply) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_NO_REPLY', 'isolated bridge did not answer');
  }
  const verified = verifyEnvelope(reply, 'i2p', sessionId, 'reply', id);
  if (verified.ok === true) {
    return codec.decode(verified.value, {
      onFunction: makeRemoteCallable,
      onPromise: makePagePromise,
      freeze: false,
    });
  }
  if (verified.ok === false) throw makeError(verified.error);
  throw bridgeError('ELECTRON_MBT_BRIDGE_REPLY_INVALID', 'invalid bridge reply result');
}

function handleResponse() {
  if (!transport) return;
  try {
    const element = transport;
    for (;;) {
      const envelope = takeAny(element, 'i2p', 'callback');
      if (!envelope) break;
      handleCallbackRequest(element, envelope);
    }
    for (;;) {
      const envelope = takeAny(element, 'i2p', 'settle');
      if (!envelope) break;
      handleSettlement(element, envelope);
    }
  } catch (_) {
    // A malformed/replayed event is ignored. The waiting isolated proxy sees
    // a missing reply and throws in its own realm.
  }
}

function handleCallbackRequest(element, envelope) {
  const verified = verifyEnvelope(envelope, 'i2p', sessionId, 'callback', envelope.id);
  const callbackId = envelope.id;
  let reply;
  try {
    if (!token(verified.handle)) throw bridgeError('ELECTRON_MBT_BRIDGE_HANDLE', 'invalid callback handle');
    const fn = pageFunctions[verified.handle];
    if (typeof fn !== 'function') {
      throw bridgeError('ELECTRON_MBT_BRIDGE_HANDLE', 'callback handle is not registered');
    }
    const args = decodeArgs(verified.args);
    const result = fn.apply(undefined, args);
    const encoded = codec.encode(result, {
      allowFunctions: true,
      allowPromises: false,
      allowUndefined: true,
      onFunction: registerPageCallback,
    });
    reply = codec.makeRecord([['ok', true], ['value', encoded]]);
  } catch (error) {
    reply = codec.makeRecord([['ok', false], ['error', errorPayload(error)]]);
  }
  appendMessage(element, makeEnvelope('p2i', sessionId, 'callbackReply', callbackId, reply));
}

function handleSettlement(element, envelope) {
  let verified;
  try {
    verified = verifyEnvelope(envelope, 'i2p', sessionId, 'settle', envelope.id);
  } catch (_) {
    return;
  }
  const handle = verified.handle;
  if (applySettlement(handle, verified)) return;
  if (typeof handle !== 'string' || !token(handle) || earlySettlements[handle]) return;
  let count = 0;
  for (const key in earlySettlements) { void key; count += 1; if (count > 64) break; }
  if (count > 64) return;
  // Hold the verified settlement until makePagePromise registers the handle.
  earlySettlements[handle] = verified;
}

function hello() {
  if (helloComplete) return;
  if (apiError) throw apiError;
  if (helloStarted) throw bridgeError('ELECTRON_MBT_BRIDGE_NOT_READY', 'bridge handshake is in progress');
  helloStarted = true;
  try {
    challenge = randomHex(16);
    const element = getTransport();
    const elementId = getAttribute.call(element, 'id');
    const id = 'hello-' + challenge;
    const payload = codec.makeRecord([
      ['elementId', elementId],
      ['challenge', challenge],
    ]);
    appendMessage(element, makeEnvelope('p2i', HANDSHAKE_SESSION, 'hello', id, payload));
    dispatchOnDocument(REQUEST_EVENT);
    const reply = takeById(element, 'i2p', 'descriptor', id);
    if (!reply) throw bridgeError('ELECTRON_MBT_BRIDGE_NO_DESCRIPTOR', 'isolated bridge did not expose an API');
    const verified = verifyEnvelope(reply, 'i2p', HANDSHAKE_SESSION, 'descriptor', id);
    if (verified.challenge !== challenge) {
      throw bridgeError('ELECTRON_MBT_BRIDGE_REPLY_FORGED', 'descriptor challenge mismatch');
    }
    if (verified.apiKey !== API_KEY) {
      throw bridgeError('ELECTRON_MBT_BRIDGE_EXPOSURE', 'unexpected exposed api key');
    }
    if (typeof verified.sessionId !== 'string' || verified.sessionId.length < 16 ||
        verified.sessionId.length > MAX_SESSION_ID) {
      throw bridgeError('ELECTRON_MBT_BRIDGE_EXPOSURE', 'invalid bridge session id');
    }
    if (typeof verified.exposure !== 'string') {
      throw bridgeError('ELECTRON_MBT_BRIDGE_EXPOSURE', 'missing exposure descriptor');
    }
    sessionId = verified.sessionId;
    const api = codec.decode(verified.exposure, {
      onFunction: makeRemoteCallable,
      onPromise: function () {
        throw bridgeError('ELECTRON_MBT_BRIDGE_VALUE_PROMISE', 'exposed Promises are not supported');
      },
      freeze: true,
    });
    if (!api || typeof api !== 'object' || isArray(api)) {
      throw bridgeError('ELECTRON_MBT_BRIDGE_EXPOSURE', 'exposed API is not an object');
    }
    materialized = freeze(api);
    helloComplete = true;
  } catch (error) {
    apiError = error;
    throw error;
  }
}

// Install the getter before any page script. The handshake is lazy so the
// transport element can be created after the document element exists.
defineProperty(windowObject, API_KEY, {
  get() {
    if (materialized) return materialized;
    if (apiError) throw apiError;
    hello();
    if (materialized) return materialized;
    throw apiError || bridgeError('ELECTRON_MBT_BRIDGE_NOT_READY', 'bridge API is unavailable');
  },
  enumerable: true,
  configurable: false,
});

// Register the response listener before page scripts, so callbacks and
// Promise settlements find a first listener. Integrity still comes from the
// MAC, not from listener order.
documentObject.addEventListener(RESPONSE_EVENT, function (event) {
  try { stopImmediatePropagation.call(event); } catch (_) {}
  handleResponse();
});
