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

## Dependency direction

Pure core and protocol contracts may be imported by domain and application
logic. Storage and cloud implement infrastructure ports; composition supplies
their domain policies and UI callbacks. Views may use browser APIs. The enforced
part today is `storage/cloud/sync -/-> domains/ui`; this is an incremental boundary,
not a claim that every remaining dependency follows the final direction.

## Next reviewable slices

1. **Composition roots:** map the inputs and outputs of one cohesive capability
   at a time. The Orders calendar wiring is the next candidate visible in
   `main.js`. Extract only after recording lifecycle
   order and deferred callback dependencies; keep the public runtime behavior
   fixed and run the browser startup and sync gates for each extraction.
2. **State boundaries:** audit `state/normalization.js` and validation imports
   that still depend on domain models. Move only pure, genuinely common data
   rules into contracts. Keep credit and bank policies explicit and test existing
   payload behavior before changing an import.
3. **UI imports and integrations:** remove `domains -> ui` helper imports by
   locating each helper's actual owner. Move browser/network adapters out of
   domain folders in separate changes, with ports wired at composition.
4. **Compatibility inventory:** for every legacy reader, persisted key, and old
   RPC, record read/write use, production data dependency, retirement condition,
   and a proving test. Do not delete a reader on name alone.
5. **Remaining sources of truth:** inventory SQL setup/operator copies, generated
   assets, and CSS overrides before adding deterministic generation or splitting
   files. Keep release receipts and postflight checks as gates.

Use focused local tests for each slice. The full verification matrix includes
browser and PostgreSQL suites and must pass before deployment.
