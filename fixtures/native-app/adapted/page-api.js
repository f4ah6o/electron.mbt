'use strict';
(function () {
  const api = Object.freeze({
    version: function () { return "adapted-fixture"; }
  });
  Object.defineProperty(window, "api", {
    value: api, enumerable: true, configurable: false, writable: false
  });
})();
