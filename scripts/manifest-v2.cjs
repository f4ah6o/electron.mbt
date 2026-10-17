'use strict';

const PROFILE_IDS = [
  'desktop-core-v1',
  'electron-nodeless-v1',
  'electron-nodeless-adapted-v1',
  'moonbit-native-v1',
];
const ROW_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const IMPLEMENTATION = ['planned', 'partial', 'implemented', 'unsupported'];
const VERIFICATION = ['not-run', 'invalid-evidence', 'failed', 'passed'];
const GATES = ['open', 'blocked', 'satisfied'];
const SCOPE = ['unit', 'kernel', 'native-ingress', 'app-scenario', 'release'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scopeLevelFor(rowId) {
  if (rowId === 'A' || rowId === 'B' || rowId === 'D' || rowId === 'H') return ['kernel'];
  if (rowId === 'C' || rowId === 'E' || rowId === 'F' || rowId === 'G') return ['native-ingress'];
  if (rowId === 'I') return ['release'];
  if (rowId === 'J') return ['app-scenario'];
  throw new Error(`unknown acceptance row ${rowId}`);
}

function legacyStatus(status, evidence) {
  if (status === 'planned') return { implementation: 'planned', verification: 'not-run', gate: 'open' };
  if (status === 'partial') return { implementation: 'partial', verification: 'not-run', gate: 'open' };
  if (status === 'unsupported') return { implementation: 'unsupported', verification: 'not-run', gate: 'open' };
  if (status === 'verified') {
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new Error('a verified schema-1 row must carry evidence before migration');
    }
    return { implementation: 'implemented', verification: 'passed', gate: 'satisfied' };
  }
  throw new Error(`unknown schema-1 row status: ${status}`);
}

// Migrate the schema-1 manifest without changing its claims. The migration is
// deliberately lossless for rows/tests/evidence/gaps and keeps compatible:false.
function migrateManifestV1(manifest, profiles) {
  if (!isObject(manifest) || manifest.schema !== 1) throw new Error('expected a schema-1 manifest');
  if (!isObject(profiles) || !isObject(profiles.profiles)) throw new Error('expected a runtime profile contract');
  for (const id of PROFILE_IDS) {
    if (!isObject(profiles.profiles[id])) throw new Error(`missing profile ${id}`);
  }
  if (!Array.isArray(manifest.rows)) throw new Error('manifest rows must be an array');
  const seen = new Set();
  const rows = manifest.rows.map((row) => {
    if (!isObject(row) || typeof row.id !== 'string' || !ROW_IDS.includes(row.id)) {
      throw new Error('manifest row has an unknown acceptance id');
    }
    if (seen.has(row.id)) throw new Error(`duplicate acceptance row ${row.id}`);
    seen.add(row.id);
    const state = legacyStatus(row.status, row.evidence);
    return {
      id: row.id,
      profile: 'desktop-core-v1',
      area: row.scope,
      scopeLevel: scopeLevelFor(row.id),
      ...state,
      tests: Array.isArray(row.tests) ? [...row.tests] : [],
      evidence: Array.isArray(row.evidence) ? [...row.evidence] : [],
      gap: row.gap,
    };
  });
  for (const id of ROW_IDS) if (!seen.has(id)) throw new Error(`missing acceptance row ${id}`);
  return {
    schema: 2,
    compatible: false,
    profiles: clone(profiles.profiles),
    rows,
    gates: clone(manifest.gates || {}),
    versions: clone(manifest.versions || {}),
    limits: clone(manifest.limits || {}),
    valueProfile: clone(manifest.valueProfile || {}),
    unsupported: Array.isArray(manifest.unsupported) ? [...manifest.unsupported] : [],
    migratedFrom: {
      schema: 1,
      profile: manifest.profile,
      milestone: manifest.milestone,
    },
    note: 'Schema-1 migration. The active CLI still reads compatibility/manifest.json until the native CLI migration is implemented.',
  };
}

function validateManifestV2(value) {
  const problems = [];
  if (!isObject(value)) return { ok: false, problems: ['manifest v2 is not an object'] };
  if (value.schema !== 2) problems.push(`schema is ${JSON.stringify(value.schema)}, expected 2`);
  if (value.compatible !== false) problems.push('compatible must remain false');
  if (!isObject(value.profiles)) {
    problems.push('profiles is not an object');
  } else {
    for (const id of PROFILE_IDS) {
      const profile = value.profiles[id];
      if (!isObject(profile)) {
        problems.push(`missing profile ${id}`);
        continue;
      }
      if (profile.compatible !== false) problems.push(`profile ${id} must keep compatible:false`);
      if (!IMPLEMENTATION.includes(profile.implementation)) problems.push(`profile ${id} has invalid implementation`);
      if (!VERIFICATION.includes(profile.verification)) problems.push(`profile ${id} has invalid verification`);
      if (!GATES.includes(profile.gate)) problems.push(`profile ${id} has invalid gate`);
      if (profile.gate === 'satisfied' && profile.verification !== 'passed') {
        problems.push(`profile ${id} is satisfied without passed verification`);
      }
      if (profile.gate === 'blocked' && (typeof profile.blockedReason !== 'string' || profile.blockedReason.length === 0)) {
        problems.push(`profile ${id} is blocked without a reason`);
      }
      if (!isStringArray(profile.inputMode) || profile.inputMode.length === 0) problems.push(`profile ${id} has invalid inputMode`);
      if (!isStringArray(profile.preloadMode) || profile.preloadMode.length === 0) problems.push(`profile ${id} has invalid preloadMode`);
      if (!isStringArray(profile.scope) || profile.scope.length === 0) problems.push(`profile ${id} has invalid scope`);
    }
  }
  if (!Array.isArray(value.rows)) {
    problems.push('rows is not an array');
  } else {
    const seen = new Set();
    for (const row of value.rows) {
      if (!isObject(row)) { problems.push('row is not an object'); continue; }
      if (!ROW_IDS.includes(row.id)) problems.push(`unknown row id ${JSON.stringify(row.id)}`);
      if (seen.has(row.id)) problems.push(`duplicate row ${row.id}`);
      seen.add(row.id);
      if (!PROFILE_IDS.includes(row.profile)) problems.push(`row ${row.id} has unknown profile`);
      if (typeof row.area !== 'string' || row.area.length === 0) problems.push(`row ${row.id} has no area`);
      if (!isStringArray(row.scopeLevel) || !row.scopeLevel.every((level) => SCOPE.includes(level))) {
        problems.push(`row ${row.id} has invalid scopeLevel`);
      }
      if (!IMPLEMENTATION.includes(row.implementation)) problems.push(`row ${row.id} has invalid implementation`);
      if (!VERIFICATION.includes(row.verification)) problems.push(`row ${row.id} has invalid verification`);
      if (!GATES.includes(row.gate)) problems.push(`row ${row.id} has invalid gate`);
      if (!isStringArray(row.tests)) problems.push(`row ${row.id} has invalid tests`);
      if (!isStringArray(row.evidence)) problems.push(`row ${row.id} has invalid evidence`);
      if (typeof row.gap !== 'string' || row.gap.length === 0) problems.push(`row ${row.id} has no gap`);
      if (row.verification === 'passed' && (!Array.isArray(row.evidence) || row.evidence.length === 0)) {
        problems.push(`row ${row.id} is passed without evidence`);
      }
      if (row.gate === 'satisfied' && row.verification !== 'passed') {
        problems.push(`row ${row.id} is satisfied without passed verification`);
      }
    }
    for (const id of ROW_IDS) if (!seen.has(id)) problems.push(`missing row ${id}`);
  }
  if (!isObject(value.gates)) problems.push('gates is not an object');
  if (!isObject(value.versions)) problems.push('versions is not an object');
  if (!isObject(value.limits)) problems.push('limits is not an object');
  if (!isObject(value.valueProfile)) problems.push('valueProfile is not an object');
  return { ok: problems.length === 0, problems };
}

module.exports = {
  PROFILE_IDS,
  ROW_IDS,
  migrateManifestV1,
  validateManifestV2,
  scopeLevelFor,
};
