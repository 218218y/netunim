# Kupa Dashboard capability and Bank queries

Three pre-change regressions exercised the production Orders-summary controller:
an old response published across logout/login of the same account; a new account
joined the former account's flight; and cached financial summary remained
readable after credentials were cleared while the transport was still marked
ready. These are readout/ownership defects, not journal or provider defects.

## Ownership and capability boundary

`composition/dashboard.js` owns the Dashboard controller and view. Its seven
collaborators are explicit access, remote read, model/UI, revision, finance
derivation and optional platform ports. Construction/binding is inert. `bindView`
accepts Bank queries, active/deposited Checks queries and local Bank snapshot
status, validates those ports, and is single use.

Consumers receive `queries.ordersSummary`, `commands.refreshOrdersSummary`,
`presentation.renderDashboard/kpi` and runtime `start/stop/drain/isPending/dispose`.
They do not receive the raw controller/view or a pending promise slot. Main's
static imports decrease from 61 to 60, while its ten Bank-to-Dashboard callback
bindings are removed. The Dashboard view itself consumes six collaborators,
including actual Bank/Checks/Orders query ports.

The read controller owns its cache, cooldown, flights and auth subscription.
Each read captures the authenticated owner, login epoch and runtime generation.
Every awaited metadata/document response and synchronous projection is followed
by a fresh access check. Concurrent reads join only within the same login and
runtime generation. A new login can start its own read while a former request
settles; a former completion cannot clear the newer flight.

Auth notifications synchronously discard the former cache and invalidate the
visible Dashboard. Query access also checks attribution and transport readiness.
An attributed cache remains available offline; no network read starts offline.
The existing ten-second cooldown, metadata no-op check and shared customer/
supplier projection are retained. Returned summaries are frozen/read-only.

`start/stop` are idempotent and own exactly one auth subscription. Stop fences
started reads; restart has a new generation. `dispose` is idempotent, removes
the subscription, drops the private read cache and closes further reads.
`drain` includes all retained former/current reads. This lifecycle performs no
Main/Shared writes and does not alter any cloud ACK or local durability state.

Orders read-only transport methods accept a caller-owned scope guard. They
forward it into the existing authenticated request fence and recheck it after
response-body parsing, closing the gap after the fetch returned its response.
Existing callers that omit this optional guard retain their wire behavior.

## Bank query API

`composition/bank-queries.js` constructs the existing pure Bank selectors and
exposes six reads: account balance/date/forecast/projected balance, long-term
position and observed Checks sequence. Account-specific reads require explicit
`business` or `home`. Finance, Dashboard, Expenses, Settings and Alerts consume
these ports, rather than importing/knowing the selector layout in main.

Balances, forecast policy, business/home separation, local Bank confirmation
warnings and the underlying shared finance calculations are unchanged. Bank
controller, effects, provider adapters and presentation still have broader
interfaces; this slice does not claim to complete that capability or the Bridge.

## Verification

- Ownership tests cover the three pre-change failures, same-login joining,
  retained-read drain, stopped/restarted generations, offline cache, cooldown,
  immutable query results and disposal.
- Capability/query tests cover inert unhydrated construction, required ports,
  single binding/subscription/release and authoritative independent balances.
- Transport tests hold actual response-body parsing and prove caller fencing.
- Strict checkJs checks the actual read-owner implementation and negative
  consumers, including epoch, readiness, projection and remote envelopes. An
  implementation mutation must reject a string completion result.
- `runtime_kupa_dashboard_ownership.py` uses actual auth/capability/DOM with
  synthetic Orders reads, native IndexedDB and fresh journal recovery. It covers
  account switch, same-account re-login, logout and disposal, exact independent
  Main/Shared record retention and the same recovered note ID/content.
- Module graph budgets protect the new collaborators and prohibit context
  Dashboard flights, root Dashboard/Bank selector imports and browser I/O in
  the read controller. Full branch CI retains browser, PostgreSQL, recovery,
  financial calculation and Windows gates.

No persisted formats, migrations, RPC payloads, provider retry/fallback policy
or shared ledger ownership change. Other runtime resources, complete Bank and
shell capabilities, broader business typing and Bridge decomposition remain
separate completion tracks.
