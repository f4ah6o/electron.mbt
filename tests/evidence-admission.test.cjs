'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEvidence } = require('../scripts/evidence-admission.cjs');

function evidence() {
  return {
    schema: 2,
    evidenceId: 'ev-2026-10-17-0001',
    identity: {
      runId: 'run-1', attempt: 1, job: 'adapted-native-ingress',
      collectedAt: '2026-10-17T20:00:00Z', artifactDigest: 'sha256:artifact',
    },
    profile: {
      profileId: 'electron-nodeless-adapted-v1',
      profileHash: 'sha256:profile',
      inputMode: 'ts-build',
      preloadMode: 'generated-adapter',
      dependencyAdaptations: [{ id: 'updater-import', hash: 'sha256:adapter' }],
      adaptationManifestHash: 'sha256:adaptation',
      comparisonMode: 'adapted',
    },
    source: {
      repoSha: 'a'.repeat(40), tree: 'sha256:tree', fixtureHash: 'sha256:fixture',
      appCommit: 'b'.repeat(40), mainHash: 'sha256:main', preloadHash: 'sha256:preload',
      assetsHash: 'sha256:assets', lockHash: 'sha256:lock', buildHash: 'sha256:build',
      adapterHash: 'sha256:adapter',
    },
    candidate: {
      runtimeCommit: 'c'.repeat(40), compiledCoreHash: 'sha256:core',
      nativeBinaryHash: 'sha256:native', engineSource: 'quickjs-2026-06-04',
      buildFlags: ['-O2'],
    },
    oracle: {
      electronVersion: '44.7.0', sourceCommit: 'd'.repeat(40),
      embeddedNodeVersion: '24.21.0', binaryHash: 'sha256:oracle',
    },
    environment: {
      os: 'macOS 26.5', arch: 'arm64', sdk: '26.5', webViewVersion: 'WebKit 1',
      guiAvailable: true, display: 'main',
    },
    execution: {
      command: 'electron-mbt verify', argv: ['verify', 'moji'], exitCode: 0,
      signal: null, timeout: false, startedAt: '2026-10-17T20:00:01Z',
      finishedAt: '2026-10-17T20:00:02Z', driverScope: 'native-ingress',
    },
    observations: [
      { stepId: 'sender-main-frame', status: 'observed', value: { mainFrame: true } },
      { stepId: 'handler-count-denied', status: 'observed', value: 0 },
    ],
    verdict: {
      harness: 'completed', semantic: 'equivalent', supportedScope: 'native-ingress',
      gate: 'satisfied', missingEvidence: [], compatible: false,
    },
    integrity: {
      sourceHashBefore: 'sha256:before', sourceHashAfter: 'sha256:before',
      rawLogHash: 'sha256:log', reportHash: 'sha256:report', normalizationId: null,
    },
  };
}

test('a complete same-profile evidence bundle is admitted without compatibility', () => {
  const result = validateEvidence(evidence(), {
    profileId: 'electron-nodeless-adapted-v1',
    sourceHash: 'sha256:fixture',
    candidateHash: 'sha256:core',
    driverScope: 'native-ingress',
  });
  assert.deepEqual(result, { ok: true, problems: [] });
  assert.equal(evidence().verdict.compatible, false);
});

test('timeout and signal prevent a completed equivalent verdict even with a rejected observation', () => {
  const value = evidence();
  value.execution.timeout = true;
  value.execution.signal = 'SIGKILL';
  value.observations[0].status = 'rejected';
  const result = validateEvidence(value);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('must not time out')));
  assert.ok(result.problems.some((problem) => problem.includes('must not have a signal')));
});

for (const [label, change, expected] of [
  ['a compatibility claim', (value) => { value.verdict.compatible = true; }, 'verdict.compatible must remain false'],
  ['a satisfied gate with a not-run observation', (value) => { value.observations[0].status = 'not-run'; }, 'satisfied evidence contains not-run'],
  ['source drift', (value) => { value.integrity.sourceHashAfter = 'sha256:changed'; }, 'source hash changed'],
  ['a missing observation', (value) => { value.observations = []; }, 'observations is not a non-empty array'],
  ['a duplicate observation step', (value) => { value.observations[1].stepId = value.observations[0].stepId; }, 'duplicate observation stepId'],
  ['an unknown profile', (value) => { value.profile.profileId = 'unknown-v1'; }, 'profile.profileId'],
  ['adapted evidence claiming strict mode', (value) => { value.profile.comparisonMode = 'strict'; }, 'cannot claim strict comparison mode'],
  ['a nonzero completed harness', (value) => { value.execution.exitCode = 1; }, 'completed harness must have exitCode 0'],
  ['a timed-out completed harness', (value) => { value.execution.timeout = true; }, 'completed harness must not time out'],
  ['a signaled completed harness', (value) => { value.execution.signal = 'SIGKILL'; }, 'completed harness must not have a signal'],
  ['an equivalent verdict after a failed harness', (value) => { value.verdict.harness = 'failed'; value.verdict.gate = 'open'; }, 'equivalent semantics require a completed harness'],
  ['an equivalent verdict with a not-run observation at an open gate', (value) => { value.verdict.gate = 'open'; value.observations[0].status = 'not-run'; }, 'equivalent semantics contain not-run observation'],
  ['an expected-rejection verdict with a stalled observation', (value) => { value.verdict.semantic = 'expected-rejection'; value.verdict.gate = 'blocked'; value.observations[0].status = 'stalled'; }, 'expected-rejection semantics contain stalled observation'],
  ['a satisfied gate with expected-rejection semantics', (value) => { value.verdict.semantic = 'expected-rejection'; value.observations[0].status = 'expected-rejection'; }, 'satisfied evidence requires equivalent semantics'],
  ['a non-object dependency adaptation', (value) => { value.profile.dependencyAdaptations = [null]; }, 'dependencyAdaptations is not an array of objects'],
  ['a missing observed payload', (value) => { delete value.observations[0].value; }, 'carries no value, exception or detail'],
  ['an invalid observation exception', (value) => { value.observations[0].exception = {}; }, '.exception is not a string or null'],
  ['an invalid observation detail', (value) => { value.observations[0].detail = 'error'; }, '.detail is not an object or null'],
  ['a missing artifact digest', (value) => { value.identity.artifactDigest = ''; }, 'identity.artifactDigest'],
  ['a missing source hash', (value) => { value.source.mainHash = ''; }, 'source.mainHash'],
  ['a missing verdict', (value) => { delete value.verdict; }, 'verdict is not an object'],
  ['scope inflation', (value) => { value.verdict.supportedScope = 'release'; }, 'does not match execution.driverScope'],
]) {
  test(`evidence admission rejects ${label}`, () => {
    const value = evidence();
    change(value);
    const result = validateEvidence(value);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes(expected)), result.problems.join(' | '));
  });
}

test('profile scope does not expand to a declared driver scope outside that profile', () => {
  const value = evidence();
  value.profile = {
    profileId: 'moonbit-native-v1', profileHash: 'sha256:profile', inputMode: 'moonbit-source',
    preloadMode: 'none', dependencyAdaptations: [], comparisonMode: 'unit',
  };
  value.execution.driverScope = 'release';
  value.verdict.supportedScope = 'release';
  const result = validateEvidence(value);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('does not allow driverScope release')));
  value.execution.driverScope = 'unit';
  value.verdict.supportedScope = 'unit';
  assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
});

test('strict profile permits no dependency adaptations', () => {
  const value = evidence();
  value.profile.profileId = 'electron-nodeless-v1';
  value.profile.preloadMode = 'original';
  value.profile.comparisonMode = 'strict';
  assert.ok(validateEvidence(value).problems.some((problem) => problem.includes('does not allow dependency adaptations')));
  value.profile.dependencyAdaptations = [];
  assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
});

test('failed execution with a rejected observation remains valid failure evidence', () => {
  const value = evidence();
  value.execution.exitCode = null;
  value.execution.signal = 'SIGKILL';
  value.execution.timeout = true;
  value.observations[0] = { stepId: 'sender-main-frame', status: 'rejected', exception: 'unsupported' };
  value.verdict.harness = 'failed';
  value.verdict.semantic = 'diverged';
  value.verdict.gate = 'blocked';
  assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
});

test('completed expected rejection remains valid negative-test evidence', () => {
  const value = evidence();
  value.observations[0] = { stepId: 'sender-main-frame', status: 'expected-rejection', detail: { reason: 'denied' } };
  value.verdict.semantic = 'expected-rejection';
  value.verdict.gate = 'blocked';
  assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
});

test('equivalent observed exceptions and rejected observations remain valid comparison evidence', () => {
  const value = evidence();
  value.observations[0] = { stepId: 'sender-main-frame', status: 'observed', exception: 'SecurityError' };
  value.observations[1] = { stepId: 'handler-count-denied', status: 'rejected', exception: 'SecurityError' };
  assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
});

test('desktop native-probe is distinct from native-ingress', () => {
  const value = evidence();
  value.profile = {
    profileId: 'desktop-core-v1', profileHash: 'sha256:profile', inputMode: 'original-cjs',
    preloadMode: 'original', dependencyAdaptations: [], comparisonMode: 'strict',
  };
  value.execution.driverScope = 'native-probe';
  value.verdict.supportedScope = 'native-probe';
  assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
  value.execution.driverScope = 'native-ingress';
  value.verdict.supportedScope = 'native-ingress';
  assert.ok(validateEvidence(value).problems.some((problem) => problem.includes('does not allow driverScope native-ingress')));
  const schema = require('../compatibility/evidence-schema-v2.json');
  assert.ok(schema.properties.execution.properties.driverScope.enum.includes('native-probe'));
  assert.ok(schema.properties.verdict.properties.supportedScope.enum.includes('native-probe'));
});

for (const scope of ['unit', 'kernel']) {
  test(`unit comparison is admitted at ${scope} scope`, () => {
    const value = evidence();
    value.profile.comparisonMode = 'unit';
    value.execution.driverScope = scope;
    value.verdict.supportedScope = scope;
    assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
  });
}

for (const scope of ['native-probe', 'native-ingress', 'app-scenario', 'release']) {
  test(`unit comparison cannot claim ${scope} scope`, () => {
    const value = evidence();
    if (scope === 'native-probe') {
      value.profile.profileId = 'desktop-core-v1';
      value.profile.inputMode = 'original-cjs';
      value.profile.preloadMode = 'original';
      value.profile.dependencyAdaptations = [];
    }
    value.profile.comparisonMode = 'unit';
    value.execution.driverScope = scope;
    value.verdict.supportedScope = scope;
    const result = validateEvidence(value);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes(`unit comparisonMode does not allow driverScope ${scope}`)));
  });
}

test('negative comparison cannot satisfy a gate even with equivalent semantics', () => {
  const value = evidence();
  value.profile.comparisonMode = 'negative';
  const result = validateEvidence(value);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('negative comparisonMode cannot satisfy a gate')));
  for (const gate of ['open', 'blocked']) {
    value.verdict.gate = gate;
    assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
    value.verdict.semantic = 'expected-rejection';
    assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
    value.verdict.semantic = 'equivalent';
  }
});

test('not-run evidence and null observed values remain distinguishable from missing data', () => {
  const value = evidence();
  value.observations[0] = { stepId: 'sender-main-frame', status: 'not-run' };
  value.observations[1].value = null;
  value.verdict.harness = 'not-run';
  value.verdict.semantic = 'not-run';
  value.verdict.gate = 'open';
  assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
  value.observations[1] = { stepId: 'handler-count-denied', status: 'observed', exception: null, detail: null };
  assert.deepEqual(validateEvidence(value), { ok: true, problems: [] });
});

for (const observations of [{}, [null]]) {
  test('malformed observations return a rejection without throwing', () => {
    const value = evidence();
    value.observations = observations;
    const result = validateEvidence(value);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('observation')));
  });
}

for (const [label, change, expected] of [
  ['inputMode', (value, bad) => { value.profile.inputMode = bad; }, {}],
  ['preloadMode', (value, bad) => { value.profile.preloadMode = bad; }, {}],
  ['driverScope', (value, bad) => { value.profile.comparisonMode = 'unit'; value.execution.driverScope = bad; }, {}],
  ['stepId', (value, bad) => { value.observations[0].stepId = bad; value.observations[0].status = 'not-run'; }, {}],
  ['supportedScope', (value, bad) => { value.verdict.supportedScope = bad; }, {}],
  ['profileId', (value, bad) => { value.profile.profileId = bad; }, { profileId: 'desktop-core-v1' }],
  ['fixtureHash', (value, bad) => { value.source.fixtureHash = bad; }, { sourceHash: 'sha256:fixture' }],
  ['compiledCoreHash', (value, bad) => { value.candidate.compiledCoreHash = bad; }, { candidateHash: 'sha256:core' }],
  ['expected profileId', (value, bad) => {}, { profileId: { toString: null } }],
  ['expected sourceHash', (value, bad) => {}, { sourceHash: { toString: null } }],
  ['expected candidateHash', (value, bad) => {}, { candidateHash: { toString: null } }],
  ['expected driverScope', (value, bad) => {}, { driverScope: { toString: null } }],
]) {
  test(`malformed ${label} with a non-callable toString is rejected without throwing`, () => {
    const value = evidence();
    change(value, JSON.parse('{"toString":null}'));
    const result = validateEvidence(value, expected);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('{"toString":null}')), result.problems.join(' | '));
  });
}

test('expected profile, source, candidate and driver scope are enforced', () => {
  const value = evidence();
  const result = validateEvidence(value, {
    profileId: 'electron-nodeless-v1',
    sourceHash: 'sha256:other',
    candidateHash: 'sha256:other-core',
    driverScope: 'release',
  });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('expected electron-nodeless-v1')));
  assert.ok(result.problems.some((problem) => problem.includes('source.fixtureHash')));
  assert.ok(result.problems.some((problem) => problem.includes('candidate.compiledCoreHash')));
  assert.ok(result.problems.some((problem) => problem.includes('execution.driverScope')));
});
