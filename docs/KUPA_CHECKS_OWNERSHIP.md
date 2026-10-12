# Kupa Checks storage and synchronization ownership

## Verified boundary

Kupa previously exposed `sharedChecksPullPromise`, `sharedChecksSavePromise`
and `sharedChecksSaveTimer` through its state context. Storage ownership transfer
and local engine preparation reached into those fields. Local Checks appends
also lived inside Main persistence, and optional backup work had no explicit
drain owner.

Before this change, focused tests demonstrated the exposed pull promise and
the missing disposal/drain contract for a held read. This is an ownership
refactor; Kupa did not have the former Orders Main/Checks timer collision.

## Capability and composition

The existing `composition/checks.js` capability now owns its private sync and
persistence adapters in addition to selectors, presentation, editor and actions.
Construction remains inert. `bindPersistence`, `bindSync`, `bindView` and
`bindEditor` establish the staged dependencies, and `assertReady` verifies
that all four have been bound before interactive startup.

Consumers receive these focused surfaces:

- `commands.saveLocal(message, options)` appends typed Shared operations and
  returns `Promise<boolean>` for their local durable receipt.
- `commands.sync(options)` and `commands.saveCloud()` use the serialized
  Shared flight owner and existing final-head confirmation.
- `queries.hasLocalWork()` reads the V2 work signal and current business state.
- `runtime.poll()`, `cancelPending()`, `isPending()`, `drain()` and `dispose()`
  own synchronization, appends, follow-ups and search cleanup.

Main no longer imports Checks sync/state implementations. Bank consumes the
Checks command/query roles; cloud UI and Main polling use command/runtime ports.
Main persistence no longer offers a Checks mutation method. It retains Shared
read access required to validate complete portable exports and coordinated imports.

## Durability and lifecycle

The local append still precedes cloud submission. Operation envelopes, surfaces,
generation counters, explicit deletion intent and local durability risk remain
unchanged. Cloud follow-up remains 220ms; optional backup remains deferred to
the next timer turn. Both use the canonical `shared/debounced-task.js` owner.
Ready follow-ups serialize behind started work and coalesce unsent wakeups.

`cancelPending()` increments the follow-up generation as well as removing timers.
An accepted receipt that settles later cannot create a new backup or cloud wakeup
after cancellation. A later accepted save can schedule normally.

Call cancellation or disposal before `drain()` to quiesce pending timers. Drain
waits for accepted appends (including an append accepted during started I/O),
started backups, cloud follow-ups and reserved
pull/save flights. It does not infer a cloud ACK or retry failed work. Existing
V2 pending/head checks remain authoritative at ownership transfer.

Disposal is idempotent and rejects new capability commands and retained UI
actions. It cancels deferred search and fences modal save callbacks and late
sync status publication. Accepted journal appends and already entered I/O are
never aborted. Accepted failures retain their durability risk.

The context retains only the `sharedChecksBusy` boolean observation; its getter
does not expose either flight promise. The three resource fields are removed.
The coordinator validates its runtime ports and quiesces through them before
source transfer or local engine preparation.

## Merge and contracts

`sync/checks-merge.js` separates merge policy from live synchronization. Missing
checks never imply deletion. Explicit delete/edit conflicts, local conflict
preference and Kupa's one-shot empty-bootstrap repair are preserved. Detached
recovery uses the pure merge directly without constructing a live sync owner.

Strict checkJs now checks the actual canonical flight implementation and typed
consumers. Negative fixtures reject timer IDs in promise slots, non-callable
commands, non-boolean confirmations and connectivity evidence. An implementation
mutation proves that replacing a flight with a numeric timer fails typechecking.
Architecture checks forbid the retired context resources and root imports of
Checks sync/state internals.

## Verification and remaining work

Focused tests cover held and reserved flights, durability-before-cloud,
coalescing, cancellation while a receipt is held, started backup drain,
idempotent disposal and bootstrap/deletion semantics. A native browser scenario
checks the actual capability, timers, accepted append, closed actions and exact
raw Main/Shared IDB records, followed by fresh read-only recovery of the same
note and check content. It is registered in the full GitHub verification matrix.

This stage does not complete all runtime migration. Main save queues, cloud
polling/resources, credit resources, shell-owned bulk/delete confirmations,
full business payload typing and Bridge decomposition remain separate work.
No persisted schema, SQL migration, RPC wire format or provider policy changes.
