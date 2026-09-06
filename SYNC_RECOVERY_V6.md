# Sync recovery v6

This is a focused extension of the existing v5 CAS, operation ledger, durable outbox,
three-way merge, explicit delete intents and restore pipeline. No production configuration
or database is changed by the test harnesses.

## Recovery contract

All four lanes (Orders, Kupa, Shared Checks from Orders, Shared Checks from Kupa) rebase
newer local work against the exact snapshot of the completed generation. The returned
current server head is authoritative, including when operation replay returns an older
`operation_revision` than `revision`.

A conflicting rebase preserves the newer snapshot and a structured conflict in the outbox.
It stops automatic publication, including after restart. Disjoint edits produce a new
generation and operation ID, based explicitly on the current remote revision/state.
The same rule applies when a mutation arrives during asynchronous ACK cleanup.
Outbox cleanup is ordered with staging, and recovery reads retry when staging changes
during their asynchronous read/repair. An old ACK cannot clear a newer generation.

JSON object key order is ignored when comparing business values, because PostgreSQL JSONB
can return a different property order. Array order still matters. Existing explicit-delete
and mass-delete guards are retained; absence from a local snapshot is not a delete intent.

### Field ownership in Orders

| Field | Owner and merge rule |
| --- | --- |
| `businessName` | Client business scalar; strict three-way merge. |
| `inventoryCategoryOrder` | Client business ordered array; concurrent divergent edits conflict. |
| `importAudit`, `stage2Audit` | Client-authored business audit values; strict three-way merge of each whole value. |
| `_meta` | Transport/export/browser metadata; use remote metadata in document merge. Browser snapshot sequence is generated locally and is not a business conflict. |
| `version` | Schema constant selected by the application normalizer. |
| `checks` in Orders/Kupa documents | Local mirror only; the Shared Checks document owns business writes and conflict resolution. |

A merge result containing conflicts must not be published. The legacy prefer-local utility
option is retained for compatibility with existing utility contracts, but no production
post-ACK rebase uses it.

### Durable staging and local mirrors

Orders stages the sync outbox synchronously at mutation time, independently of its browser
state mirror and the 180 ms network scheduling timer. Manual save and pagehide use the same
outbox path. A verified LocalStorage write OR a committed IndexedDB transaction establishes
durability. Network publication awaits the relevant commit barrier. Failure of both stores
is an error and blocks the write; an older durable generation is not used as a substitute.

Durability starts at that successful storage boundary. If LocalStorage is unavailable and
the OS kills the process before IndexedDB commits, the browser cannot guarantee persistence;
the application does not treat an uncommitted outbox as safe for network publication.

Browser mirrors in both apps carry a monotonic local sequence. Startup chooses the larger
sequence across stores; wall-clock timestamps are display metadata only. Legacy records
without a sequence are treated as sequence zero, with deterministic LocalStorage precedence
on a tie. Outbox ordering remains generation/mutationSeq based.

### Conflicts and explicit recovery

Each conflict item records domain, entity type/ID, base/local/remote values, generation,
base revision and current remote revision. Missing entity values are represented as null.
Conflicts stay durable and blocked even if a subsequent remote head happens to equal local.

A new conflict-resolution editor is outside this change. Preserve/export a local JSON backup
and the outbox conflict evidence before an explicit recovery decision. Do not clear pending
or remove `conflict` to resume autosave. An explicit resolution must read the current remote
head, resolve every affected entity, and stage a new generation based on that head. Existing
explicit cloud-load/restore flows remain subject to their confirmations and safety guards.

## Finance fencing

`finance_sync_leases.fence_epoch` increases on every acquisition after expiry, including
reacquisition with the same token. Active renewal retains the epoch. Scrapes capture one
lease name/token/epoch and renew every TTL/3. A renewal that obtains another epoch cannot
be adopted by an already-running scrape.

Fenced public entry points:

- `save_bank_sync_snapshot`
- `merge_bank_transactions`
- `sync_bank_transactions_snapshot`
- `save_finance_sync_document_v5` (including credit publication)

Each checks authenticated owner, lease identity/token/epoch and expiry under a row lock in
the same transaction as publication. A rejected holder gets `PT409` /
`stale_finance_sync_fence`. Old finance write RPCs and direct client writes to protected
finance/lease/archive tables are revoked. Internal implementations retain CAS, operation
ledger and bank-event watermark semantics. `snapshotSeq` is not used as a fence.
Manual credit metadata changes acquire a short lease too. Acknowledging an already recorded
missing bank transaction remains a separate owner-checked user action, not scrape publication.

## Database deployment

Apply the existing setup and upgrades through `sync_integrity_v5_upgrade.sql`, including the
lossless operation ledger/retention and v4 delete-intent migrations. Then apply
`netunim-orders/supabase/sync_recovery_fencing_v6_upgrade.sql` ONCE to the shared database.
The file under `netunim-kupa/supabase/` is byte-identical; do not apply both copies.
The migration is transactional and renames the old implementations into the internal schema.
It is not an idempotent installer. Take the normal deployment backup and coordinate deployment
of both apps: old unfenced finance callers are intentionally rejected once the migration lands.

Run the read-only postflight before deploying the frontend:

```text
netunim-orders/supabase/shared/validation/sync_recovery_v6_postflight.sql
```

The runtime RPC `get_netunim_sync_capabilities()` and both frontend builds share these minima:

```json
{"documentOperationLedger":3,"syncIntegrity":5,"deleteIntents":4,"massDeleteGuard":5,"restoreGroups":5,"sharedChecksIntegrity":5,"financeFencing":1}
```

Authenticated startup checks the contract before enabling mutation. Incompatibility keeps
local recovery/display available and blocks mutation handlers and data API writes with an
explicit DB-version error. No older write RPC fallback is introduced. After completing the
migration, reload the site to perform a fresh handshake.

## Repeatable isolated validation

Prerequisites: Node dependencies (`npm ci`), Python 3.10+, packages in
`tests/requirements.txt`, Chromium/Chrome/Edge (or `NETUNIM_BROWSER`), and PostgreSQL server
executables on PATH for the SQL/E2E gates. The implementation was exercised with Windows,
PostgreSQL 18, Node 24 and Chromium. No Supabase production keys are required.

```powershell
python tools/sync-assets.py --check
npm run lint
node --test tests/*.test.mjs
python tests/run_all.py
python tests/isolated_sync_postgres.py
python tests/runtime_sync_postgres.py
```

`run_all.py` includes all original core and browser gates plus
`runtime_sync_two_computers.py`: separate browser profiles, offline mutation, immediate
pagehide, restart, B writes, A recovers, for same/disjoint entities in both apps.

The separate PostgreSQL gate creates a temporary cluster on a random loopback port, with
fixture-only roles and data. It installs the actual SQL migration chain, runs capability
postflight and executes bank/credit fencing assertions as the authenticated role. It
proves A@100 expiry, B@101 publication, stale A rejection, and unchanged finance document,
Kupa bank metadata, bank transactions and snapshot archive. It also rejects expiry without
a takeover and a current token paired with an old epoch.

`runtime_sync_postgres.py` uses two isolated Chromium profiles and a loopback HTTP fault
adapter calling the real authenticated PostgreSQL RPCs. It commits N at revision 11,
holds/drops the response, stages N+1, lets B commit revision 12, and exercises the client's
native retry against the real operation ledger. All eight same/disjoint cases cover the
four lanes. Same-entity cases assert that revision 13 is not published and B is retained;
disjoint cases assert that the final head includes both edits.

The adapters only serve temporary test configuration. They accept no external database URL
and strip inherited PostgreSQL connection settings. Tests never target production. Clusters
and browser profiles are stopped/removed on normal completion or handled test failure.
On Windows the SQL harness stubs the `pg_cron` scheduling catalog; it does not test execution
of retention jobs. The HTTP adapter exercises real SQL/ACL/ledger behavior but is not a
PostgREST or Supabase Auth implementation.

An external staging project is not required for these gates. A future hosted integration
check can use a disposable Supabase project with the same migrations, fixture-only users,
and both sites configured to that project. That would additionally validate hosted Auth,
PostgREST/schema-cache behavior and scheduled retention, without using production data.

## Verification recorded on 2026-09-06

- `npm run lint`: passed.
- `node --test tests/*.test.mjs`: 208 passed, zero failures/skips.
- `python tests/run_all.py`: ALL VERIFICATION SUITES PASSED, including every original
  core/runtime gate and the four two-profile offline/pagehide/restart recovery cases.
- `python tests/runtime_sync_postgres.py`: all eight real PostgreSQL/HTTP lost-ACK cases
  passed; this run also applied the migration chain and ran capability postflight and
  authenticated bank/credit fencing assertions.
- `python tests/isolated_sync_postgres.py`: standalone SQL/postflight/fencing gate passed.
- `python tools/sync-assets.py --check` and `git diff --check`: passed.
- Both distributed v6 migration copies have identical SHA-256 hashes.

New regressions were observed failing before their fixes, including strict post-ACK conflict,
LocalStorage failure, JSONB property ordering, mutation during outbox read/ACK cleanup, and
persisting conflict metadata at the same generation. Existing test expectations were not
relaxed for this upgrade. Production was neither migrated nor deployed.
