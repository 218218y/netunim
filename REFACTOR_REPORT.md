# Architectural refactor report

Date: 2026-08-27. Scope: both local sites; no deployment, production data change or SQL execution.

## Implemented structure

Both entrypoints are native ESM (100 bytes each). Business/UI functions are not exported to window.
Kupa has 61 modules under assets/js; Orders has 76. main.js is the composition root, not the application implementation.
Factories receive named state contexts and callbacks. Models and serialization/merge helpers are directly testable.
Core, state, storage, cloud, sync, UI and business-domain boundaries are described in ARCHITECTURE.txt.

All executable inline event attributes were removed from static HTML and generated HTML strings.
Explicit delegated action maps handle dynamic content; static controls use addEventListener.
Keyboard, focus/blur, modal draft protection, date series, propagation, drag/drop and bulk actions are tested.
Configuration is an explicit frozen module import. No framework, runtime package, bundler, eval or ESM window bridge was added.

Shared calendar/escaping/check-number/delegation source has deterministic identical site copies.
App-specific clone, money and date differences remain separate. Each site has its own complete offline shell.
The worker uses network-first, allowlisted shell caching and app-scoped cache cleanup; business requests are not cached.
Cache versions derive from asset content. script-src no longer permits unsafe-inline or unsafe-eval.
Escaping and selector safety were audited and checked with hostile values under the actual CSP.

## Root causes corrected with regression coverage

- Async boot/recovery could race the old fixed-delay test harness; tests now await appReady.
- Unsafe ephemeral Chromium ports caused intermittent navigation failures; the harness uses the dynamic port range.
- Kupa portable restore lacked foreign-format/future-schema rejection.
- Orders restore could overlook future metadata when a valid top-level version existed; malformed metadata/versions are rejected.
- Kupa merge/rebase could JSON.parse(undefined) for absent optional legacy fields; optional-value copying is explicit.
- Kupa offline cloud-mode saves persisted data without refreshing the visible list; the offline path now renders.
- Delegated drag start initially used the container as currentTarget; the actual row is now passed explicitly.
- Deployment self-check still searched the old monolith/global API; it now checks the lifecycle module.

The no-op Excel catchup wrapper, obsolete alias entrypoints and redundant strict-mode expression were removed
only after checking actual callers, action bindings and tests. Legacy backup metadata/migrations remain intact.
Legacy validation command wrappers are intentionally retained and forward to the canonical tests.

## Verification and measurements

The gate runs 14 suites: static, asset, deploy safety, Service Worker, modules/lint/direct tests,
smoke, events, security, workflows, native PWA, performance, data integrity, sync/recovery and financial invariants.
The direct Node suites contain 24 tests. Existing SQL/RPC/financial checks were retained.

New browser coverage exercises creation, editing, deletion, check deposit/clear, credit, cash, expenses,
supplier transactions, customer debts, service, inventory partial receipts/reservations, warehouse, notes,
file restore, draft guards, bulk controls and drag/drop. Native PWA tests run without module instrumentation,
verify every module is cached and recover real browser snapshots/pending after offline reload.
Two tabs in one browser profile verify the actual writer lock and unchanged storage in the secondary tab.

In-memory File System Access tests check verified writes, corruption, revision retention, permission denial,
serialized writes and preservation of existing folder data. No user folder is touched.
Repeated rendering of 1,000 rows eight times caused zero storage writes/RPC calls and no listener accumulation.
One measured run: Kupa mean 71 ms / maximum 74 ms; Orders mean 342 ms / maximum 488 ms.
These timings are local observations, not a performance guarantee. No speculative rendering cache was introduced.

Visual inspection: reviewed 1440x1000 Chromium screenshots of the Kupa dashboard and Orders supplier table
with synthetic records. RTL navigation, numbers, table controls and dashboard layout appeared intact.
This was screenshot inspection, not a manual live-Supabase or OS folder-picker session.

## Intentional limits and release checks

- Inline style attributes remain supported by style-src-attr. Inline script and style elements are prohibited.
- The installed PWA/browser must support native ESM and a secure context. file:// is unsupported.
- Web Locks protect supported browsers; the existing fallback for browsers without Web Locks is retained.
- Editor/controllers still coordinate form reads, mutations and saves; calculations and infrastructure are separated.
- No production account, Supabase/RLS, Access policy, real folder picker or mobile-device installation was exercised.
  An authorized release smoke test must cover those environment-specific integrations.
- No schema, RPC signature, backup filename, financial ownership contract or deployment target was changed.

The implementation has no temporary runtime bridge or monolithic application module. Details of running tests,
refreshing shared assets and deploying through the gate are in TESTING.txt and both DEPLOYMENT.txt files.

## File inventory

Existing files changed (M), added (A), removed (D):

```text
M	.gitignore
M	ARCHITECTURE.txt
M	TESTING.txt
M	netunim-kupa/DEPLOYMENT.txt
M	netunim-kupa/USAGE.txt
M	netunim-kupa/deploy_site.bat
M	netunim-kupa/site/_headers
M	netunim-kupa/site/assets/app.js
M	netunim-kupa/site/index.html
M	netunim-kupa/site/service-worker.js
M	netunim-kupa/site/supabase/config.js
M	netunim-orders/DEPLOYMENT.txt
M	netunim-orders/USAGE.txt
M	netunim-orders/deploy_site.bat
M	netunim-orders/site/_headers
M	netunim-orders/site/assets/app.js
M	netunim-orders/site/index.html
M	netunim-orders/site/service-worker.js
M	netunim-orders/site/supabase/config.js
M	tests/asset_contracts.py
M	tests/browser_harness.py
M	tests/run_all.py
M	tests/service_worker_contracts.py
M	tests/static_contracts.py
A	REFACTOR_REPORT.md
A	eslint.config.js
A	netunim-kupa/site/assets/js/cloud/auth.js
A	netunim-kupa/site/assets/js/cloud/transport.js
A	netunim-kupa/site/assets/js/core/dates.js
A	netunim-kupa/site/assets/js/core/money.js
A	netunim-kupa/site/assets/js/core/values.js
A	netunim-kupa/site/assets/js/domains/bank/model.js
A	netunim-kupa/site/assets/js/domains/bank/selectors.js
A	netunim-kupa/site/assets/js/domains/bank/view.js
A	netunim-kupa/site/assets/js/domains/cash/editor.js
A	netunim-kupa/site/assets/js/domains/cash/model.js
A	netunim-kupa/site/assets/js/domains/cash/selectors.js
A	netunim-kupa/site/assets/js/domains/cash/view.js
A	netunim-kupa/site/assets/js/domains/checks/editor.js
A	netunim-kupa/site/assets/js/domains/checks/model.js
A	netunim-kupa/site/assets/js/domains/checks/selectors.js
A	netunim-kupa/site/assets/js/domains/checks/view.js
A	netunim-kupa/site/assets/js/domains/credit/editor.js
A	netunim-kupa/site/assets/js/domains/credit/model.js
A	netunim-kupa/site/assets/js/domains/credit/selectors.js
A	netunim-kupa/site/assets/js/domains/credit/view.js
A	netunim-kupa/site/assets/js/domains/dashboard/view.js
A	netunim-kupa/site/assets/js/domains/expenses/editor.js
A	netunim-kupa/site/assets/js/domains/expenses/model.js
A	netunim-kupa/site/assets/js/domains/expenses/selectors.js
A	netunim-kupa/site/assets/js/domains/records/commands.js
A	netunim-kupa/site/assets/js/lifecycle.js
A	netunim-kupa/site/assets/js/main.js
A	netunim-kupa/site/assets/js/shared/calendar.js
A	netunim-kupa/site/assets/js/shared/check-series.js
A	netunim-kupa/site/assets/js/shared/events.js
A	netunim-kupa/site/assets/js/shared/html.js
A	netunim-kupa/site/assets/js/state/constants.js
A	netunim-kupa/site/assets/js/state/contexts.js
A	netunim-kupa/site/assets/js/state/normalization.js
A	netunim-kupa/site/assets/js/state/serialization.js
A	netunim-kupa/site/assets/js/state/validation.js
A	netunim-kupa/site/assets/js/storage/backup.js
A	netunim-kupa/site/assets/js/storage/browser.js
A	netunim-kupa/site/assets/js/storage/files.js
A	netunim-kupa/site/assets/js/storage/indexed-db.js
A	netunim-kupa/site/assets/js/storage/pending.js
A	netunim-kupa/site/assets/js/storage/persistence.js
A	netunim-kupa/site/assets/js/storage/tab-lock.js
A	netunim-kupa/site/assets/js/sync/checks-state.js
A	netunim-kupa/site/assets/js/sync/checks.js
A	netunim-kupa/site/assets/js/sync/document.js
A	netunim-kupa/site/assets/js/sync/merge-records.js
A	netunim-kupa/site/assets/js/sync/merge.js
A	netunim-kupa/site/assets/js/sync/pending.js
A	netunim-kupa/site/assets/js/sync/recovery.js
A	netunim-kupa/site/assets/js/ui/actions.js
A	netunim-kupa/site/assets/js/ui/backup.js
A	netunim-kupa/site/assets/js/ui/bulk.js
A	netunim-kupa/site/assets/js/ui/cloud.js
A	netunim-kupa/site/assets/js/ui/connection.js
A	netunim-kupa/site/assets/js/ui/date-editor.js
A	netunim-kupa/site/assets/js/ui/folders.js
A	netunim-kupa/site/assets/js/ui/modal.js
A	netunim-kupa/site/assets/js/ui/navigation.js
A	netunim-kupa/site/assets/js/ui/settings.js
A	netunim-kupa/site/assets/js/ui/status.js
A	netunim-orders/site/assets/js/cloud/auth.js
A	netunim-orders/site/assets/js/cloud/transport.js
A	netunim-orders/site/assets/js/core/dates.js
A	netunim-orders/site/assets/js/core/money.js
A	netunim-orders/site/assets/js/core/values.js
A	netunim-orders/site/assets/js/domains/bank/cache.js
A	netunim-orders/site/assets/js/domains/bank/readout.js
A	netunim-orders/site/assets/js/domains/bank/selectors.js
A	netunim-orders/site/assets/js/domains/checks/editor.js
A	netunim-orders/site/assets/js/domains/checks/model.js
A	netunim-orders/site/assets/js/domains/checks/view.js
A	netunim-orders/site/assets/js/domains/customers/bulk.js
A	netunim-orders/site/assets/js/domains/customers/editor.js
A	netunim-orders/site/assets/js/domains/customers/model.js
A	netunim-orders/site/assets/js/domains/customers/selectors.js
A	netunim-orders/site/assets/js/domains/customers/view.js
A	netunim-orders/site/assets/js/domains/dashboard/view.js
A	netunim-orders/site/assets/js/domains/inventory/editor.js
A	netunim-orders/site/assets/js/domains/inventory/model.js
A	netunim-orders/site/assets/js/domains/inventory/order.js
A	netunim-orders/site/assets/js/domains/inventory/selectors.js
A	netunim-orders/site/assets/js/domains/inventory/view.js
A	netunim-orders/site/assets/js/domains/notes/controller.js
A	netunim-orders/site/assets/js/domains/service/bulk.js
A	netunim-orders/site/assets/js/domains/service/editor.js
A	netunim-orders/site/assets/js/domains/service/model.js
A	netunim-orders/site/assets/js/domains/service/view.js
A	netunim-orders/site/assets/js/domains/suppliers/bulk.js
A	netunim-orders/site/assets/js/domains/suppliers/commands.js
A	netunim-orders/site/assets/js/domains/suppliers/editor.js
A	netunim-orders/site/assets/js/domains/suppliers/model.js
A	netunim-orders/site/assets/js/domains/suppliers/navigation.js
A	netunim-orders/site/assets/js/domains/suppliers/order.js
A	netunim-orders/site/assets/js/domains/suppliers/selectors.js
A	netunim-orders/site/assets/js/domains/suppliers/view.js
A	netunim-orders/site/assets/js/domains/warehouse/bulk.js
A	netunim-orders/site/assets/js/domains/warehouse/editor.js
A	netunim-orders/site/assets/js/domains/warehouse/model.js
A	netunim-orders/site/assets/js/domains/warehouse/view.js
A	netunim-orders/site/assets/js/lifecycle.js
A	netunim-orders/site/assets/js/main.js
A	netunim-orders/site/assets/js/shared/calendar.js
A	netunim-orders/site/assets/js/shared/check-series.js
A	netunim-orders/site/assets/js/shared/events.js
A	netunim-orders/site/assets/js/shared/html.js
A	netunim-orders/site/assets/js/state/constants.js
A	netunim-orders/site/assets/js/state/contexts.js
A	netunim-orders/site/assets/js/state/normalization.js
A	netunim-orders/site/assets/js/state/selectors.js
A	netunim-orders/site/assets/js/state/serialization.js
A	netunim-orders/site/assets/js/state/snapshots.js
A	netunim-orders/site/assets/js/state/validation.js
A	netunim-orders/site/assets/js/storage/backup.js
A	netunim-orders/site/assets/js/storage/browser.js
A	netunim-orders/site/assets/js/storage/checks.js
A	netunim-orders/site/assets/js/storage/files.js
A	netunim-orders/site/assets/js/storage/indexed-db.js
A	netunim-orders/site/assets/js/storage/persistence.js
A	netunim-orders/site/assets/js/storage/tab-lock.js
A	netunim-orders/site/assets/js/sync/checks-persistence.js
A	netunim-orders/site/assets/js/sync/checks.js
A	netunim-orders/site/assets/js/sync/document.js
A	netunim-orders/site/assets/js/sync/merge-records.js
A	netunim-orders/site/assets/js/sync/merge.js
A	netunim-orders/site/assets/js/ui/actions.js
A	netunim-orders/site/assets/js/ui/backup.js
A	netunim-orders/site/assets/js/ui/cloud.js
A	netunim-orders/site/assets/js/ui/date-editor.js
A	netunim-orders/site/assets/js/ui/folder-status.js
A	netunim-orders/site/assets/js/ui/folders.js
A	netunim-orders/site/assets/js/ui/layout.js
A	netunim-orders/site/assets/js/ui/modal.js
A	netunim-orders/site/assets/js/ui/navigation.js
A	netunim-orders/site/assets/js/ui/settings.js
A	netunim-orders/site/assets/js/ui/status.js
A	netunim-orders/site/assets/js/ui/tab-guard.js
A	package-lock.json
A	package.json
A	shared/calendar.js
A	shared/check-series.js
A	shared/events.js
A	shared/html.js
A	tests/business_models.test.mjs
A	tests/deploy_preflight.py
A	tests/module_contracts.py
A	tests/module_graph.cjs
A	tests/module_probe.cjs
A	tests/runtime_events.py
A	tests/runtime_performance.py
A	tests/runtime_pwa.py
A	tests/runtime_security.py
A	tests/runtime_workflows.py
A	tests/shared_contracts.test.mjs
A	tests/storage_models.test.mjs
A	tests/sync_models.test.mjs
A	tools/sync-assets.py
```

No existing source files were removed; the former app.js files are now tiny entrypoints.

## Final local results

- verify.bat --no-pause: PASS, all 14 suites; process exit code 0.
- Direct Node tests: 24/24 PASS; pinned ESLint and acyclic module graph PASS.
- Kupa deploy_site.bat --preflight-only: PASS, process exit code 0, no Wrangler/upload.
- Orders deploy_site.bat --preflight-only: PASS, process exit code 0, no Wrangler/upload.
- git diff --check: PASS (only normal Windows line-ending notices).
- Public-root scans: PASS.

Assessment: the architectural migration is complete under the verified local contracts.
Live infrastructure/device rollout checks remain explicitly separate; they were not performed or authorized.

## Workspace housekeeping

The executor refused recursive deletion of the temporary .work directory. It remains locally,
ignored by Git and outside both public site roots. It contains audit scripts, source snapshots, logs
and synthetic screenshots; no application imports it. This is the sole unfinished cleanup item.
