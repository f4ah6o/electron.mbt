'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DECISION_IDS = Array.from({ length: 11 }, (_, i) => `DEC-${String(i + 1).padStart(2, '0')}`);
const RISK_IDS = Array.from({ length: 21 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`);
const DECISION_STATES = ['proposed', 'accepted-for-design', 'blocked', 'superseded'];
const SOURCE_CLASSES = ['snapshot-fact', 'draft-design', 'proposal'];
const RISK_SEVERITY = ['P0', 'P1', 'P2'];
const RISK_EVIDENCE = ['reproduced', 'source-reviewed', 'potential'];
const RISK_STATUS = ['closed', 'mitigating', 'open', 'monitoring'];
const COMPONENT_KINDS = ['runtime', 'build-only', 'test-only', 'planned-adapter'];
const LICENSE_STATES = ['known', 'unknown'];
const RELEASE_GATES = ['open', 'blocked', 'satisfied'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateDecisions(value, problems) {
  if (!isObject(value) || value.schema !== 1 || !Array.isArray(value.decisions)) {
    problems.push('decisions.json must be schema 1 with a decisions array');
    return;
  }
  const seen = new Set();
  for (const decision of value.decisions) {
    if (!isObject(decision)) { problems.push('decision is not an object'); continue; }
    if (!DECISION_IDS.includes(decision.id)) problems.push(`unknown decision id ${JSON.stringify(decision.id)}`);
    if (seen.has(decision.id)) problems.push(`duplicate decision ${decision.id}`);
    seen.add(decision.id);
    if (!DECISION_STATES.includes(decision.state)) problems.push(`decision ${decision.id} has invalid state`);
    if (!SOURCE_CLASSES.includes(decision.sourceClass)) problems.push(`decision ${decision.id} has invalid sourceClass`);
    if (!isString(decision.ownerRole)) problems.push(`decision ${decision.id} has no ownerRole`);
    if (!isStringArray(decision.appliesTo)) problems.push(`decision ${decision.id} has invalid appliesTo`);
    if (!isStringArray(decision.sourceRefs)) problems.push(`decision ${decision.id} has invalid sourceRefs`);
    if (!Array.isArray(decision.history)) problems.push(`decision ${decision.id} has invalid history`);
    if (decision.assignee !== undefined && decision.assignee !== null) problems.push(`decision ${decision.id} invents an assignee`);
    if (decision.state === 'blocked') {
      if (!isObject(decision.blocked)) {
        problems.push(`blocked decision ${decision.id} has no blocked detail`);
      } else {
        for (const key of ['scope', 'reason', 'resumeCondition']) {
          if (!isString(decision.blocked[key])) problems.push(`decision ${decision.id} blocked.${key} is missing`);
        }
        if (!isStringArray(decision.blocked.requiredEvidence)) problems.push(`decision ${decision.id} blocked.requiredEvidence is invalid`);
      }
    } else if (decision.blocked !== null && decision.blocked !== undefined) {
      problems.push(`decision ${decision.id} is not blocked but carries blocked detail`);
    }
  }
  for (const id of DECISION_IDS) if (!seen.has(id)) problems.push(`missing decision ${id}`);
}

function validateRisks(value, problems) {
  if (!isObject(value) || value.schema !== 1 || !Array.isArray(value.risks)) {
    problems.push('risks.json must be schema 1 with a risks array');
    return;
  }
  const seen = new Set();
  for (const risk of value.risks) {
    if (!isObject(risk)) { problems.push('risk is not an object'); continue; }
    if (!RISK_IDS.includes(risk.id)) problems.push(`unknown risk id ${JSON.stringify(risk.id)}`);
    if (seen.has(risk.id)) problems.push(`duplicate risk ${risk.id}`);
    seen.add(risk.id);
    if (!RISK_SEVERITY.includes(risk.severity)) problems.push(`risk ${risk.id} has invalid severity`);
    if (!RISK_EVIDENCE.includes(risk.evidenceKind)) problems.push(`risk ${risk.id} has invalid evidenceKind`);
    if (!RISK_STATUS.includes(risk.status)) problems.push(`risk ${risk.id} has invalid status`);
    for (const key of ['trigger', 'stopScope', 'mitigation', 'residualRisk', 'ownerRole']) {
      if (!isString(risk[key])) problems.push(`risk ${risk.id} has no ${key}`);
    }
    if (risk.fixSha !== null && !isString(risk.fixSha)) problems.push(`risk ${risk.id} has invalid fixSha`);
    if (!isStringArray(risk.regressionEvidence)) problems.push(`risk ${risk.id} has invalid regressionEvidence`);
    if (risk.status === 'closed') {
      if (!isString(risk.fixSha)) problems.push(`risk ${risk.id} is closed without a fix SHA`);
      if (!Array.isArray(risk.regressionEvidence) || risk.regressionEvidence.length === 0) problems.push(`risk ${risk.id} is closed without regression evidence`);
      if (risk.evidenceKind === 'potential') problems.push(`risk ${risk.id} is potential but closed`);
    }
  }
  for (const id of RISK_IDS) if (!seen.has(id)) problems.push(`missing risk ${id}`);
}

function validateComponents(value, problems) {
  if (!isObject(value) || value.schema !== 1 || !Array.isArray(value.components)) {
    problems.push('components.json must be schema 1 with a components array');
    return;
  }
  const seen = new Set();
  for (const component of value.components) {
    if (!isObject(component)) { problems.push('component is not an object'); continue; }
    if (!isString(component.id)) { problems.push('component has no id'); continue; }
    if (seen.has(component.id)) problems.push(`duplicate component ${component.id}`);
    seen.add(component.id);
    if (!COMPONENT_KINDS.includes(component.kind)) problems.push(`component ${component.id} has invalid kind`);
    for (const key of ['source', 'version', 'updateOwnerRole']) {
      if (!isString(component[key])) problems.push(`component ${component.id} has no ${key}`);
    }
    if (component.hash !== null && !isString(component.hash)) problems.push(`component ${component.id} has invalid hash`);
    if (typeof component.distribution !== 'boolean') problems.push(`component ${component.id} has invalid distribution`);
    if (!RELEASE_GATES.includes(component.releaseGate)) problems.push(`component ${component.id} has invalid releaseGate`);
    if (!isObject(component.license)) {
      problems.push(`component ${component.id} has no license record`);
    } else {
      if (!LICENSE_STATES.includes(component.license.status)) problems.push(`component ${component.id} has invalid license.status`);
      if (component.license.status === 'known') {
        if (!isString(component.license.expression)) problems.push(`component ${component.id} known license has no expression`);
        if (!isString(component.license.source)) problems.push(`component ${component.id} known license has no source`);
      }
      if (component.license.status === 'unknown' && component.distribution === true && component.releaseGate !== 'blocked') {
        problems.push(`component ${component.id} is distributed with an unknown license but releaseGate is not blocked`);
      }
    }
    if (component.releaseGate === 'blocked' && !isString(component.blockedReason)) {
      problems.push(`component ${component.id} is blocked without a reason`);
    }
  }
}

function scanSecrets(value, at, problems) {
  const patterns = [/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/, /ghp_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9]{20,}/, /token\s*=\s*\S+/i];
  if (typeof value === 'string') {
    for (const pattern of patterns) {
      if (pattern.test(value)) problems.push(`possible secret material at ${at}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSecrets(item, `${at}[${index}]`, problems));
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) scanSecrets(child, `${at}.${key}`, problems);
  }
}

function validateGovernance({ decisions, risks, components }) {
  const problems = [];
  const warnings = [];
  validateDecisions(decisions, problems);
  validateRisks(risks, problems);
  validateComponents(components, problems);
  for (const [name, value] of Object.entries({ decisions, risks, components })) scanSecrets(value, name, problems);
  return { ok: problems.length === 0, problems, warnings };
}

function loadDefault() {
  const root = path.resolve(__dirname, '..');
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'compatibility', name), 'utf8'));
  return {
    decisions: read('decisions.json'),
    risks: read('risks.json'),
    components: read('components.json'),
  };
}

if (require.main === module) {
  try {
    const report = validateGovernance(loadDefault());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`ELECTRON_MBT_GOVERNANCE: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DECISION_IDS,
  RISK_IDS,
  validateGovernance,
  loadDefault,
};
