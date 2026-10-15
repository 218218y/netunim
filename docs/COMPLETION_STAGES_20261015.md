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

Document Bridge remainder, measured cold startup/lazy loading, compatibility
retirement and broad formatting remain later work; they should not be inferred
complete from these three stages. Lazy loading needs measured startup evidence
and an offline/PWA ordering gate first.
