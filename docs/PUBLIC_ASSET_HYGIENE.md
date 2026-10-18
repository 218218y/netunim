# Public asset filename hygiene, 2026-10-18

The reported `netunim-orders/site/service-worker (2).js` is absent from the current
checkout and Git tree; only each application's canonical `service-worker.js` is
present. No historical file was deleted on the assumption that `legacy` or `v1`
means obsolete. Historical reader and deployed migration compatibility remains.

`tools/public_asset_names.py` now rejects accidental numbered copies, editor
recovery/backup suffixes and alternate root Service Worker names. The same rule is
used by the static deploy preflight, the actual deployment JavaScript guard and
asset synchronization. Normal/check synchronization checks every public filename,
including untracked root files outside its generated-shell inventory. Staged
synchronization checks the captured proposed Git tree and validates both plans
before changing either surface. These gates report and stop; they never silently
delete an unfamiliar asset.

Versioned APIs, compatibility readers, `copy.js`, ordinary copy icons and verified
vendor/runtime/map names remain valid. A deliberately named historical exception
would require a documented exact-path policy change and consumer evidence.

Evidence: `public_asset_names_contracts.py`, native staged Git contracts,
`public_js_guard_contracts.py`, deployment preflight and Windows deployment
fixtures. This closes a deployment-inventory gap; it is not a business-data
ownership migration.

The source-transition follow-up also removes the now-unused `ensureDirectoryFile`
wrapper after all production callers moved to detached `prepareDirectory`.
Repository source/test searches show no remaining consumer. It is an internal
composition port, rather than a retained data-format or deployed HTTP API.

Bridge review still finds two intentional current policies: Bank reflects Origin
behind its token gate; Document applies its configured Origin allowlist before
its token gate. This continuation does not silently narrow installed Bank clients
to the Document defaults. A future rollout must inventory actual installed
origins and preserve explicit configuration/native no-Origin clients before
changing that protocol. Physical/provider release exercises remain unverified.

The same cleanup distinguishes critical candidate validation from optional
display cleanup: backup catalogs are now read strictly when selecting/importing
a source, while ordinary catalog display keeps its existing best-effort policy.
A backup selection rechecks its captured account after remembering a handle,
before taking a snapshot, so a late old-account command cannot back up the new
account's state. Focused behavioral regressions cover both decisions. The final
eager graph measures 302 modules / 1,756,970 bytes, within the retained
1,757,000-byte ceiling and unchanged native/4x CPU timing gates.
