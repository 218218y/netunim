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

Stage 4 merged as PR #187 after the exact branch head passed the full gate.
Stage 5 unifies and checks the real Finance lease RPC boundary and manual edit
consumer, including the proved Kupa release-body scope gap; see
FINANCE_TRANSACTION_AUTHORITY.md. Unrelated journal/provider policies remain.

Stage 5 merged as PR #188 after its exact branch push passed the full gate.
Stage 6 extracts Document Bridge runtime files, scheduled-task diagnostics,
installation diagnostics, inventory reconciliation and the installer stop/check
command, plus the Windows process platform shared with native preview, with preserved policy and native HTTP/index/Windows packaging evidence.
See DOCUMENT_BRIDGE_RUNTIME_BOUNDARIES.md. The listener drops from 60,879 to
40,380 normalized source bytes. Existing provider and search policies remain.

The continuation's three stages are now implemented. Measured startup and
selective lazy loading, the remaining journal/business contracts, compatibility
classification, final readability and live/two-machine release validation remain
future work, not completed claims of this continuation.

7. Measure native startup before selecting lazy boundaries. The first bounded
   timeline, static-vs-dynamic ESM audit, source/timing budgets and uninstrumented
   cold/cached/offline browser gate are documented in STARTUP_MEASUREMENT.md.
   Initial measurements identify module discovery/fetch scheduling as the larger
   interval on this machine; they do not justify lazy Storage/Auth/V2 recovery.

Stage 7 merged as PR #190 after full branch verification. Stage 8 defers the four
document viewer implementations behind a captured selection proof and isolates
late viewer cleanup in private mounts; see DOCUMENT_PREVIEW_LOADING.md. Native
offline first-use and account privacy gates accompany the smaller eager graph.

Stage 8 merged as PR #191 after its exact branch head passed all CI groups.
Stage 9 checks the actual independent-workbook RPC/backup boundary and fences
held replies by login epoch before they can acknowledge durable work. See
SPREADSHEET_TRANSACTION_AUTHORITY.md for SQL policy, retained-flight and native
IndexedDB/reload evidence. Compatibility inventory, remaining journal callers,
shell composition and final readability/live-provider/two-machine release work
remain separate; these stages do not claim the entire release is finished.
