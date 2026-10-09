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

`tsconfig.contracts.json` checks these canonical JavaScript implementations and
their compile-only consumer fixtures. There are no handwritten function
declaration facades, emitted files, application runtime dependencies or blanket
`any` types. `storage-json.d.ts` defines recursive JSON data interfaces only;
the constructors and ACK policy are checked from their JavaScript bodies.
The data-only definition is generated into both sites by `sync-assets`, so
their writer types resolve too. It adds no browser script or precached asset.

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
`models` gate. The compile-only fixtures include valid calls and 68 intentional
invalid consumers using `@ts-expect-error`. A newly accepted invalid call makes
its directive unused and fails compilation. Never execute this fixture.
The Node gate tests additionally prove that an implementation mismatch is
detected (including a writer returning a string sequence), an unused expectation
fails, and a missing compiler cannot pass.
The storage fixture also imports both generated site writers: unresolved data
types or accepted invalid inputs fail checking. Generator contracts cover type
drift, obsolete copies, staged-only generation and unchanged runtime cache keys.

Contracts live next to the actual implementation, following TypeScript's
[JavaScript checking](https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html)
and [JSDoc](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
support. Extend the explicit file list in reviewable slices; do not suppress a
failure with `@ts-ignore`, `@ts-nocheck` or broad assertions.

## Remaining coverage

This gate does **not** yet check all application consumers, full persisted
checkpoint/journal/Flight decoders, complete IDB transactions, RPC ACK parsing, Finance
leases or capability APIs. Their existing runtime validation and historical
readers remain intact. Add static coverage at those owners with behavior and
negative consumer fixtures, rather than assuming the status-head contract is
a substitute for persisted-data validation.

The unchecked journal/IDB callers now use these checked constructors and ACK
policy, but their full input flow is not yet checked. This slice does not claim
that all callers or historical record variants satisfy the current writer type.

No persisted schema, SQL, ACK semantics, merge, RPC, retry or installed-user data
changes are part of this slice. Full Browser/PostgreSQL/recovery/Windows verification
is required before merging; a static pass alone is insufficient for deployment.
