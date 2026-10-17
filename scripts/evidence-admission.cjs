'use strict';

const profiles = require('../compatibility/runtime-profiles-v1.json').profiles;

const PROFILE_IDS = Object.keys(profiles);
const INPUT_MODES = ['original-cjs', 'prepared-js', 'ts-build', 'moonbit-source'];
const PRELOAD_MODES = ['original', 'generated-adapter', 'none'];
const COMPARISON_MODES = ['strict', 'adapted', 'unit', 'negative'];
const SCOPES = ['unit', 'kernel', 'native-ingress', 'app-scenario', 'release'];
const HARNESS = ['completed', 'failed', 'not-run', 'invalid-evidence'];
const SEMANTIC = ['equivalent', 'diverged', 'expected-rejection', 'not-run'];
const OBSERVATION_STATUS = ['observed', 'rejected', 'expected-rejection', 'not-run', 'stalled'];
const GATES = ['open', 'blocked', 'satisfied'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function requireObject(value, name, problems) {
  if (!isObject(value)) {
    problems.push(`${name} is not an object`);
    return null;
  }
  return value;
}

function requireString(value, name, problems) {
  if (!isString(value)) problems.push(`${name} is not a non-empty string`);
}

function requireBoolean(value, name, problems) {
  if (typeof value !== 'boolean') problems.push(`${name} is not a boolean`);
}

function requireEnum(value, name, allowed, problems) {
  if (!allowed.includes(value)) problems.push(`${name} is ${JSON.stringify(value)}, expected ${allowed.join('|')}`);
}

// Admit a versioned evidence bundle for one profile/scope. This is an
// aggregation guard, not a replacement for the specialized baseline/probe
// readers; it can only reject claims, never promote a run to compatible.
function validateEvidence(evidence, expected = {}) {
  const problems = [];
  if (!isObject(evidence)) return { ok: false, problems: ['evidence is not an object'] };
  if (evidence.schema !== 2) problems.push(`schema is ${JSON.stringify(evidence.schema)}, expected 2`);
  requireString(evidence.evidenceId, 'evidenceId', problems);

  const identity = requireObject(evidence.identity, 'identity', problems);
  if (identity) {
    requireString(identity.runId, 'identity.runId', problems);
    if (!Number.isInteger(identity.attempt) || identity.attempt < 1) problems.push('identity.attempt is not a positive integer');
    requireString(identity.job, 'identity.job', problems);
    requireString(identity.collectedAt, 'identity.collectedAt', problems);
    requireString(identity.artifactDigest, 'identity.artifactDigest', problems);
  }

  const profile = requireObject(evidence.profile, 'profile', problems);
  if (profile) {
    requireEnum(profile.profileId, 'profile.profileId', PROFILE_IDS, problems);
    requireString(profile.profileHash, 'profile.profileHash', problems);
    requireEnum(profile.inputMode, 'profile.inputMode', INPUT_MODES, problems);
    requireEnum(profile.preloadMode, 'profile.preloadMode', PRELOAD_MODES, problems);
    if (!Array.isArray(profile.dependencyAdaptations)) problems.push('profile.dependencyAdaptations is not an array');
    requireEnum(profile.comparisonMode, 'profile.comparisonMode', COMPARISON_MODES, problems);
    if (PROFILE_IDS.includes(profile.profileId)) {
      const declared = profiles[profile.profileId];
      if (!declared.inputMode.includes(profile.inputMode)) problems.push(`profile ${profile.profileId} does not allow inputMode ${profile.inputMode}`);
      if (!declared.preloadMode.includes(profile.preloadMode)) problems.push(`profile ${profile.profileId} does not allow preloadMode ${profile.preloadMode}`);
    }
    if (profile.profileId === 'electron-nodeless-v1' && profile.comparisonMode !== 'strict') {
      problems.push('the strict profile requires comparisonMode strict');
    }
    if (profile.profileId === 'electron-nodeless-adapted-v1' && profile.comparisonMode === 'strict') {
      problems.push('adapted evidence cannot claim strict comparison mode');
    }
  }

  const source = requireObject(evidence.source, 'source', problems);
  if (source) {
    for (const key of ['repoSha', 'tree', 'fixtureHash', 'mainHash', 'preloadHash', 'assetsHash']) {
      requireString(source[key], `source.${key}`, problems);
    }
    for (const key of ['appCommit', 'lockHash', 'buildHash', 'adapterHash']) {
      if (source[key] !== null && source[key] !== undefined) requireString(source[key], `source.${key}`, problems);
    }
  }

  const candidate = requireObject(evidence.candidate, 'candidate', problems);
  if (candidate) {
    for (const key of ['runtimeCommit', 'compiledCoreHash', 'nativeBinaryHash', 'engineSource']) {
      requireString(candidate[key], `candidate.${key}`, problems);
    }
    if (candidate.buildFlags !== undefined && !isStringArray(candidate.buildFlags)) problems.push('candidate.buildFlags is not an array of strings');
  }

  const oracle = requireObject(evidence.oracle, 'oracle', problems);
  if (oracle) {
    for (const key of ['electronVersion', 'sourceCommit', 'embeddedNodeVersion', 'binaryHash']) {
      requireString(oracle[key], `oracle.${key}`, problems);
    }
  }

  const environment = requireObject(evidence.environment, 'environment', problems);
  if (environment) {
    for (const key of ['os', 'arch', 'sdk', 'webViewVersion']) requireString(environment[key], `environment.${key}`, problems);
    requireBoolean(environment.guiAvailable, 'environment.guiAvailable', problems);
  }

  const execution = requireObject(evidence.execution, 'execution', problems);
  if (execution) {
    requireString(execution.command, 'execution.command', problems);
    if (!isStringArray(execution.argv)) problems.push('execution.argv is not an array of strings');
    if (execution.exitCode !== null && !Number.isInteger(execution.exitCode)) problems.push('execution.exitCode is not an integer or null');
    if (execution.signal !== null && typeof execution.signal !== 'string') problems.push('execution.signal is not a string or null');
    requireBoolean(execution.timeout, 'execution.timeout', problems);
    requireString(execution.startedAt, 'execution.startedAt', problems);
    requireString(execution.finishedAt, 'execution.finishedAt', problems);
    requireEnum(execution.driverScope, 'execution.driverScope', SCOPES, problems);
  }

  if (!Array.isArray(evidence.observations) || evidence.observations.length === 0) {
    problems.push('observations is not a non-empty array');
  } else {
    const steps = new Set();
    for (const observation of evidence.observations) {
      if (!isObject(observation)) { problems.push('observation is not an object'); continue; }
      requireString(observation.stepId, 'observation.stepId', problems);
      if (steps.has(observation.stepId)) problems.push(`duplicate observation stepId ${observation.stepId}`);
      steps.add(observation.stepId);
      requireEnum(observation.status, `observation ${observation.stepId}.status`, OBSERVATION_STATUS, problems);
      if (observation.status === 'observed' || observation.status === 'rejected' || observation.status === 'expected-rejection') {
        if (observation.value === undefined && observation.exception === undefined && observation.detail === undefined) {
          problems.push(`observation ${observation.stepId} carries no value, exception or detail`);
        }
      }
    }
  }

  const verdict = requireObject(evidence.verdict, 'verdict', problems);
  if (verdict) {
    requireEnum(verdict.harness, 'verdict.harness', HARNESS, problems);
    requireEnum(verdict.semantic, 'verdict.semantic', SEMANTIC, problems);
    requireEnum(verdict.supportedScope, 'verdict.supportedScope', SCOPES, problems);
    requireEnum(verdict.gate, 'verdict.gate', GATES, problems);
    if (!isStringArray(verdict.missingEvidence)) problems.push('verdict.missingEvidence is not an array of strings');
    if (verdict.compatible !== false) problems.push('verdict.compatible must remain false');
    if (execution && verdict.supportedScope !== execution.driverScope) {
      problems.push(`verdict.supportedScope ${verdict.supportedScope} does not match execution.driverScope ${execution.driverScope}`);
    }
    if (verdict.gate === 'satisfied') {
      if (verdict.harness !== 'completed') problems.push('satisfied evidence requires a completed harness');
      if (verdict.semantic !== 'equivalent' && verdict.semantic !== 'expected-rejection') problems.push('satisfied evidence requires equivalent or expected-rejection semantics');
      if (Array.isArray(verdict.missingEvidence) && verdict.missingEvidence.length > 0) problems.push('satisfied evidence has missing evidence');
      for (const observation of evidence.observations || []) {
        if (observation.status === 'not-run' || observation.status === 'stalled') {
          problems.push(`satisfied evidence contains ${observation.status} observation ${observation.stepId}`);
        }
      }
    }
    if (verdict.harness === 'completed' && execution && execution.exitCode !== 0) {
      problems.push('a completed harness must have exitCode 0');
    }
  }

  const integrity = requireObject(evidence.integrity, 'integrity', problems);
  if (integrity) {
    for (const key of ['sourceHashBefore', 'sourceHashAfter', 'rawLogHash', 'reportHash']) {
      requireString(integrity[key], `integrity.${key}`, problems);
    }
    if (integrity.sourceHashBefore !== integrity.sourceHashAfter) problems.push('source hash changed during evidence collection');
  }

  if (expected.profileId && profile && profile.profileId !== expected.profileId) {
    problems.push(`profile is ${profile.profileId}, expected ${expected.profileId}`);
  }
  if (expected.sourceHash && source && source.fixtureHash !== expected.sourceHash) {
    problems.push(`source.fixtureHash is ${source.fixtureHash}, expected ${expected.sourceHash}`);
  }
  if (expected.candidateHash && candidate && candidate.compiledCoreHash !== expected.candidateHash) {
    problems.push(`candidate.compiledCoreHash is ${candidate.compiledCoreHash}, expected ${expected.candidateHash}`);
  }
  if (expected.driverScope && execution && execution.driverScope !== expected.driverScope) {
    problems.push(`execution.driverScope is ${execution.driverScope}, expected ${expected.driverScope}`);
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { validateEvidence, PROFILE_IDS, SCOPES };
