'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}
function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}
function buildMarkdown() {
  const readiness = readJson('compatibility/reports/preview-readiness.json');
  const manifest = readJson('compatibility/manifest.json');
  const gates = [
    ['G0', 'profile / authority / inventory / governance', readiness.gates.G0,
      '`runtime-profiles-v1.json`, app closures, SBOM', 'functional preload bridge; full app scenario'],
    ['G1', 'QuickJS engine / CJS / native supervisor', readiness.gates.G1,
      '`runtime/runner`, CJS fixture graph, supervisor window/load/event', 'crash restart; general event queue; full app scenario'],
    ['G2', 'adapted Node-less runtime', readiness.gates.G2,
      '`electron-nodeless-adapted-v1` contract, generated page adapter, snapshot-scoped custom scheme, real Moji renderer boot', 'Moji preload IPC; main user-file grants; updater/zlib behavior; strict profile'],
    ['G3', 'real-app acceptance', readiness.gates.G3,
      'pinned app records and M1 boot blocker', 'full Moji/jmd app scenarios; IME/focus/AX; security/fault'],
    ['G4', 'signed preview / distribution', readiness.gates.G4,
      'production closures and CycloneDX SBOM', 'signing, notarization, clean install, license policy'],
  ];
  const checks = readiness.checks.map(item => [item.id, `**${item.status}**`, item.detail]);
  const blockers = readiness.checks.filter(item => item.status === 'FAIL').map(item => item.id);
  const notRun = readiness.checks.filter(item => item.status === 'NOT_RUN').map(item => item.id);
  return `# G0–G4 status

Status: **${readiness.status}**. This report is generated from
\`compatibility/reports/preview-readiness.json\`; a PASS check is an invariant or
honest-record check, not app compatibility.

- \`compatible\`: \`${manifest.compatible}\`
- readiness checks: ${readiness.counts.pass} PASS / ${readiness.counts.fail} FAIL / ${readiness.counts.notRun} NOT RUN
- blocking checks: ${blockers.length ? blockers.map(id => `\`${id}\``).join(', ') : 'none'}
- NOT RUN checks: ${notRun.map(id => `\`${id}\``).join(', ')}

## Gates

${markdownTable(['Gate', 'Scope', 'Status', 'Recorded evidence', 'Remaining gate'], gates)}

## Checks

${markdownTable(['Check', 'Status', 'Detail'], checks)}

## Interpretation

- G0 is partial: the profile, app inventory, production closure and governance
  records exist, but there is no functional preload bridge or full app scenario.
- G1 is partial: the QuickJS engine, fixture CJS loader and MoonBit-native
  supervisor work; the general event queue, crash-after-ready restart and full
  app scenario remain open.
- G2, G3 and G4 are not acceptance-complete. The adapted Node-less renderer
  boots, but the original preload, main user-file grants, updater/zlib behavior, real app
  scenarios, signing/notarization, clean install and interactive checks are
  NOT RUN.
- No row is promoted to \`verified\`; \`compatible:false\` is intentional.

## Reproduce

\`\`\`sh
node scripts/preview-readiness.cjs       # exits 2 while NOT_READY
node scripts/gate-report.cjs
moon test --target js
moon test --target native
npm test
\`\`\`
`;
}
if (require.main === module) {
  const output = path.join(root, 'compatibility/reports/g0-g4.md');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, buildMarkdown());
  process.stdout.write(`${JSON.stringify({ ok: true, out: path.relative(root, output) })}\n`);
}
module.exports = { buildMarkdown };
