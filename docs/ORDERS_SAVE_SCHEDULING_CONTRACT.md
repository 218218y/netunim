# Orders save wakeup ownership

## Evidence before the change

On baseline `d51a65a26c09ff621809362bc751ff71acf79b7e`, Main persistence and
Shared Checks persistence both cleared/replaced `session.saveTimer`.
Two focused tests failed before changing the implementation:

- Main edit, then Checks edit after 50ms: both local writes were submitted,
  but after both commit receipts resolved only the Checks cloud request ran.
- Checks edit, then Main edit after 50ms: both cloud requests ran, but the
  Checks backup follow-up was cancelled by Main.

This proves lost scheduled obligations, not lost durable journal data. The
existing journal/outbox/poll recovery is still authoritative. Neither a clean
module graph nor later polling makes the shared timer ownership correct.

The full baseline GitHub run `38216882120` initially failed in the existing
document-preview privacy test (`preview did not settle`). Its failed jobs were
rerun on the identical commit and passed; no preview implementation or test
timeout was changed. This is recorded separately from scheduler regression
evidence.

## Owners and ports

Main persistence owns one 180ms follow-up. Checks persistence owns its own
180ms backup follow-up and 260ms cloud follow-up. Their semantics differ:
Main retains its existing optional folder fallback and waits for the current
Main commit before cloud submission; Checks waits for its captured Shared
commit before backup/cloud submission. The existing serialized folder writer
continues to own actual folder I/O across both documents.

`platform/debounced-task.js` owns each wakeup. Its only construction ports are
delay, timers and failure reporting. It is Orders-local because Kupa does not
currently consume this policy. There are no generated unused shared copies.

Each persistence capability exposes a focused `runtime`:

- `cancelPending()` removes its pending wakeups, including callbacks already
  delivered by the timer system but not yet entered. It permits later saves.
- `drain()` waits for already started follow-ups. It is not a journal commit,
  cloud ACK or success receipt. Quiescence cancels pending work before draining.
- `dispose()` is idempotent, prevents further scheduling/mutation submission
  through this capability and cancels pending wakeups. Started work continues
  to its existing receipt/error handling and can be drained.

Timer handles and background promises stay inside the owner. `saveTimer` and
`sharedChecksSaveTimer` are absent from Orders contexts. Generations, pending
flags and status messages remain state/read-model observations.

## Scheduling and durability contract

- Every accepted edit still submits its journal operation synchronously before
  scheduling follow-up work. Debouncing coalesces wakeups, not journal entries.
- Each owner has at most one replaceable pending wakeup and one started
  follow-up. A newer follow-up cannot overlap an earlier one in the same owner;
  the newest ready follow-up runs after the earlier one completes.
- Main and Checks cannot cancel each other's pending obligations. The original
  180/260ms delays, save messages, generations and cloud/pending policies remain.
- A native timer callback returns no promise. The owner observes unexpected
  synchronous/asynchronous failures and passes the original error to its
  reporter. This introduces no backend retry, ACK or status-success policy.
- Cancelling/disposal never aborts journal commits, clears durable work or
  suppresses commit observers. An IDB-only failed receipt still blocks cloud
  publication and retains its existing undurable marker. A successful optional
  Main folder fallback retains its existing generation-clearing semantics.
- Local birth and source-owner transfer cancel both runtimes and drain started
  work before their existing journal/cloud quiescence. Configuration requires
  explicit runtime ports; it cannot silently fall back to context timers.
- Browser fixtures cancel through the actual owner rather than mutating a
  context field. Production exposes no timer handle for this purpose.

No schema, persisted format, migration, SQL/RPC, provider policy, cloud polling
cadence or Storage V2 write/adoption/ACK implementation changes are included.

## Verification

`orders_save_scheduling.test.mjs` covers both 50ms edit orders, interleaved
bursts, independent IDB-only failures, independent cancellation and started
receipt drain on disposal. `runtime_debounce.test.mjs` covers delivered stale
callbacks, cancellation before entry, serialized follow-ups, drain, idempotent
disposal, delay preservation and sync/async background failure observation.

`runtime_orders_save_scheduling.py` runs the real journal and IndexedDB adapter
behind the actual persistence factories. Controlled append entry delays permit
both edit orders; native journal-store transaction aborts separately fail Main
and Checks. Cloud probes require the actual committed sequence, and fresh
journal runtimes verify exact original IDs and content after each scenario.
No live bank/credit provider is called.

Strict checkJs covers the scheduler implementation and negative consumers.
An implementation mutation test must reject non-boolean readiness. Module
graph checks cap the task owner at three collaborators and reject Orders
context timer access. Full branch CI includes all existing browser, PostgreSQL,
owner-transfer, ACK/recovery, performance and Windows suites before merge.

## Scope remaining

This closes Orders save wakeup ownership only. Other context resources, Shared
sync promises, Finance/Calendar jobs, platform effects, wide factories, Bridge
decomposition and compatibility retirement remain separate reviewable slices.
It does not certify physical two-computer or live-provider recovery drills.
