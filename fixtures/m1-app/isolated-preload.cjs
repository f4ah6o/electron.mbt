'use strict';
// No pageWorld globals or host privileges should be inherited here.
if (typeof require !== 'function' || typeof module !== 'object' ||
    typeof process !== 'undefined' || typeof Buffer !== 'undefined') {
  throw new Error('Preload realm incorrectly inherited a Node capability');
}
globalThis.__electronMbtIsolatedPreload = 42;
module.exports = { observed: true };
