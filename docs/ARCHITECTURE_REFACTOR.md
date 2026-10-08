# Architecture refactor: verified baseline and next slices

This plan records boundaries that have been checked in the active code. Changes to
persisted formats, Storage V2 ownership, journal replay, and cloud RPC semantics
remain separate from structural refactors.

## Verified now

- `tests/module_graph.cjs` parses the deployed ESM graph with Acorn. It checks
  local reachability and cycles, and now rejects imports from `storage/`,
  `cloud/`, or `sync/` into `domains/` or `ui/` in either app.
- Kupa persistence receives the expired-credit predicate through composition.
  Its missing-policy fallback takes the full normalization path, so an absent
  optimization port cannot skip a business deletion.
- Both cloud transports, state/sync paths, and domain models use
  `shared/shared-checks-contract.js` for check and bank-event normalization.
  Valid amounts retain the previous behavior. Orders previously produced
  `NaN` for a malformed amount such as `"1,200"`, which JSON serialized as
  `null`; the common finite whole-shekel rule now produces `0`, matching Kupa
  and the Orders check editor. This does not reinterpret grouped text as 1200.
- `shared/search.js` and `shared/tab-lock.js` are the canonical implementations.
  `core/search.js` re-exports the generated search copy; each app's
  `storage/tab-lock.js` binds its own persisted lock name to the generated lock
  implementation. `tools/sync-assets.py` manages the copies and service-worker
  manifests.
- Both apps now construct local/Drive document search through the generated
  `shared/document-search-composition.js` capability, with one authenticated
  transport port supplied by each app. The construction point remains in the
  same startup sequence.
- Kupa finance composition now owns its bank Bridge, cheque-image adapter,
  bank and credit controllers, bank view, connection importer, cloud freshness
  preflight, tracked finance revision, and shared remote lease state. `main.js`
  supplies app contexts and late UI ports. The importer is still constructed
  after the modal, preserving startup order.
- Orders calendar composition now owns calendar controller construction and
  startup wiring. Its IndexedDB adapter retries a failed open on a later call
  instead of retaining a rejected open promise.
- Orders bulk range selection is a pure `core/` policy used by six domains.
  The module graph now rejects direct imports from either app's domains into `ui/`.
- Kupa state normalization receives bank-feed, credit-sync, and expired-credit
  policies through required composition ports. Missing ports fail before recovery.
  Notes workbook normalization and validation use the canonical generated
  contract. Kupa's local-search markup is a pure `ui-primitives/` module used by
  domain views, with no shell-UI import.
- Orders reminder-date normalization is one app contract used by both persisted
  state and note alerts. State snapshots compare shared checks with the shared
  JSON equality contract instead of importing sync merge code.
- Stage 1 was merged to `main` after the full branch verification matrix passed.
- Kupa's delegated actions are now owned by ten capability packs plus the
  existing workbook, spreadsheet, and credit-card order capabilities. The
  composition root passes each pack its concrete collaborators; it no longer
  supplies 104 individual callbacks to one factory. The shared action registry
  rejects duplicate pack/action names and invalid handlers, retains mutation
  metadata, and exposes a frozen map without prototype actions. Orders uses
  the same registry for its capability-owned actions.
- A Kupa action-reference test checks literal rendered `data-*` actions and
  unreferenced registrations, including the cash-flow date action constructed
  from its base action name. This surfaced an unused cash-flow cutoff editor
  action; its unreachable writer was removed while persisted cutoff settings
  and their read behavior remain intact.
- Orders' delegated actions are now owned by bounded packs for finance, checks,
  suppliers, customers, morning documents, service, warehouse, notes, calendar,
  backup, cloud, alerts, dashboard, and shell. Existing workbook, spreadsheet,
  and card-order action maps retain their owners. The root composes these maps
  once, while each pack declares its own startup mutation domain. A rendered
  action test checks registrations, including the generated cash-flow date
  name, and removed obsolete registrations for controls absent from the UI.
- Orders Suppliers now has a capability composition root. Its selectors are
  available to Dashboard before UI construction; one explicit bind phase then
  creates navigation, ordering, bulk operations, view, editor, and actions after
  the shell ports exist. The runtime rejects access before binding and a second
  bind. Dashboard and backup receive focused ports, and `main.js` no longer
  constructs individual Suppliers controllers or owns their save-domain rule.
- Kupa Cash now has a capability composition root. Balances are available
  before the shell; one explicit bind phase constructs its view, rights-date
  controller, ledger editor, and actions after the required ports exist. The
  runtime rejects use before binding and duplicate binding. `RecordsCommands`
  is created before the check, credit, and expense editors that use it, removing
  their unnecessary construction-order dependency. Cash and rights persistence
  retain their existing domain-specific operation contracts.
- Kupa Expenses now has a capability composition root with a read-only view
  phase and one editor bind phase. Credit receives only the expense markup port;
  backup receives only the monthly expense calculations. The editor is created
  after Credit rendering, modal, persistence and record deletion exist, and its
  writes stay scoped to the expenses domain. Actions are unavailable before
  binding, making the startup dependency explicit.
- Kupa Checks now has a capability composition root. Its balance selectors are
  available before Dashboard construction. The view binds after the bank
  controller and bulk controls exist; the editor and actions bind after modal,
  date editing, persistence and record commands exist. Date editor callbacks
  target explicit guarded commands instead of a later main-scope variable.
  Check mutations continue to use the shared-checks persistence port.
- Kupa Notes now composes its workbook, spreadsheet sync workspace, sticky-note
  controller and action packs behind one runtime. Storage recovery and
  navigation receive guarded ports early; construction binds once after cloud,
  modal and persistence ports exist, before lifecycle startup. Sticky-note
  writes retain the notes domain scope, and spreadsheet actions keep their
  existing independent sync owner.
- Orders Warehouse now owns Inventory and Warehouse selectors, category ordering,
  inventory projections, bulk operations, views, editors and the bounded action
  pack. Read-only category selectors are available before shell construction;
  one validated bind phase supplies layout, modal, date, status, persistence
  and settings ports after the shell is ready. The composition root no longer
  knows individual Inventory/Warehouse controllers. Existing journal save
  domains remain distinct: inventory, inventory+warehouseOrders bulk actions,
  and warehouseOrders. Startup actions are guarded until binding completes.
- Kupa Credit now owns its selectors, view, legacy-card editor and actions in a
  capability runtime. The finance controller remains in Finance composition;
  Credit binds its view after that controller exists, removing late controller
  references from view construction. Editing binds after record commands and
  continues to scope legacy-card writes to credits, while credit sync policy
  stays with the finance controller.

## Dependency direction

Pure core and protocol contracts may be imported by domain and application
logic. Storage and cloud implement infrastructure ports; composition supplies
their domain policies and UI callbacks. Views may use browser APIs. The enforced
part today is `storage/cloud/sync -/-> domains/ui`, `state -/-> domains/sync`,
and `domains -/-> ui` in both apps. These rules check direct imports. `shared/`
is a code-sharing location, not an unrestricted low-level layer; new contracts
and presentation primitives should have explicit owners.

## Next reviewable slices

1. **Composition roots:** continue with the remaining Kupa and
   Orders capabilities. Map each capability's inputs, outputs, startup phase, and
   deferred callbacks. Keep public behavior fixed and run browser startup and
   sync gates for each extraction. Do not create a broad application service
   locator. Retire deferred callbacks where a leaf dependency can be built
   earlier; use an explicit bind phase for genuine construction cycles.
2. **Lifecycle:** once capabilities own their actions and startup ports, replace
   individual callbacks with a small set of explicit phases: preflight, local
   recovery, hydration, first render, remote reconciliation, background jobs.
   Test phase order, partial failure, retry, and shutdown where applicable.
3. **Integrations:** move browser and network adapters from domains behind
   explicit platform/integration ports. Preserve credential and persistence
   semantics while moving each adapter.
4. **Compatibility inventory:** for every legacy reader, persisted key, and old
   RPC, record read/write use, production data dependency, retirement condition,
   and a proving test. Do not delete a reader on name alone.
5. **Contracts and sources of truth:** introduce JSDoc/checkJs at storage, cloud,
   sync and composition boundaries. Inventory SQL setup/operator copies, generated
   assets, and CSS overrides before adding deterministic generation or splitting
   files. Keep release receipts and postflight checks as gates.

Use focused local tests for each slice. The full verification matrix includes
browser and PostgreSQL suites and must pass before deployment. A local focused
pass is not a deployment baseline; record the full CI result for this change.
