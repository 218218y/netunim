# Completion work, 2026-10-15

The supplied V6 review is a useful inventory, not evidence that every listed
change is required. Work is based on the current main source and its tests.
Existing Main/Shared V2, Bank/Credit refresh, Document search and provider policy
boundaries are preserved. Broad deployment checks run on GitHub for each stage.

1. **Persistence and Main ownership.** Extract Kupa local commit, publication,
   file mirror and adoption. Separate Main save and remote adoption owners in
   both apps, bind browser authority at composition, and preserve decision
   fixtures plus accepted-work and race coverage.
2. **Business and persisted Calendar boundaries.** Validate persisted queue and
   display records before business authority, preserve malformed durable work,
   and extract focused editor/financial commands where current code proves a
   separate responsibility. Add malformed-input and race tests with each change.
3. **Resource lifetime and contracts.** Give backup native file selection,
   reading and downloads an explicit owner. Extend strict implementation and
   negative-consumer coverage across the new transaction/resource boundaries,
   including mutation checks. Record remaining release work precisely.

Each stage is a separate branch/PR and is merged only after its branch full
verification succeeds. After merging, work immediately proceeds to the next
stage without waiting for a duplicate run on main. Live Bank/Credit providers,
physical two-computer tests and production deployment are separate from CI.

Stage 1 merged as PR #184 after the exact branch push passed all CI groups and
Windows contracts. Its implementation is documented in KUPA_PERSISTENCE_OWNERS.md
and MAIN_SYNC_COMPOSITION.md. Stage 2 evidence and authority boundaries are in
CALENDAR_PERSISTED_CONTRACTS.md and FINANCE_EDIT_COMMANDS.md.

Stage 2 merged as PR #185 after its exact branch push passed the full gate.
Stage 3 implements the native resource and critical caller contracts described
in BACKUP_BROWSER_OWNERSHIP.md. It also fences cloud backup publication across
account replacement, a concrete neighboring gap found in the current code.

The three implementation slices close the targeted persistence, Main sync,
Calendar, Finance-edit and backup-resource boundaries. The next separate slices
remain Morning/customer orchestration, other business/RPC and journal/lease
caller contracts, Document Bridge runtime/CLI inventory, measured startup,
compatibility inventory and final readability/release validation. Existing
Bank/Credit provider policies have not been rewritten.

Document Bridge remainder, measured cold startup/lazy loading, compatibility
retirement and broad formatting remain later work; they should not be inferred
complete from these three stages. Lazy loading needs measured startup evidence
and an offline/PWA ordering gate first.

## Continuation stages

4. Morning issued-document completion and recovery-decision commands: preserve
   reservation/issuance/application policy and separate explicit decision
   ownership. Keep modal admission and accepted-work drain at composition.
5. Extend transaction and financial caller contracts from `unknown` through
   validated authority, with malformed input and negative implementation tests.
6. Complete concrete Document Bridge runtime/inventory/diagnostics boundaries,
   preserving provider/search/maintenance policy and Windows installation gates.

These are the next three independently verified and merged slices. Measured
startup, compatibility inventory and final release validation remain separate.
