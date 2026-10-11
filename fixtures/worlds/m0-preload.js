'use strict';
(() => {
  // Why not: shared DOM is test transport, never a credential or privileged IPC surface.
  const requestEvent = 'electron-mbt-m0-request';
  const callbackEvent = 'electron-mbt-m0-callback';
  const requestAttr = 'data-electron-mbt-m0-request';
  const replyAttr = 'data-electron-mbt-m0-reply';
  const callbackAttr = 'data-electron-mbt-m0-callback';
  const callbackReplyAttr = 'data-electron-mbt-m0-callback-reply';
  const originalMap = Array.prototype.map;
  let requests = 0;
  let callbackAttempts = 0;
  let nativePageRequestCount = 0;
  let nativePageReplySettled = false;
  const state = {
    isolatedMarker: true,
    nativeReplyPromise: false,
    nativeReplySettled: false,
    grantProbeSettled: false,
    grantEchoAccepted: false,
    invalidGrantRejected: false,
    staleGrantRejected: false,
    get requests() { return requests; },
    get callbackAttempts() { return callbackAttempts; },
    get nativePageRequestCount() { return nativePageRequestCount; },
    get nativePageReplySettled() { return nativePageReplySettled; },
    get primordialIntact() { return Array.prototype.map === originalMap; },
  };
  globalThis.electronMbtM0IsolatedOnly = state;
  document.addEventListener(requestEvent, () => {
    requests += 1;
    const root = document.documentElement;
    if (!root) return;
    try {
      const input = JSON.parse(root.getAttribute(requestAttr));
      let result;
      if (input.operation === 'add' && Array.isArray(input.value) &&
          input.value.length === 2 &&
          input.value.every(value => Number.isSafeInteger(value))) {
        result = input.value[0] + input.value[1];
      } else if (input.operation === 'raise') {
        throw new TypeError('isolated synchronous error');
      } else if (input.operation === 'page-trigger-native' && input.value === null) {
        // Why not: the native sender is this isolated world, but the initiating
        // page event remains untrusted; this is a test-only no-privilege echo.
        nativePageRequestCount += 1;
        const replyPromise = window.webkit.messageHandlers.electronMbtM0NativeReply
          .postMessage({ probe: 'm0', source: 'dom-triggered' });
        if (!replyPromise || typeof replyPromise.then !== 'function') {
          throw new TypeError('native reply is not a Promise');
        }
        replyPromise.then(value => { nativePageReplySettled = value === 'native-ack'; },
          () => { nativePageReplySettled = false; });
        result = 'native-pending';
      } else if (input.operation === 'callback' && input.value &&
          typeof input.value.id === 'string' &&
          Number.isSafeInteger(input.value.amount)) {
        callbackAttempts += 1;
        root.removeAttribute(callbackReplyAttr);
        root.setAttribute(callbackAttr, JSON.stringify(input.value));
        document.dispatchEvent(new Event(callbackEvent));
        const callbackResponse = JSON.parse(root.getAttribute(callbackReplyAttr) || 'null');
        if (!callbackResponse || callbackResponse.ok !== true) {
          throw new TypeError('callback missing');
        }
        result = callbackResponse.value;
      } else {
        throw new TypeError('unsupported test operation');
      }
      root.setAttribute(replyAttr, JSON.stringify({ ok: true, value: result }));
    } catch (error) {
      root.setAttribute(replyAttr, JSON.stringify({
        ok: false, name: error.name, message: error.message,
      }));
    }
  });
  const reply = window.webkit.messageHandlers.electronMbtM0NativeReply.postMessage({
    probe: 'm0', source: 'document-start',
  });
  state.nativeReplyPromise = !!reply && typeof reply.then === 'function';
  if (state.nativeReplyPromise) {
    reply.then(value => {
      state.nativeReplySettled = value?.reply === 'native-ack';
      const documentGrant = value?.documentGrant;
      const previousGrant = value?.previousGrant;
      if (!state.nativeReplySettled || typeof documentGrant !== 'string' ||
          !documentGrant || (previousGrant !== null && typeof previousGrant !== 'string')) {
        state.grantProbeSettled = true;
        return;
      }
      const handler = window.webkit.messageHandlers.electronMbtM0NativeReply;
      // Why not: this test-only opaque grant stays in the isolated closure, never
      // shared DOM. It does NOT authenticate a page event that triggers this world.
      const positive = handler.postMessage({
        probe: 'm0', source: 'grant-valid', grant: documentGrant,
      }).then(result => result === 'grant-ack', () => false);
      const invalid = handler.postMessage({
        probe: 'm0', source: 'grant-invalid', grant: 'intentionally-invalid',
      }).then(() => false, () => true);
      const stale = previousGrant === null ? Promise.resolve(false) :
        handler.postMessage({
          probe: 'm0', source: 'grant-stale', grant: previousGrant,
        }).then(() => false, () => true);
      Promise.all([positive, invalid, stale]).then(values => {
        state.grantEchoAccepted = values[0];
        state.invalidGrantRejected = values[1];
        state.staleGrantRejected = values[2];
        state.grantProbeSettled = true;
      }, () => { state.grantProbeSettled = true; });
    }, () => {
      state.nativeReplySettled = false;
      state.grantProbeSettled = true;
    });
  } else {
    state.grantProbeSettled = true;
  }
})();
