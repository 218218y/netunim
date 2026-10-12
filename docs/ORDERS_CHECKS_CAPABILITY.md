# Orders Checks capability and sync ownership

Orders now composes Checks through `composition/checks.js`. Previously main
constructed the view, editor, persistence and synchronization separately, and
Shared sync reserved pull/save promises in `checksSession`. Persistence and
storage cutover read those promises directly.

## Public boundaries

The capability receives ten explicit collaborators, including an optional
platform port. Construction is inert and supports `model.state === null`.
Each binding validates its required methods and is single use:

- `bindView({layout, bankImageContext})` owns the Checks view.
- `bindEditor({date, modal, toast, finance})` owns editing, confirmation guards,
  the action pack and the lazy search scheduler. Date editing remains a shell
  port used by other domains as well.
- `bindPersistence({status, folder, rejectMutation, writeFolder, refreshAlerts})`
  owns the existing independent backup/cloud debounce tasks and journal calls.
- `bindSync({status, financeReadout, writeFolder})` owns the Shared sync adapter.

Consumers use `commands` (sync, saveToCloud, scheduleSave, markDeposited),
`presentation` (Checks rendering and the three Finance view ports),
`dateEditing`, `runtime` and `actionPack()`. The raw editor, view and sync
adapter are private. Action names and non-enumerable startup mutation labels
are retained. Main imports fall from 59 to 56.

## Resource lifecycle

The sync adapter uses the existing canonical flight coordinator with private
slots. Pull joins pull, save joins save, and opposite operations remain ordered.
`checksCloudBusy` remains a boolean observation; pending promises are absent
from the business context. Persistence uses `isSaving()` rather than inspecting
the owner's resource slots.

`runtime.cancelPending()` cancels only unstarted persistence follow-ups.
`runtime.drain()` waits for started persistence work and then every reserved
Shared flight. Storage cutover drains this port again after stopping Main's
polling, rather than reading promise fields from state. The V2 journal's
separate commit receipt remains part of the existing transfer protocol.

`runtime.dispose()` is idempotent. It cancels owned search/debounce wakeups,
fences new commands/actions and prevents queued sync or late sync results from
publishing status/readout. Modal confirmations recheck disposal after await.
Started persistence/IDB work is not aborted; callers can drain after disposal.
Durability risk accounting still settles when its captured receipt settles.
Disposal neither deletes durable records nor acknowledges cloud obligations.

The pure three-way Checks merge policy lives in `sync/checks-merge.js`.
Detached recovery uses it directly, without creating a live synchronization
owner. Explicit deletion protection and normalized merge results are retained.

## Verification and scope

Pre-change ownership tests observed promises in business state and the absence
of explicit drain/dispose APIs. Tests now verify serialization, reserved-save
draining, disposal during held work, inert/validated binding, action metadata,
confirmation fencing, typed operation forwarding and owned search cancellation.

`runtime_orders_checks_capability.py` runs actual production actions with
native timers and IndexedDB. It verifies late confirmation/search isolation,
byte-for-byte retention of independent Main/Shared records, and fresh recovery
of the same note/check identities and content. It is registered in full CI.
Existing Shared status, lost-response, durable ACK, owner-transfer, Finance,
browser, PostgreSQL and Windows gates remain required. Architecture tests reject
Orders context save timers/Shared promise slots and root imports of domain
internals.

Persisted formats, migrations, RPC envelopes, provider policy and ACK/recovery
semantics are unchanged. Existing strict boundary checks remain mandatory;
complete Checks business/capability checkJs coverage is still subsequent work.
This slice does not complete other context resource owners, Kupa Bank/Dashboard
capabilities, Bridge decomposition or compatibility retirement, and does not
replace physical two-computer/live-provider verification.
