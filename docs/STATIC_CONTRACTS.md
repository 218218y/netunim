# Incremental JavaScript contracts

## Scope and evidence

The pre-change baseline is `f0a0f874bd118a73ccb1496c7b57686263cadcec`.
Its [full verification run](https://github.com/218218y/netunim/actions/runs/37838418480)
passed. The first strict check of the eight modules below failed on untyped
inputs, unresolved nullable state and contracts that were never compiled.
A separate consumer probe accepted a string login epoch, invalid cursor fields
and async publication. Those same calls are now rejected.

This is compile-time evidence of a contract gap, not a claim of a newly
reproduced data-loss bug. Existing Browser/IndexedDB/PostgreSQL and behavioral
gates continue to own runtime and recovery evidence.

## Checked implementations

The atomic Bank snapshot receipt decoder is also checked from its JavaScript
body. Negative consumers reject incomplete/non-numeric dual-head evidence and
mutation of decoded receipts. Runtime validation remains mandatory for HTTP
JSON; see [Bank confirmation](BANK_SNAPSHOT_CONFIRMATION_CONTRACT.md).

The Orders-owned Morning authority and transport JavaScript bodies are now
checked as well, with negative consumers for login epochs, missing scope ports,
cached boolean guards and async publication assertions. They are composed into
Orders; unused copies are not deployed to Kupa. See
[the Morning ownership contract](MORNING_OPERATION_OWNERSHIP.md).

`tsconfig.contracts.json` checks these canonical JavaScript implementations and
their compile-only consumer fixtures. There are no handwritten function
declaration facades, emitted files, application runtime dependencies or blanket
`any` types. `storage-json.d.ts` defines recursive JSON data interfaces only;
the constructors and ACK policy are checked from their JavaScript bodies.
The data-only definition remains outside the public sites. The checker's
`rootDirs` resolves it for both generated writers from the canonical shared
directory; real runtime imports must still resolve within each site through
the module-graph gate. No declaration file, browser script or precached asset
is added to deployment by the type checker. Runtime JavaScript modules still
use the ordinary generated-asset and service-worker gates.

| Canonical module | Contract checked |
| --- | --- |
| `authenticated-account-scope.js` | Nullable session/owner, numeric login epoch, refresh flag and captured identity |
| `cloud-checkpoint-publication.js` | Generic committed receipt, synchronous publication and distinct success/stale/publication-error results |
| `storage-cloud-status.js` | Minimal validated cursor evidence, numeric seq/ackSeq/revision, journal owner/epoch and pending/control/flight presence |
| `storage-v2-server-protocol.js` | Startup inputs, untrusted protocol field values, allowed vs blocked decisions |
| `storage-startup-protocol.js` | Marker/account/ownership ports, primary/online context and fenced recovery result |
| `storage-startup-recovery.js` | One-time Main/Shared binding, primary vs read-only requests, recovery phase and immutable readiness snapshot |
| `startup-task.js` | Retained task/result type across joined startup calls |
| `runtime-polling.js` | Live ownership receipt, browser timer ports, numeric delays, mandatory error observation and scheduling state |
| `storage-records.js` | Current Checkpoint, Journal, Cloud Base and Flight writer shapes; JSON-compatible state/metadata, explicit operation variants and retained state field types |
| `storage-cloud-ack.js` | Minimal durable ACK cursor, captured flight range and journal owner/epoch scope |
| `document-write-ack.js` | Untrusted Main response envelope, revision/no-op/replay evidence and generic authoritative document through synchronous preparation/equality ports |
| `sync-json.js` | Unknown inputs with retained JSON wire equality semantics |
| `storage-json-codec.js` | Unknown JSON/envelope validation, unchanged checksum, generic sealed data, detached reads and synchronous instrumentation |
| `storage-checkpoint.js` | Validated persisted checkpoint header/object state with historical optional/null metadata; distinct from current writer types |
| `storage-operation.js` | Unknown operation decoding, discriminated changes, schema permissions and historical optional/null annotations; replacement index is not ordering authority |
| `storage-cloud-records.js` | Persisted Base/Flight/Control kind decoders, historical nullable annotations, retry deadline and one scoped head/pair decision |
| `storage-v2-persisted-compat.js` | Existing historical bootstrap eligibility, group completion and shadow-role decisions |

The login epoch is numeric; the journal epoch is a string. They are different
identities. Status evidence is a narrow read contract, not a new persisted
format. Business results from startup recovery remain `unknown` because this
coordinator grants readiness, not a typed business checkpoint.

`publish` returns `undefined`, rather than `void`: TypeScript allows an async
callback to satisfy a void-returning function, although this implementation
does not await it. The stricter signature reflects its existing synchronous
publication boundary. Kupa's expression callback now explicitly discards the
view helper's return value, which was already ignored at runtime.

The recovery implementation captures its verified bound ports before entering
the retained asynchronous task. Its internal request distinguishes primary
recovery with context from read-only recovery without it. Public signatures,
ordering, retries, activation and failure retention are unchanged.

## Current writers and the durable ACK decision

The follow-up baseline is `83b57651f0c70bdef1fe1192dda0d0f75154c6fb`.
Its approved branch passed [full verification](https://github.com/218218y/netunim/actions/runs/37870000508)
before merging. Current records were previously assembled as repeated literals;
the ACK revision/range decision was embedded in the IDB transaction.

Four checked constructors now own the current writer shapes at 21 journal
construction sites and two fenced Main/Shared adoption sites. They add no
defaults, coercion, cloning or freezing. Existing business validation, final
values, serialization, checksums, audit attachment and historical readers retain
their owners. The returned Flight is a draft until the existing owner attaches
audit and seals it; this contract does not make a mutable draft durable.

`assertStorageCloudAck` is the same monotonic revision and exact flight-end
decision, called inside the existing transaction after writer fencing, flight
operation-ID matching and checksum validation. A valid idempotent no-op may
retain the cloud revision. Checkpoint/control checks and all writes remain
atomic; journal deletion still belongs to compaction, not ACK. Passing this
predicate alone never grants commit, UI publication or a synced status.

`tests/fixtures/storage-v2-writer-records.json` was captured from that baseline's
actual production journal, using deterministic IDs and time. Its source ref and
SHA-256 are recorded. Eight stages cover initialization, append, compaction,
immutable flight/audit, newer pending work, ACK and rebase. Node compares the
entire sealed byte representation and checksums, then recovers those baseline
records without changing note IDs/content. Existing JSON sealing still rejects
non-JSON inputs from unchecked callers; types do not replace runtime validation.

`tests/runtime_storage.py` additionally runs real IDB ACK cases in both sites:
wrong account/epoch/revision/range/checksum/operation-ID, stale checkpoints,
bad control after a checkpoint write, transaction abort after each checkpoint,
control, base and flight-delete request, and writer handoff. Rejected/aborted
transactions retain every sealed store. The same flight is replayed, no-op ACK
retains newer pending work, and a fresh page/runtime verifies final IDs/content.

## Main RPC response evidence

This slice starts from `79396a7951c00ea983b00cdfcaf5ac408841f0d3`, whose
[full branch gate passed](https://github.com/218218y/netunim/actions/runs/37872709053)
before merging. Two new regression tests failed against that baseline: Kupa
and Orders returned success and ACKed a replay response without `state`.
Both substituted their sent snapshot for the missing authoritative head.
This is reproduced client behavior under an injected malformed response,
not evidence that production PostgreSQL emitted that response or lost data.

The v6 Main RPCs return current `revision/state` plus the original
`operation_revision` on replay. The SQL owner is the existing
`20260924120000_storage_writer_protocol_v2.sql` wrapper over the v5 ledger
implementation in `20260906200304_production_schema_baseline.sql`. A later
remote edit can therefore make the returned state differ from the immutable
snapshot that was sent. Substitution would acknowledge an unreceived head.

`readDocumentWriteAck` rejects a missing/null/scalar/array state before domain
preparation. It returns the actual prepared authoritative document and existing
revision evidence together. Invalid envelopes never reach durable ACK or
publication; the existing error owner retains the immutable flight and pending
work. Valid no-op, legacy operation-metadata compatibility and numeric wire
revision handling retain their prior policy. The existing `cloud-sync` exports
forward to the checked revision and JSON implementations.

This envelope check does not replace business-schema validation, the fenced
IDB transaction, generation checks or final synced confirmation. Preparation
retains its app owner, and most app consumers are still unchecked. Shared
Checks and Finance have different contracts and do not use this Main receipt.

Both app sync APIs are exercised with real IDB in `runtime_storage.py`: a lost
response followed by an offline edit and another computer's write; a malformed
successful replay; fresh-runtime recovery; an aborted ACK; exact replay and
final recovery of both note IDs/content. The RPC ledger remains controlled
fault injection; the separate Browser/PostgreSQL suites own actual SQL evidence.

## Persisted checkpoint boundary

The next slice starts from `a20eadd6383b56d3af2cd3e13087472ac749db54`.
Eight pre-change tests proved checksum-valid malformed state/metadata could
pass generic replay. Another reproduced a serialization TypeError for non-JSON
persisted data, previously classified as retryable. JSON validation now precedes
checksum serialization, and structural checkpoint validation precedes recovery
and writer claims in Main/Shared. Existing corruption codes own the failures;
there are no new defaults or automatic repair.

The codec is checked from its actual implementation, including generic result
preservation through synchronous measurement ports. The checkpoint reader does
not infer business fields, require historical savedAt or manufacture metadata.
Baseline sealed bytes/checksums and legacy missing/null metadata remain tested.
See [the checkpoint recovery contract](STORAGE_CHECKPOINT_RECOVERY_CONTRACT.md)
for failure ownership, real-IDB restoration drills and exact remaining scope.

## Gates and commands

```text
npm run typecheck
node --test tests/typecheck_contracts.test.mjs
```

The checker uses TypeScript 6.0.3, pinned in `package-lock.json` and the offline
vendor. This portable JavaScript compiler avoids adding a native compiler's
per-platform package closure to the Linux offline toolchain. It is a development
dependency; the sites continue to deploy native JavaScript ESM.

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `allowJs`,
`checkJs` and `noEmit` are explicit. Browser library types are selected; ambient
Node type packages cannot silently change timer or browser contracts.
`npm run typecheck` reads `NETUNIM_OFFLINE_NODE_MODULES` when present, so the
normal and offline gates use the same locked compiler and configuration.
Missing compiler files fail the command and invalidate offline install readiness.

`tests/module_contracts.py` invokes the check in the full local and GitHub
`models` gate. The compile-only fixtures include valid calls and 118 intentional
invalid consumers using `@ts-expect-error`. A newly accepted invalid call makes
its directive unused and fails compilation. Never execute this fixture.
The Node gate tests additionally prove that an implementation mismatch is
detected (including a writer's string sequence, an RPC receipt's string revision
and a decoder's numeric owner/string sequence), an unused expectation
fails, and a missing compiler cannot pass.
The storage fixture also imports both generated site writers: unresolved data
types or accepted invalid inputs fail checking. The Main receipt fixture also
checks both generated implementations and rejects async preparation/equality.
The decoding fixture checks both generated checkpoint readers and prevents
raw JSON from being treated as a business checkpoint without decoding.
The operation fixture checks both generated operation readers, historical nullable
annotations and discriminated changes without inventing business record types.
The actual validation policy is shared with replay and pending-work reads.
Real-IDB journal queries select the historical physical owner-key namespace
before decoding mutable payload ownership; index drift cannot hide or inject rows.
See [the operation recovery contract](STORAGE_OPERATION_RECOVERY_CONTRACT.md)
for the thirteen pre-change failures and real-IDB restoration matrix.
Existing generator contracts
continue to own source parity and runtime cache keys.

Contracts live next to the actual implementation, following TypeScript's
[JavaScript checking](https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html)
and [JSDoc](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
support. Extend the explicit file list in reviewable slices; do not suppress a
failure with `@ts-ignore`, `@ts-nocheck` or broad assertions.

## Remaining coverage

Kupa `domains/credit/publication.js` now checks confirmed Finance commit,
synchronous read-model publication, local follow-up result and authorized read
recovery. Negative consumers reject async publication, cached authority and
string revisions/confirmations; a mutated implementation result fails the gate.
See [the Credit publication contract](KUPA_CREDIT_PUBLICATION_CONTRACT.md).
This does not typecheck the whole Credit controller or Finance transport.

This gate does **not** yet check all application consumers, persisted
complete journal/IDB transactions, full business RPC
payload validation and cloud read candidates, Finance
leases or capability APIs. Their existing runtime validation and historical
readers remain intact. Add static coverage at those owners with behavior and
negative consumer fixtures, rather than assuming the status-head contract is
a substitute for persisted-data validation.

The unchecked journal/IDB callers now use these checked constructors and ACK
policy, but their full input flow is not yet checked. This slice does not claim
that all callers or historical record variants satisfy the current writer type.

Persisted Base/Flight/Control reader bodies and both generated decoders are now
checked; see [the cloud-record recovery contract](STORAGE_CLOUD_RECORD_RECOVERY_CONTRACT.md)
for native-IDB pre-change evidence and retained historical annotations.

Persisted schema, SQL, durable ACK semantics, merge, RPC payloads, retry and
installed-user data are unchanged. Main rejects malformed successful response
envelopes instead of inventing their authoritative state. Main/Shared recovery
now rejects malformed checkpoint state/metadata and classifies non-JSON
persisted data before serialization.
Full Browser/PostgreSQL/recovery/Windows verification
is required before merging; a static pass alone is insufficient for deployment.
