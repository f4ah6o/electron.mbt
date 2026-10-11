'use strict';
(() => {
  // Why not: an isolated script in a child frame must not inherit main-frame authority.
  if (window === window.top || !location.pathname.endsWith('/m0-frame.html')) return;
  const state = {
    attempted: false, replyPromise: false, settled: false,
    denied: false, rejectionCodeObserved: false,
  };
  globalThis.electronMbtM0SubframeOnly = state;
  const reply = window.webkit.messageHandlers.electronMbtM0NativeReply.postMessage({
    probe: 'm0', source: 'document-start',
  });
  state.attempted = true;
  state.replyPromise = !!reply && typeof reply.then === 'function';
  if (state.replyPromise) {
    reply.then(() => { state.settled = true; }, error => {
      state.denied = true;
      state.rejectionCodeObserved = String(error).includes('ELECTRON_MBT_UNEXPECTED_M0_SENDER');
      state.settled = true;
    });
  } else {
    state.settled = true;
  }
})();
