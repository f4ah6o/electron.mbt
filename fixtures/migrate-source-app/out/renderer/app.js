'use strict';
const root = document.getElementById('root');
if (root) root.textContent = 'migrate fixture';
if (window.api && typeof window.api.getSettings === 'function') {
  window.api.getSettings().then(function (settings) {
    if (root) root.dataset.theme = settings.theme;
  }, function () {});
}
