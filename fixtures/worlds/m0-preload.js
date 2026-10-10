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
  const state = {
    isolatedMarker: true,
    nativeReplyPromise: false,
    nativeReplySettled: false,
    get requests() { return requests; },
    get callbackAttempts() { return callbackAttempts; },
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
  const reply = window.webkit.messageHandlers.electronMbtM0NativeReply.postMessage({ probe: 'm0' });
  state.nativeReplyPromise = !!reply && typeof reply.then === 'function';
  if (state.nativeReplyPromise) {
    reply.then(value => {
      state.nativeReplySettled = value === 'native-ack';
    }, () => {
      state.nativeReplySettled = false;
    });
  }
})();
