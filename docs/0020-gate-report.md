# G0–G4 gate report

Status: **generated, NOT_READY**. `compatibility/reports/g0-g4.md` is generated
from `compatibility/reports/preview-readiness.json`; do not hand-edit the
report. Run:

```sh
node scripts/preview-readiness.cjs
node scripts/gate-report.cjs
```

The report preserves G0/G1/G2 as partial, G3 as NOT_RUN and G4 as partial. It
lists the two explicit FAIL checks (functional preload bridge and the Moji M1
boot) and the five NOT_RUN checks (adapted Moji runtime, Node-less Moji app
main, signing, clean install, interactive IME/focus/AX).

A PASS check means an invariant or honest record passed. It is not app
compatibility, a preview release or permission to flip `compatible:true`.
