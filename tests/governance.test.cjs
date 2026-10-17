'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGovernance, loadDefault, DECISION_IDS, RISK_IDS } = require('../scripts/validate-governance.cjs');

function ledgers() {
  return structuredClone(loadDefault());
}

test('the checked-in governance ledgers are internally consistent', () => {
  const value = ledgers();
  const result = validateGovernance(value);
  assert.deepEqual(result, { ok: true, problems: [], warnings: [] });
  assert.deepEqual(value.decisions.decisions.map((item) => item.id), DECISION_IDS);
  assert.deepEqual(value.risks.risks.map((item) => item.id), RISK_IDS);
  assert.ok(value.components.components.length >= 8);
});

for (const [label, change, expected] of [
  ['a duplicate decision', (value) => { value.decisions.decisions.push(structuredClone(value.decisions.decisions[0])); }, 'duplicate decision DEC-01'],
  ['a missing decision', (value) => { value.decisions.decisions = value.decisions.decisions.filter((item) => item.id !== 'DEC-11'); }, 'missing decision DEC-11'],
  ['a decision invalid state', (value) => { value.decisions.decisions[0].state = 'done'; }, 'invalid state'],
  ['a blocked decision without blocked detail', (value) => { value.decisions.decisions[1].blocked = null; }, 'has no blocked detail'],
  ['an invented assignee', (value) => { value.decisions.decisions[0].assignee = 'someone'; }, 'invents an assignee'],
  ['a duplicate risk', (value) => { value.risks.risks.push(structuredClone(value.risks.risks[0])); }, 'duplicate risk R01'],
  ['a missing risk', (value) => { value.risks.risks = value.risks.risks.filter((item) => item.id !== 'R21'); }, 'missing risk R21'],
  ['a closed risk without fix', (value) => { value.risks.risks[0].status = 'closed'; value.risks.risks[0].fixSha = null; }, 'closed without a fix SHA'],
  ['a closed potential risk', (value) => { value.risks.risks[6].status = 'closed'; value.risks.risks[6].fixSha = 'abc'; value.risks.risks[6].regressionEvidence = ['test']; }, 'potential but closed'],
  ['a distributed unknown license', (value) => { const item = value.components.components.find((component) => component.id === 'electron-mbt-core'); item.releaseGate = 'open'; }, 'distributed with an unknown license'],
  ['a blocked component without reason', (value) => { const item = value.components.components.find((component) => component.id === 'quickjs'); item.blockedReason = ''; }, 'blocked without a reason'],
  ['a possible secret', (value) => { value.decisions.decisions[0].sourceRefs.push('token=abcdefghi'); }, 'possible secret material'],
]) {
  test(`governance validation rejects ${label}`, () => {
    const value = ledgers();
    change(value);
    const result = validateGovernance(value);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes(expected)), result.problems.join(' | '));
  });
}
