(function () {
'use strict';
const api = window.api;
const status = document.getElementById('status');
const log = document.getElementById('log');
const settingsButton = document.getElementById('settings');
const pingButton = document.getElementById('ping');
const clearButton = document.getElementById('clear');

function append(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  log.textContent = `${line}\n${log.textContent || ''}`.slice(0, 12000);
}

function describe(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function fail(button, error) {
  button.disabled = false;
  append(`ERROR ${error && error.code ? `${error.code}: ` : ''}${error && error.message ? error.message : error}`);
}

if (!api || typeof api.getSettings !== 'function') {
  status.textContent = 'plain page: the adapted page API is not available';
  pingButton.disabled = true;
} else {
  status.textContent = 'adapted page API ready';
  settingsButton.disabled = false;
  pingButton.disabled = false;
  api.getSettings().then(function (settings) {
    status.textContent = `ready: theme=${settings.theme}`;
    append(`getSettings (on load) -> ${describe(settings)}`);
  }, function (error) {
    status.textContent = 'adapted API present, first call failed';
    append(`getSettings (on load) failed: ${error && error.code ? error.code : error}`);
  });
}

settingsButton.addEventListener('click', function () {
  settingsButton.disabled = true;
  api.getSettings().then(function (settings) {
    settingsButton.disabled = false;
    append(`getSettings -> ${describe(settings)}`);
  }, function (error) { fail(settingsButton, error); });
});

pingButton.addEventListener('click', function () {
  pingButton.disabled = true;
  api.ping().then(function (reply) {
    pingButton.disabled = false;
    append(`ping -> ${describe(reply)}`);
  }, function (error) { fail(pingButton, error); });
});

clearButton.addEventListener('click', function () {
  log.textContent = '';
});

})();
