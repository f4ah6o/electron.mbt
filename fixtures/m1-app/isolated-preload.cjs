'use strict';
// No pageWorld globals or host privileges should be inherited here.
if (typeof window.webkit?.messageHandlers?.electronMbtBootstrap !== 'undefined' ||
    typeof window.webkit?.messageHandlers?.electronMbtPreloadResult === 'undefined') {
  throw new Error('Native bootstrap realm was accessible from the application preload');
}
if (typeof require !== 'function' || typeof module !== 'object' ||
    typeof process !== 'undefined' || typeof Buffer !== 'undefined') {
  throw new Error('Preload realm incorrectly inherited a Node capability');
}
globalThis.__electronMbtIsolatedPreload = 42;
module.exports = { observed: true };
