# Storage V2 focused completion audit

Baseline: `d11df895` (PRs #314-#319), followed by the Shared activation repair in
PR #320. This review deliberately changes only reproduced lifecycle failures.

## Confirmed failures and repairs

1. Shared recovery and cloud/local initialization exposed readiness before
   publication finished. PR #320 closes admission throughout activation, publishes
   success only afterwards, and retains durable data for same-store retries.
2. Shared publication after cloud adoption, ACK or a coordinated replacement could
   also throw while leaving readiness enabled. A real Journal/Memory DB adoption
   reproduced a subsequent write from an obsolete visible amount. All publication
   failures now use the same fail-closed state transition; durable ACKs and
   replacement checkpoints remain available for recovery.
3. Main retained its Journal using account identity alone. A generation refresh
   under the same account left readiness true and admitted an emergency write,
   although the captured commit predicate later rejected its IDB commit. Main now
   uses that existing predicate for admission/readiness and writer completion,
   claims the existing epoch with a fresh context after revocation, and fences
   writer read-only results and scheduled maintenance. Recovery closes admission
   while opening, and asynchronous cloud-state publication rechecks the current
   Journal, epoch, generation and readiness.

The second repair has seventeen new failing-before/passing-after regressions: six
Shared publication paths and eleven Main admission, initialization, recovery,
flush, cloud-state, production owner-binding and maintenance cases. They use the
real Journal and Memory DB; explicit promise gates control races. Native IDB and
process-crash suites remain part of the full CI gate.

## Seven-module lifecycle review

| Module | Result |
| --- | --- |
| `shared-checks-v2-runtime.js` | Repaired activation and later publication; retained store/epoch/generation fences and canonical durability queue. |
| `storage-v2-runtime.js` | Repaired Main generation authority and recovery admission; old maintenance tasks cannot affect reclaimed contexts. |
| `shared-checks-storage-v2.js` | Traced trust/admission through Journal guards, captured commit authority and atomic cloud checkpoint methods; no additional reproduced gap. |
| `storage-v2-boundary.js` | Retained post-recovery owner checks, exact boundary ID/phase validation and per-side checkpoint markers that make crash replay idempotent. |
| `storage-v2-bootstrap.js` | Retained frozen scope/group ID/plan hash proofs and database phase checks; no redundant authority mechanism added. |
| `storage-v2-local-birth.js` | Retained post-await owner checks, frozen source plan, phase/parity validation and durable-marker crash completion. |
| `storage-v2-detached-target.js` | Fixed-owner target runtimes remain separate from visible ownership; existing remote/plan parity and immutable RPC identity checks remain. |

Existing boundary/bootstrap/local-birth/detached-target/owner-transfer tests and
durability/commit-pressure tests were exercised with the repaired runtimes. No
Journal or Epoch is reset to repair readiness. A replacement explicitly requested
by a boundary still performs its original durable transition.

## Bounded static and financial decisions

A compiler probe adding Local Birth and Detached Target to the existing strict
program produced 62 diagnostics: 19 Local Birth, 40 Detached Target and 3 in its
Account Marker dependency. They require callback/plan/runtime contracts rather
than an isolated field annotation. These unchanged modules retain behavioral and
crash tests; no facade, suppression or broad conversion is justified in this
reliability repair.

The financial review traced MAX/CAL provider projections and Isracard's monthly
adapter into the already checked credit transaction/evidence contracts. Missing
amounts, pending status, billing dates and provider evidence retain their existing
runtime checks/tests. No new financial failure was established, so no provider
behavior or unchecked adapter is changed. The strict inventory remains 242
product roots plus 133 fixtures; 18 tracked Bridge modules retain `@ts-nocheck`.
This is a coverage boundary, not certification of every provider input.

TypeScript remains the single pinned 6.0.3 compiler. This round does not establish
current TS 7 release/API suitability and does not add another compiler.

## Operational evidence and verification limits

The native worker-event/NetLog collectors, redaction and always-upload CI steps
remain intact. Eleven local diagnostic/safety contracts passed. During PR #320,
run `40194893068`, Windows job `121173505840` recorded a LevelDB checksum mismatch
and deletion of the isolated `restore-process-orders` fixture after a hard kill.
The owned profile marker survived. PWA/release and worker-error evidence tests
in that job passed; Full Supabase acceptance also passed. The original Windows
artifact is retained as `12599288982`. This is new evidence of native profile
corruption, not evidence identifying a Service Worker product defect. A bounded
manual Windows rerun is appropriate; no automatic retries, timeout increases or
weakened assertion are introduced. Final CI outcomes are recorded on each PR.

Main/Shared persisted formats, RPC payloads, financial merge rules and owner
binding records are unchanged. Generated shared copies and release cache/header
identities are refreshed through `sync-assets`; Service Worker behavior is
unchanged. Eager totals are 1,891,298/2,511,475 source bytes (310/406 modules).
The lifecycle repair adds 771 bytes per app over PR #320. Source allowances add
1,000 bytes per app to 1,892,000/2,512,000; timing/module limits remain unchanged.

Strict checking, full ESLint, focused runtime regressions, source synchronization
and source budgets are verified locally. Full mutations, browsers, native IDB,
crash recovery, offline inventory, Windows and Supabase validation run in the
existing 15-job CI workflow. Both focused PRs require their full branch checks
before merging. Once these pass and both repairs reach main, the stopping
criterion for this hardening round is met; remaining provider/static work needs
new evidence rather than an automatic continuation of file conversions.
