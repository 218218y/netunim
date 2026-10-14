# Bank path audit and canonical archive reconciliation

Audit baseline: `c4442d28e4f989a2a10e0dea5895e8234fb9c262`. Orders supplies the
reference for common cloud Bank policy. Differences are retained where current
product behavior, data ownership and tests provide concrete evidence.

| Boundary | Evidence and decision |
| --- | --- |
| Local/file/directory persistence | Kupa exposes folder/file connections in `ui/folders.js`. Finance cloud ports supply explicit local leases; `local-snapshot.js` requires durable confirmation of the exact candidate and retries it without another scan. Native tests exercise local Main IndexedDB without cloud writers. Orders Finance requires an authenticated cloud account and stores its Finance readout outside Orders Main. Keep these active capabilities and their distinct owners. |
| Atomic commit versus readout freshness | Both apps call `save_bank_sync_snapshot_v6` and validate independent Kupa/Finance receipt heads. Kupa publishes the receipt-confirmed candidate, then separately verifies its own Main cloud adoption, which may defer for pending work. Orders requires a verified external Finance readout before publishing its archive display. Existing snapshot/unknown-ACK tests explicitly protect these policies. Keep the owner-specific publication adapters. |
| Morning | Orders decorates archive rows through `list_bank_morning_document_links`; `customerBankPort` and `markBankMorningVerified` connect customer issuance to Bank presentation. Links do not participate in balance/coverage/source verification. Preserve enriched rows unchanged in the common core and retain the Orders adapter/customer workflow. |
| Financial archive policy | Account identity, transaction coverage, canonical detail comparison, timestamp/number comparison and source/readback audit have six identical ASTs. There is no different financial policy to retain. Use one canonical implementation from Orders and retire the copies. |
| Cloud reconciliation sequence | Both apps reconcile business then optional home, handle cheque-image warnings, await paired archive reads at 370 days, compare source rows and require exact count for 365-day backfill. Use one owner with separate instances in each composition. |

The audit establishes supported current behavior; it does not infer the history
of how the apps were originally built. Morning does not require different Bank
reconciliation algorithms. Its enrichment stays outside the common core.

`shared/bank-archive-policy.js` retains those six algorithms. Its boundary narrows
opaque adapter result/row shapes and rejects former synthetic no-op results.
Incremental total-count metadata remains advisory; exact backfill and financial
identity/content checks preserve the established semantics. An archive audit
does not grant an atomic document acknowledgement.

`shared/bank-archive-reconciliation.js` owns accepted cloud reconciliation through
four required ports: transactions, cheque images, paired archive read and
readable authority. It has no provider, UI, local storage, document writer or
timer authority. Disposal rejects new commands, fences later work and joins
accepted requests, including failed responses after scope loss. Captured write
authority combines account/device/heartbeat and owner lifetime. Archive cache
guards retain readable account authority independently of the temporary lease.

Both compositions join/dispose separate instances. Kupa retires its flat
transaction/image dependencies and silent defaults, reducing controller width
from 18 to 17. Orders publication retires its archive execution dependencies and
four model callbacks, reducing its owner from seven to five ports. Generated
copies come from the canonical source via sync-assets; there is no forwarding
production compatibility facade.

The immutable fixture contains both complete pre-change workflows and all six
policy ASTs. Tests expand the actual shared implementation through both current
consumers and compare the original algorithms, including older Bank/issuer
fixtures. Role, read horizon, backfill threshold and home-isolation mutations
fail preservation. Strict actual implementations and negative consumers reject
incorrect count types, fake drain, unvalidated Bank accounts, wrong lease kinds
and asynchronous permission. Runtime cases cover acceptance, late failures,
scope/disposal, separate instances and intact Morning enrichment.

Six registered native Kupa cases preserve both real journals and recover an
exact note through fresh-runtime recovery; twelve existing Orders publication
cases now traverse the same owner. Native local-save/unknown-ACK and full
PostgreSQL/Morning suites protect the intentionally separate adapters.

There are no schema, persisted-format, migration, RPC, provider/retry, Bridge
version or installer changes. Complete RPC/controller typing and broader Kupa
provider/publication orchestration remain open.
