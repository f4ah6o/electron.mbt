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

for (const [label, change, expected] of [
  ['a compatibility claim', (value) => { value.verdict.compatible = true; }, 'verdict.compatible must remain false'],
  ['a satisfied gate with a not-run observation', (value) => { value.observations[0].status = 'not-run'; }, 'satisfied evidence contains not-run'],
  ['source drift', (value) => { value.integrity.sourceHashAfter = 'sha256:changed'; }, 'source hash changed'],
  ['a missing observation', (value) => { value.observations = []; }, 'observations is not a non-empty array'],
  ['a duplicate observation step', (value) => { value.observations[1].stepId = value.observations[0].stepId; }, 'duplicate observation stepId'],
  ['an unknown profile', (value) => { value.profile.profileId = 'unknown-v1'; }, 'profile.profileId'],
  ['adapted evidence claiming strict mode', (value) => { value.profile.comparisonMode = 'strict'; }, 'cannot claim strict comparison mode'],
  ['a nonzero completed harness', (value) => { value.execution.exitCode = 1; }, 'completed harness must have exitCode 0'],
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
