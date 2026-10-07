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

## Dependency direction

Pure core and protocol contracts may be imported by domain and application
logic. Storage and cloud implement infrastructure ports; composition supplies
their domain policies and UI callbacks. Views may use browser APIs. The enforced
part today is `storage/cloud/sync -/-> domains/ui`, `state -/-> domains/sync`,
and `domains -/-> ui` in both apps. These rules check direct imports. `shared/`
is a code-sharing location, not an unrestricted low-level layer; new contracts
and presentation primitives should have explicit owners.

## Next reviewable slices

1. **Action registry:** `createUiActions` currently takes 104 inputs in Kupa and
   250 in Orders. Record each action's owner, event channel, mutation guard, and
   rendered `data-*` reference. Introduce a small registry that rejects duplicate
   names and preserves guard metadata. Extract one complete capability action
   pack at a time; verify registered, referenced, and dead actions before
   removing the monolithic factory. The registry must not become a context of
   hundreds of callbacks.
2. **Composition roots:** map each capability's inputs, outputs, startup phase,
   and deferred callbacks. Orders suppliers and Kupa cash are the next cohesive
   candidates. Keep public behavior fixed and run browser startup and sync gates
   for each extraction. Do not create a broad application service locator.
3. **Lifecycle:** once capabilities own their actions and startup ports, replace
   individual callbacks with a small set of explicit phases: preflight, local
   recovery, hydration, first render, remote reconciliation, background jobs.
   Test phase order, partial failure, retry, and shutdown where applicable.
4. **Integrations:** move browser and network adapters from domains behind
   explicit platform/integration ports. Preserve credential and persistence
   semantics while moving each adapter.
5. **Compatibility inventory:** for every legacy reader, persisted key, and old
   RPC, record read/write use, production data dependency, retirement condition,
   and a proving test. Do not delete a reader on name alone.
6. **Contracts and sources of truth:** introduce JSDoc/checkJs at storage, cloud,
   sync and composition boundaries. Inventory SQL setup/operator copies, generated
   assets, and CSS overrides before adding deterministic generation or splitting
   files. Keep release receipts and postflight checks as gates.

Use focused local tests for each slice. The full verification matrix includes
browser and PostgreSQL suites and must pass before deployment. A local focused
pass is not a deployment baseline; record the full CI result for this change.
