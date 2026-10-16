'use strict';

const failureCodes = new Set([
  'fixture-watchdog', 'unexpected-sender', 'duplicate-report',
  'renderer-fixture-error', 'load-failed', 'load-rejected', 'ready-rejected',
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function isDeclaredFailure(value) {
  return record(value) && value.status === 'failed' && failureCodes.has(value.code)
    && typeof value.moduleIdentity === 'boolean' && Array.isArray(value.trace)
    && record(value.versions) && typeof value.versions.node === 'string' && value.versions.node.length > 0
    && typeof value.platform === 'string' && value.platform.length > 0
    && typeof value.arch === 'string' && value.arch.length > 0;
}

function parseCandidateObservation(result, raw) {
  let value;
  let parsed = false;
  if (typeof raw === 'string' && raw.length <= 16384) {
    try { value = JSON.parse(raw); parsed = true; } catch { /* malformed output is never failure evidence */ }
  }
  if (result.status !== 0 || result.error || result.signal) {
    // The unchanged fixture deliberately calls app.exit(1) after a reported
    // failure. Dropping that trace would hide progress past module evaluation;
    // accepting completed markers here would instead hide post-report crashes.
    if (result.status === 1 && !result.error && !result.signal && parsed && isDeclaredFailure(value)) {
      return { ...value, exitCode: 1 };
    }
    throw new Error(`the electron.mbt run emitted an observation but did not exit cleanly (status=${result.status}, signal=${result.signal || result.error?.signal || 'none'})`);
  }
  if (!parsed) throw new Error('the electron.mbt run emitted a malformed or oversized observation');
  return value;
}

module.exports = { parseCandidateObservation };
