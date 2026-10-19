import { label } from './label.js';

(async function () {
  let storage = 'no-storage';
  try {
    localStorage.setItem('nodeless-probe', '1');
    if (localStorage.getItem('nodeless-probe') === '1') storage = 'storage';
    localStorage.removeItem('nodeless-probe');
  } catch (_) {
    storage = 'no-storage';
  }

  let schemeDenied = false;
  try {
    const response = await fetch('../src/main.js');
    schemeDenied = !response.ok;
  } catch (_) {
    schemeDenied = true;
  }

  const scheme = window.location.protocol === 'electron-mbt-app:' ? 'scheme' : 'bad-scheme';
  try {
    const settings = await window.api.getSettings();
    const update = await window.api.getUpdateState();
    const flags = [
      'nodeless-adapted',
      'ready',
      label,
      settings.theme,
      update.status,
      storage,
      schemeDenied ? 'denied' : 'escape',
      scheme,
    ];
    document.getElementById('root').textContent = flags.slice(2).join(':');
    document.title = flags.join('-');
  } catch (error) {
    document.title = 'nodeless-adapted-error-' + String(error && (error.code || error.message) || error);
  }
})();
