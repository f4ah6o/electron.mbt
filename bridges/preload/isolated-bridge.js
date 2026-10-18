// Experimental B6-C isolated-world bridge candidate.
//
// This file runs in the M1 host's preload WKContentWorld at document start. It
// is host-owned source passed to the native host by the trusted Node runtime;
// the app cannot substitute it. It provides the unchanged preload with
// contextBridge/ipcRenderer and serves the page-world shim's synchronous
// requests. This is an opt-in experimental candidate, not production
// contextBridge; strict promotion still requires the B6-D/E review.
'use strict';

const codecFactory = globalThis.__m0CbCodec;
delete globalThis.__m0CbCodec;
if (!codecFactory) throw new Error('ELECTRON_MBT_BRIDGE_CODEC_UNAVAILABLE');
const codec = codecFactory.createCodec({
  secret: __m0Secret,
  limits: { maxBytes: 65536, maxDepth: 8, maxNodes: 512, maxString: 32768, maxHandles: 256 },
});

const META_NAME = 'electron-mbt-m0-bridge';
const REQUEST_EVENT = 'electron-mbt-m0-bridge-request';
const RESPONSE_EVENT = 'electron-mbt-m0-bridge-response';
const HANDSHAKE_SESSION = 'handshake';
const PROBE = 'm0-cb-context-bridge';

const documentObject = document;
const windowObject = window;
const EventCtor = Event;
const dispatchEvent = EventTarget.prototype.dispatchEvent;
const stopImmediatePropagation = Event.prototype.stopImmediatePropagation;
const getElementById = Document.prototype.getElementById;
const querySelector = Document.prototype.querySelector;
const getAttribute = Element.prototype.getAttribute;
const setAttribute = Element.prototype.setAttribute;
const jsonStringify = JSON.stringify;
const jsonParse = JSON.parse;
const isArray = Array.isArray;
const create = Object.create;
const freeze = Object.freeze;
const ErrorCtor = Error;
const Uint8ArrayCtor = Uint8Array;
const numberToString = Number.prototype.toString;
const mathRandom = Math.random;
const cryptoObject = globalThis.crypto;
const randomValues = cryptoObject && typeof cryptoObject.getRandomValues === 'function'
  ? cryptoObject.getRandomValues.bind(cryptoObject) : null;
const messageHandlers = windowObject.webkit && windowObject.webkit.messageHandlers
  ? windowObject.webkit.messageHandlers : null;

const MAX_MESSAGES = 16;
const MAX_MESSAGE_BYTES = 65536;
const MAX_HANDLE = 64;
const MAX_REPORT_QUEUE = 8;

const exposedFunctions = create(null);
const returnedFunctions = create(null);
let exposedFunctionCount = 0;
const pendingPromises = create(null);
const reportQueue = [];
let sequence = 0;
let callbackSequence = 0;
let sessionId = randomHex(16);
let exposeKey = null;
let exposeTree = null;
let transportElement = null;
let documentGrant = null;
let grantFailure = null;

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
    for (let index = 0; index < bytes; index += 1) array[index] = (mathRandom() * 256) | 0;
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

function findTransport() {
  if (transportElement && transportElement.isConnected) return transportElement;
  const element = querySelector.call(documentObject, 'meta[name="' + META_NAME + '"]');
  if (element) transportElement = element;
  return element;
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

function nextHandle(prefix) {
  sequence += 1;
  if (sequence > 256) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_HANDLE_LIMIT', 'bridge handle limit reached');
  }
  return prefix + sequence;
}

function registerExposedFunction(fn) {
  const handle = nextHandle('ef-');
  exposedFunctions[handle] = fn;
  exposedFunctionCount += 1;
  return handle;
}

function registerReturnedFunction(fn) {
  const handle = nextHandle('rf-');
  returnedFunctions[handle] = fn;
  return handle;
}

function resolveFunction(handle) {
  if (typeof handle !== 'string') return null;
  const exposed = exposedFunctions[handle];
  if (typeof exposed === 'function') return exposed;
  const returned = returnedFunctions[handle];
  return typeof returned === 'function' ? returned : null;
}

function makeCallbackProxy(handle) {
  if (!token(handle)) throw bridgeError('ELECTRON_MBT_BRIDGE_HANDLE', 'invalid callback handle');
  return function callbackProxy() {
    const element = transportElement || findTransport();
    if (!element) throw bridgeError('ELECTRON_MBT_BRIDGE_NO_TRANSPORT', 'bridge transport is missing');
    const args = [];
    for (let index = 0; index < arguments.length; index += 1) args[index] = arguments[index];
    const encodedArgs = codec.encode(args, {
      allowFunctions: true,
      allowPromises: false,
      allowUndefined: false,
      onFunction: registerReturnedFunction,
    });
    callbackSequence += 1;
    const id = 'cb-' + callbackSequence;
    const payload = codec.makeRecord([['handle', handle], ['args', encodedArgs]]);
    appendMessage(element, makeEnvelope('i2p', sessionId, 'callback', id, payload));
    dispatchOnDocument(RESPONSE_EVENT);
    const reply = takeById(element, 'p2i', 'callbackReply', id);
    if (!reply) throw bridgeError('ELECTRON_MBT_BRIDGE_NO_CALLBACK_REPLY', 'page callback did not answer');
    const verified = verifyEnvelope(reply, 'p2i', sessionId, 'callbackReply', id);
    if (verified.ok === true) {
      return codec.decode(verified.value, {
        onFunction: makeCallbackProxy,
        freeze: false,
      });
    }
    if (verified.ok === false) throw makeError(verified.error);
    throw bridgeError('ELECTRON_MBT_BRIDGE_REPLY_INVALID', 'invalid callback reply');
  };
}

function registerReturnedPromise(promise) {
  const handle = nextHandle('pr-');
  pendingPromises[handle] = true;
  try {
    promise.then(
      function (value) { settlePromise(handle, true, value); },
      function (error) { settlePromise(handle, false, error); }
    );
  } catch (error) {
    pendingPromises[handle] = false;
    throw error;
  }
  return handle;
}

function settlePromise(handle, ok, valueOrError) {
  if (pendingPromises[handle] !== true) return;
  delete pendingPromises[handle];
  const element = transportElement || findTransport();
  if (!element) return;
  let payload;
  try {
    if (ok) {
      const encoded = codec.encode(valueOrError, {
        allowFunctions: true,
        allowPromises: true,
        allowUndefined: true,
        onFunction: registerReturnedFunction,
        onPromise: registerReturnedPromise,
      });
      payload = codec.makeRecord([['handle', handle], ['ok', true], ['value', encoded]]);
    } else {
      payload = codec.makeRecord([['handle', handle], ['ok', false], ['error', errorPayload(valueOrError)]]);
    }
  } catch (error) {
    payload = codec.makeRecord([['handle', handle], ['ok', false], ['error', errorPayload(error)]]);
  }
  try {
    appendMessage(element, makeEnvelope('i2p', sessionId, 'settle', 'settle-' + handle, payload));
    dispatchOnDocument(RESPONSE_EVENT);
  } catch (_) {
    // The document may be gone; the page promise dies with its realm.
  }
}

function reply(element, id, payload) {
  appendMessage(element, makeEnvelope('i2p', sessionId, 'reply', id, payload));
}

function handleHello(element, envelope) {
  const verified = verifyEnvelope(envelope, 'p2i', HANDSHAKE_SESSION, 'hello', envelope.id);
  if (typeof verified.challenge !== 'string' || verified.challenge.length < 16 ||
      verified.challenge.length > 64) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_HANDSHAKE', 'invalid handshake challenge');
  }
  const target = getElementById.call(documentObject, verified.elementId) || element;
  transportElement = target;
  if (!exposeTree || !exposeKey) {
    // No descriptor is written. The page shim fails closed with NO_DESCRIPTOR;
    // it cannot turn an absent exposure into an empty API.
    return;
  }
  const payload = codec.makeRecord([
    ['apiKey', exposeKey],
    ['sessionId', sessionId],
    ['challenge', verified.challenge],
    ['exposure', exposeTree],
  ]);
  appendMessage(target, makeEnvelope('i2p', HANDSHAKE_SESSION, 'descriptor', envelope.id, payload));
}

function handleCall(element, envelope) {
  const verified = verifyEnvelope(envelope, 'p2i', sessionId, 'call', envelope.id);
  const target = getElementById.call(documentObject, verified.elementId) || element;
  transportElement = target;
  const fn = resolveFunction(verified.handle);
  if (typeof fn !== 'function') {
    reply(target, envelope.id, codec.makeRecord([
      ['ok', false],
      ['error', codec.makeRecord([
        ['name', 'BridgeError'],
        ['message', 'unknown or revoked function handle'],
        ['code', 'ELECTRON_MBT_BRIDGE_HANDLE'],
      ])],
    ]));
    return;
  }
  let args;
  try {
    args = codec.decode(verified.args, {
      onFunction: makeCallbackProxy,
      onPromise: function () {
        throw bridgeError('ELECTRON_MBT_BRIDGE_VALUE_PROMISE', 'Promise arguments are not supported');
      },
      freeze: false,
    });
  } catch (error) {
    reply(target, envelope.id, codec.makeRecord([['ok', false], ['error', errorPayload(error)]]));
    return;
  }
  let result;
  try {
    result = fn.apply(undefined, args);
  } catch (error) {
    reply(target, envelope.id, codec.makeRecord([['ok', false], ['error', errorPayload(error)]]));
    return;
  }
  try {
    const encoded = codec.encode(result, {
      allowFunctions: true,
      allowPromises: true,
      allowUndefined: true,
      onFunction: registerReturnedFunction,
      onPromise: registerReturnedPromise,
    });
    reply(target, envelope.id, codec.makeRecord([['ok', true], ['value', encoded]]));
  } catch (error) {
    reply(target, envelope.id, codec.makeRecord([['ok', false], ['error', errorPayload(error)]]));
  }
}

function handleRequest() {
  const element = findTransport();
  if (!element) return;
  // Why process every pending envelope: a page capture listener can block one
  // event, leaving an older request queued. The current caller still needs its
  // own reply, and re-processing stale calls is only a self-DoS for the page.
  for (;;) {
    const helloEnvelope = takeAny(element, 'p2i', 'hello');
    if (helloEnvelope) {
      try { handleHello(element, helloEnvelope); } catch (_) { /* no descriptor */ }
      continue;
    }
    const callEnvelope = takeAny(element, 'p2i', 'call');
    if (callEnvelope) {
      try { handleCall(element, callEnvelope); } catch (_) { /* ignored */ }
      continue;
    }
    break;
  }
}

function send(channel, value) {
  if (typeof channel !== 'string' || channel.length === 0 || channel.length > 256) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_REPORT', 'invalid report channel');
  }
  // Validate and bound the value as plain data before handing it to WebKit.
  codec.encodeData(value);
  if (!messageHandlers || !messageHandlers.electronMbtM0CbReport) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_REPORT', 'report handler is unavailable');
  }
  if (documentGrant) return postReport(channel, value);
  if (grantFailure) throw grantFailure;
  if (reportQueue.length >= MAX_REPORT_QUEUE) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_REPORT', 'report queue is full');
  }
  reportQueue.push([channel, value]);
  return undefined;
}

function postReport(channel, value) {
  messageHandlers.electronMbtM0CbReport.postMessage({
    probe: PROBE,
    grant: documentGrant,
    channel: channel,
    value: value,
  });
  return undefined;
}

function flushReports() {
  while (reportQueue.length > 0 && documentGrant) {
    const item = reportQueue.shift();
    try { postReport(item[0], item[1]); } catch (_) { /* bounded test transport */ }
  }
}

function exposeInMainWorld(apiKey, api) {
  if (typeof apiKey !== 'string' || apiKey.length === 0 || apiKey.length > 64) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_EXPOSURE', 'invalid expose api key');
  }
  if (!api || typeof api !== 'object' || isArray(api)) {
    throw bridgeError('ELECTRON_MBT_BRIDGE_EXPOSURE', 'exposed API must be an object');
  }
  if (exposeTree) throw bridgeError('ELECTRON_MBT_BRIDGE_EXPOSURE', 'API is already exposed');
  exposeKey = apiKey;
  exposeTree = codec.encode(api, {
    allowFunctions: true,
    allowPromises: false,
    allowUndefined: false,
    onFunction: registerExposedFunction,
  });
  // The page shim learns the descriptor through the signed hello. The native
  // preload-exposure lane carries only bounded authority metadata for MoonBit;
  // it never carries a callable or a page-visible value.
  const exposureHandler = messageHandlers && messageHandlers.electronMbtPreloadExposure;
  if (exposureHandler && typeof __m0PreloadNonce === 'string' && __m0PreloadNonce.length > 0) {
    const report = exposureHandler.postMessage({
      nonce: __m0PreloadNonce,
      apiKey: exposeKey,
      descriptor: exposeTree,
      functionCount: exposedFunctionCount,
    });
    if (report && typeof report.catch === 'function') report.catch(function () {});
  }
}

// The native document grant binds the test-only report lane to the actual
// document. It is held in this closure and is never written to the page.
const documentHandler = messageHandlers && messageHandlers.electronMbtM0CbDocument;
if (documentHandler) {
  let handshake;
  try {
    handshake = documentHandler.postMessage({ probe: PROBE, source: 'document-start' });
  } catch (error) {
    grantFailure = error;
  }
  if (handshake && typeof handshake.then === 'function') {
    handshake.then(function (value) {
      if (value && typeof value.grant === 'string' && value.grant.length > 0) {
        documentGrant = value.grant;
        flushReports();
      } else {
        grantFailure = bridgeError('ELECTRON_MBT_BRIDGE_GRANT', 'native document grant was rejected');
      }
    }, function (error) {
      grantFailure = error;
    });
  } else {
    grantFailure = bridgeError('ELECTRON_MBT_BRIDGE_GRANT', 'native document grant was not a Promise');
  }
} else {
  grantFailure = bridgeError('ELECTRON_MBT_BRIDGE_GRANT', 'native document handler is unavailable');
}

// Keep the bridge functions in a temporary global only long enough for the
// host-composed CommonJS wrapper to capture them. Page world cannot see this.
globalThis.__m0CbBridge = freeze(codec.makeRecord([
  ['exposeInMainWorld', exposeInMainWorld],
  ['send', send],
]));

documentObject.addEventListener(REQUEST_EVENT, function (event) {
  try { stopImmediatePropagation.call(event); } catch (_) {}
  handleRequest();
});
