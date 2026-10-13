# Architecture refactor: verified baseline and next slices

This plan records boundaries that have been checked in the active code. Changes to
persisted formats, Storage V2 ownership, journal replay, and cloud RPC semantics
remain separate from structural refactors.

For the current completion inventory, see
[remaining major work](ARCHITECTURE_REMAINING_WORK.md). Older stage-specific
remaining-scope paragraphs below are a chronological record.

## Verified now

- Kupa Bank now keeps its controller/view private behind command, query,
  presentation and lifecycle ports. A pre-change diagnostic click-failure test
  reproduced leaked native download resources. Both apps now consume the same
  canonical strict Finance effects adapter, with separate owned instances.
  Bank form reads moved into delegated actions, and search/automation/preview
  disposal and outstanding-operation drain have focused/native-IDB coverage.
  Existing local abort/retry still recovers the same snapshot and transaction
  without a provider rescan. See `KUPA_BANK_CAPABILITY.md`; large private
  controller decomposition, generic import ownership and Bridge work remain.

- Kupa Dashboard now owns its readout/view through a staged capability and Bank
  consumers use an explicit account query API. Three pre-change tests reproduced
  stale same-account re-login publication, cross-account flight joining and an
  unattributed cache after logout. Read cache/cooldown/flights/subscription are
  private, scoped by auth epoch/runtime generation, and protected by strict
  implementation/negative-consumer checks. Dashboard view collaborators decrease
  from 16 to six; Kupa main imports decrease from 61 to 60. Actual auth/DOM/native
  IDB tests verify former-read fencing and exact retained Main/Shared data. See
  `KUPA_DASHBOARD_CAPABILITY.md`; Bank controller/effects and Bridge work remain.

- Orders Checks owns its view, editor, action/search runtime, persistence and
  Shared sync through one staged capability. Main imports drop from 59 to 56.
  Shared pull/save promises are private, persistence observes `isSaving()`, and
  storage cutover drains the runtime port. Disposal fences late confirmation,
  search and sync publication while retaining durable work. Node tests and
  actual application actions with native IndexedDB verify exact retained data
  and fresh recovery. See `ORDERS_CHECKS_CAPABILITY.md`; other resource owners
  and complete capability/business typing remain subsequent work.

- Orders Finance now owns Bridge/scope/image adapters, scoped readout, controller,
  presentation/import/card ordering and three action packs behind one staged
  capability. Main imports drop from 68 to 59; consumers receive query, command,
  readout, rendering and runtime ports. Controller/cache browser effects use a
  strict platform adapter. Two pre-change tests reproduced leaked diagnostic
  URLs/anchors after click failure. Resource cleanup and closed-capability
  confirmation/status/action behavior have dedicated Node/native-IDB coverage.
  See `ORDERS_FINANCE_CAPABILITY.md`; large private controller decomposition and
  full business-payload typing remain separate work.

- Orders Main and Shared Checks no longer share a context save timer. Two
  pre-change tests reproduced lost cloud/backup wakeups at a 50ms edit interval.
  Persistence runtimes now own independent debounced tasks, cancellation,
  drain and idempotent disposal. Local-birth/owner-transfer quiescence uses
  those ports. Strict implementation/negative-consumer checks and native IDB
  commit/abort/restart tests accompany the change. See
  `ORDERS_SAVE_SCHEDULING_CONTRACT.md` for behavior and retained policies.

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
  transport and live authorization-scope ports supplied by each app. The construction point remains in the
  same startup sequence.
- Kupa finance composition now owns its bank Bridge, cheque-image adapter,
  bank and credit controllers, bank view, connection importer, cloud freshness
  preflight, tracked finance revision, and shared remote lease state. `main.js`
  supplies app contexts and late UI ports. The importer is still constructed
  after the modal, preserving startup order.
- Orders calendar composition now owns calendar controller construction and
  startup wiring. Its IndexedDB adapter retries a failed open on a later call
  instead of retaining a rejected open promise.
- Orders bulk range selection is a pure `core/` policy used by six domains.
  The module graph now rejects direct imports from either app's domains into `ui/`.
- Kupa state normalization receives bank-feed, credit-sync, and expired-credit
  policies through required composition ports. Missing ports fail before recovery.
  Notes workbook normalization and validation use the canonical generated
  contract. Kupa's local-search markup is a pure `ui-primitives/` module used by
  domain views, with no shell-UI import.
- Orders reminder-date normalization is one app contract used by both persisted
  state and note alerts. State snapshots compare shared checks with the shared
  JSON equality contract instead of importing sync merge code.
- Stage 1 was merged to `main` after the full branch verification matrix passed.
- Kupa's delegated actions are now owned by ten capability packs plus the
  existing workbook, spreadsheet, and credit-card order capabilities. The
  composition root passes each pack its concrete collaborators; it no longer
  supplies 104 individual callbacks to one factory. The shared action registry
  rejects duplicate pack/action names and invalid handlers, retains mutation
  metadata, and exposes a frozen map without prototype actions. Orders uses
  the same registry for its capability-owned actions.
- A Kupa action-reference test checks literal rendered `data-*` actions and
  unreferenced registrations, including the cash-flow date action constructed
  from its base action name. This surfaced an unused cash-flow cutoff editor
  action; its unreachable writer was removed while persisted cutoff settings
  and their read behavior remain intact.
- Orders' delegated actions are now owned by bounded packs for finance, checks,
  suppliers, customers, morning documents, service, warehouse, notes, calendar,
  backup, cloud, alerts, dashboard, and shell. Existing workbook, spreadsheet,
  and card-order action maps retain their owners. The root composes these maps
  once, while each pack declares its own startup mutation domain. A rendered
  action test checks registrations, including the generated cash-flow date
  name, and removed obsolete registrations for controls absent from the UI.
- Orders Suppliers now has a capability composition root. Its selectors are
  available to Dashboard before UI construction; one explicit bind phase then
  creates navigation, ordering, bulk operations, view, editor, and actions after
  the shell ports exist. The runtime rejects access before binding and a second
  bind. Dashboard and backup receive focused ports, and `main.js` no longer
  constructs individual Suppliers controllers or owns their save-domain rule.
- Kupa Cash now has a capability composition root. Balances are available
  before the shell; one explicit bind phase constructs its view, rights-date
  controller, ledger editor, and actions after the required ports exist. The
  runtime rejects use before binding and duplicate binding. `RecordsCommands`
  is created before the check, credit, and expense editors that use it, removing
  their unnecessary construction-order dependency. Cash and rights persistence
  retain their existing domain-specific operation contracts.
- Kupa Expenses now has a capability composition root with a read-only view
  phase and one editor bind phase. Credit receives only the expense markup port;
  backup receives only the monthly expense calculations. The editor is created
  after Credit rendering, modal, persistence and record deletion exist, and its
  writes stay scoped to the expenses domain. Actions are unavailable before
  binding, making the startup dependency explicit.
- Kupa Checks now has a capability composition root. Its balance selectors are
  available before Dashboard construction. The view binds after the bank
  controller and bulk controls exist; the editor and actions bind after modal,
  date editing, persistence and record commands exist. Date editor callbacks
  target explicit guarded commands instead of a later main-scope variable.
  Check mutations continue to use the shared-checks persistence port.
- Kupa Notes now composes its workbook, spreadsheet sync workspace, sticky-note
  controller and action packs behind one runtime. Storage recovery and
  navigation receive guarded ports early; construction binds once after cloud,
  modal and persistence ports exist, before lifecycle startup. Sticky-note
  writes retain the notes domain scope, and spreadsheet actions keep their
  existing independent sync owner.
- Orders Warehouse now owns Inventory and Warehouse selectors, category ordering,
  inventory projections, bulk operations, views, editors and the bounded action
  pack. Read-only category selectors are available before shell construction;
  one validated bind phase supplies layout, modal, date, status, persistence
  and settings ports after the shell is ready. The composition root no longer
  knows individual Inventory/Warehouse controllers. Existing journal save
  domains remain distinct: inventory, inventory+warehouseOrders bulk actions,
  and warehouseOrders. Startup actions are guarded until binding completes.
- Orders Customers now exposes Dashboard totals before UI binding and binds its
  customer/debt/Morning domain once, after the recovery and finance bank ports
  are available. Both delegated action packs are owned by this capability;
  external navigation and bank views receive guarded, purpose-specific commands.
  Existing Morning server issuance, idempotent recovery, secondary-tab guards,
  and customer-debt journal operations were not changed. The existing domain
  editor/view remain accessible for browser recovery fault-injection tests.
- Orders Service now owns its bulk selection, view, editor, actions, and service
  persistence scope behind one validated UI bind. The shell uses only render and
  actions ports, with no individual Service controller construction.
- Kupa Credit now owns its selectors, view, legacy-card editor and actions in a
  capability runtime. The finance controller remains in Finance composition;
  Credit binds its view after that controller exists, removing late controller
  references from view construction. Editing binds after record commands and
  continues to scope legacy-card writes to credits, while credit sync policy
  stays with the finance controller.

- Lifecycle boot in both apps now shares a single execution task: concurrent
  callers join the same promise, and completion or failure cannot run startup
  again in the same runtime. Recovery retries still belong to their existing
  bounded policies. Kupa no longer imports business helpers or injects selectors,
  editors and modal internals merely to check their existence at runtime. Module
  graph validation enforces that boundary; the initial state is validated against
  local and cloud data contracts during tests. Unused Credit/Expenses backup
  facades that only served that inventory have been removed after a usage search.
  Deployment checks require the current startup contract marker. Runtime checks of untrusted data,
  account ownership, markers and storage protocol remain in place.

- Storage V2 now owns a shared startup protocol port with three collaborators:
  ownership queries, durable marker verification, and account protocol/recovery.
  Each configured storage coordinator supplies it to lifecycle. The port preserves
  offline/local decisions and reports fenced-recovery failures without retries or
  opening writes. Lock acquisition and ownership hydration still precede protocol
  verification in each app. Marker state is read again after owner transfer;
  Orders now uses the activated owner to choose Main recovery, fixing a stale
  local-owner decision when a local-to-account transfer resumes during boot.

- Network/foreground wakeups in both apps now have dedicated connectivity
  runtimes with at most eight collaborators, including the injected browser and
  timers. A canonical resource owner registers their listeners, coalesces tasks
  by identity while queued or running, reports failures without automatic retry,
  and disposes only owned resources. Delayed calls recheck leadership, protocol,
  auth and domain gates as applicable. Offline/hidden events cancel pending
  wakeups; in-flight capability operations finish normally. Finance wakeups are
  coalesced on the next timer turn; provider auto-sync loops retain their existing
  policies and owners. Other shell listeners and capability pollers remain a
  separate lifecycle slice.

- Both apps now bind Main/Shared startup recovery once, before constructing
  lifecycle. A canonical recovery port owns ordered primary recovery and bounded
  secondary reads. Missing/failed primary recovery retains the same failed task;
  it never retries writers or falls back to another store. Lifecycle explicitly
  activates the recovered pair after installing the applicable startup guards.
  UI mutation guards and connectivity wakeups consult this readiness boundary.
  Seven behavior regressions reproduced premature editing in the previous main
  during recovery, after a Shared failure, and after interrupted local birth.
  Kupa deferred Main hydration now retains the connect screen and defers polling
  until Shared has recovered. Orders initial Morning recovery shares the owned,
  coalesced wakeup with reconnect/foreground recovery, retaining `quiet:false`
  at startup and rechecking auth, ownership and Main hydration before execution.

- Orders now composes three startup owners: cloud hydration, optional local
  services, and background startup. Lifecycle receives their small phase APIs
  rather than individual cloud, folder, backup and alert callbacks. Storage owns
  recovery of the durable cloud cursor. The startup modules receive adapters
  through validated ports; they do not import domain/UI/infrastructure modules
  or access browser I/O directly. Each phase retains one execution task.
  Four regressions failed on the previous main: an alert-display exception
  replayed alerts and prevented Finance startup, a Finance-start exception
  repeated that job, leadership loss during alert preparation still displayed
  alerts/started jobs, and offline transition after Main hydration still issued
  dependent remote reads. Separate optional-error boundaries and live access
  checks now preserve the intended sequence without replaying completed effects.

- Kupa now has separate cloud hydration, optional local services and connection
  binding owners. Lifecycle activates recovered Main/Shared and displays the
  account view before waiting for optional browser persistence/backup-target
  preparation. Three regressions reproduced the old delayed display and stale
  auth/leadership decisions during that preparation. Cloud startup rechecks live
  eligibility between remote phases; connection startup owns four registrations
  with retained binding failure and explicit disposal. The factories expose only
  phase methods and receive the exact required ports. See the
  [Kupa startup contract](KUPA_STARTUP_CONTRACT.md) for order and failure policy.

### Startup recovery contract

`construct -> bind journals -> validate binding -> lock/owner/protocol -> birth or
owner-transfer completion -> Main -> Shared -> recovered -> activate -> first
safe display -> remote hydration -> background jobs`.

`recovered` is not UI readiness. Orders installs cloud domain gates and restores
its cloud cursor before activation; Kupa establishes its cloud hydration gate
before recovery. Existing protocol, tab, capability and domain guards continue
to apply after activation. Primary failures preserve the original error and
failed journal in the recovery snapshot. One runtime cannot switch between
primary and secondary recovery or restart a failed task.
Local Main failure now rejects boot just as account/Shared failure does, while
reporting the locked recovery state in the UI; completion callbacks cannot
mistake an early local recovery failure for successful startup.

| Outcome | Editing/display | Retry policy |
| --- | --- | --- |
| Preflight, birth or transfer stopped | No startup readiness | New runtime after resolving the cause |
| Main/Shared pending | No startup readiness or connectivity jobs | Await the current recovery |
| Primary Main/Shared missing or failed | No business render or editing | Retain failed task; no automatic writer retry |
| Secondary checkpoint unavailable | No partial composed display | At most six reads per journal, 60ms apart; no writes |
| Both journals recovered, startup preparation pending | No editing | Await lifecycle activation |
| Secondary activated | Read-only display and permitted exports | Existing secondary-tab rules |
| Cloud hydration pending | Local display; applicable mutations remain blocked | Existing hydration owner |
| Kupa account recovered, optional services pending | Recovered display; existing cloud hydration gate applies | Await services before remote hydration |
| Cloud unavailable after verified local recovery | Retain existing offline/deferred policy | Existing sync policy and durable pending data |
| DB capability mismatch | Local display; editing and connectivity jobs blocked | Explicit upgrade/revalidation |

Persisted schemas, owner/epoch fences, ACK semantics and SQL are unchanged.
Incomplete remote restore reconciliation retains its existing failure policy;
typed reconciliation errors and the remaining background resources need their
own review rather than a blanket retry or blanket failure classification.

### Orders hydration and background contract

After Main/Shared recovery, cloud preparation restores the account cursor and
installs domain mutation guards before publishing a frozen hydration plan.
Only then can lifecycle activate recovery and render. Optional persistence and
folder initialization starts after that display. Remote Main completes before
Shared and Finance hydration; background startup then runs polling, the optional
folder backup, bank-alert archive preparation, alert display and Finance jobs.
The backup waits for folder readiness and captures the current hydrated model.
Local/offline/signed-out startup retains the existing local path and skips the
applicable remote reads. Each remote call and background phase rechecks live
access; losing auth, connectivity or leadership cannot authorize the next read
using an earlier startup snapshot. In-flight operations retain their own fences
and are not cancelled by these orchestration ports.

| Failure | Outcome |
| --- | --- |
| Missing/unreadable durable cursor or post-hydration cloud head | Reject the phase with the original cause; no dependent hydration/jobs |
| UI guard installation fails | No published plan or recovery activation |
| Main remote unavailable/conflicted/pending | Preserve existing error/deferred domain status and durable local data |
| Shared/Finance remote unavailable | Preserve per-domain status; independently eligible domains may still hydrate |
| Optional persistence/folder/backup/alert failure | Report that failure once and continue independently eligible phases |
| Polling/Finance job start throws | Retain the failed task; never replay a partially started job |
| Access lost between phases | Skip subsequent effects; existing connectivity owners handle later wakeups |

`session.startupHydrationPromise` retains secondary/background completion or
failure. Its error observer only reports; it cannot turn a failed task into a
successful result or start alerts/jobs again. No schema, serialization, RPC,
ACK, owner/epoch or SQL semantics changed in this slice.

## Dependency direction

Main polling now confirms status against a clean acknowledged journal head and
live generation/access after the relevant awaits. Ten controlled regressions
reproduced false positive status in Orders fast paths and both apps after access
or control changes. Canonical status evidence is shared; each app retains its
access, projection and independent-domain policy. See the
[status confirmation contract](CLOUD_STATUS_CONFIRMATION_CONTRACT.md). This
slice changes status/return-value correctness, not ACK or data merge semantics.

Main ACK publication now has a canonical commit-before-publish boundary in both
apps, with sequence, generation and leadership checks. Six reproduced regressions
and real IndexedDB fault/restart scenarios protect it. See
[the ACK contract](STORAGE_CLOUD_ACK_CONTRACT.md) for ordering, local/cloud head
invariants and failure outcomes. Concurrent ACK edits retain pending journal data
and persist the same explicit-review fence policy used by concurrent rebase.

Pure core and protocol contracts may be imported by domain and application
logic. Storage and cloud implement infrastructure ports; composition supplies
their domain policies and UI callbacks. Views may use browser APIs. The enforced
part today is `storage/cloud/sync -/-> domains/ui`, `state -/-> domains/sync`,
and `domains -/-> ui` in both apps. These rules check direct imports. `shared/`
is a code-sharing location, not an unrestricted low-level layer; new contracts
and presentation primitives should have explicit owners.

## Startup progress

Factory parameter counts (AST object-pattern properties, measured against the
pre-slice main commit `85ea9278`):

| Factory | Before | Current |
| --- | ---: | ---: |
| Kupa lifecycle | 76 | 23 |
| Orders lifecycle | 50 | 24 |
| Shared startup protocol | - | 3 |
| Shared startup recovery | - | 1 optional scheduler; 2 bound journal ports |
| Kupa connectivity (including browser/timers) | - | 7 |
| Orders connectivity (including browser/timers) | - | 8 |
| Shared runtime resource owner | - | 2 |
| Shared recurring polling owner | - | 6; public API: start, stop, wake |
| Orders cloud startup | - | 6; public API: prepare, hydrateMain, hydrateSecondary |
| Orders local services | - | 5; public API: start, backupAfterHydration |
| Orders background startup | - | 6; public API: start |
| Kupa cloud startup | - | 6; public API: prepare, hydrate |
| Kupa local services | - | 3; public API: start |
| Kupa connection startup | - | 4; public API: bind, openLocal, dispose |

Lifecycle still has too many collaborators. These slices establish real owners
and contracts; they do not complete all startup phase decomposition or dispose
all shell listeners, timers and integration pollers.
Module graph now caps lifecycle collaborators at these measured counts and new
startup recovery/connectivity/hydration/background factories at eight.

Main cloud polling in both apps now owns its recurring timer through the
canonical `shared/runtime-polling.js`. Repeated start joins the existing cycle;
stop invalidates queued callbacks and drains already-started operations through
the existing sync/cutover ports. Cloud UI logout delegates to this owner.
Unexpected background failures are reported, including Shared/Finance finally
work; direct poll callers retain the original rejection. See
[polling ownership](CLOUD_POLLING_RESOURCE_CONTRACT.md). Other integration and
Shared-specific pollers still need their own ownership review.

Kupa bank and credit now use that recurring owner too. Immediate credit wakeups
join one active operation; timers stop on offline/dispose/logout and explicitly
resume through connectivity/cloud composition. Required owner/access scopes are
revalidated across preparation awaits before provider entry, while already-started
provider/durable work keeps its existing publication path. Five baseline races
were reproduced, with controlled lease/timer tests and real-browser journal
invariance coverage. See [finance automation ownership](KUPA_FINANCE_AUTOMATION_CONTRACT.md).
Orders finance jobs, other Shared-specific resources and Kupa credit preference
I/O remain separate slices.

Orders ongoing cloud status now has separate Main and Shared Checks publishers.
Startup records stop owning a document outcome after its live publisher runs;
Finance startup completion and timestamp refresh cannot erase that outcome.
Shared confirmation in both apps uses a canonical clean-head/visible-checks
predicate with live auth, leadership and local-work checks. Local Main and Shared
appends immediately invalidate old success, and optional backup awaits require a
fresh receipt. Kupa check persistence publishes through its existing Shared
status slot. These changes preserve the storage/RPC/retry protocols. Controlled
races and real IndexedDB restart/lost-response/held-ACK fixtures verify the
[source and confirmation contract](CLOUD_STATUS_CONFIRMATION_CONTRACT.md).

Local Bank Bridge HTTP is now canonical in `shared/bank-bridge-client.js`, with
explicit token/network/timer/abort ports and browser implementation in
`shared/browser-bridge-platform.js`. App-specific pairing/preferences remain
under `integrations/`; bank and credit due policy is pure and canonical.
Controllers receive the Bridge and no longer import its concrete adapter for
refresh constants. Malformed HTTP success fails as invalid protocol data;
authenticated local requests cannot follow redirects. Existing timeout,
endpoint fallback, cooldown, credential and finance publication policies remain.
See [the Bridge port contract](BANK_BRIDGE_PORT_CONTRACT.md). Local Document
Bridge now has the same explicit I/O direction: one canonical protocol client,
one generated integration owning installed pairing preferences, and the shared
browser platform. Eighteen baseline regressions proved malformed success,
pre-cancelled requests, anonymous-health storage coupling and swallowed preview
cancellation. One request scope now owns its controller/deadline/listener through
body consumption. Endpoint/version/Drive fallback contracts remain unchanged.
See [the Document Bridge contract](DOCUMENT_BRIDGE_PORT_CONTRACT.md). Google Drive
I/O now also has an explicit integration and login scope; Kupa credit
preference/timer I/O and remaining Finance capability boundaries require their
own slices.

Baseline for the Kupa phase slice: main `20dbb7a9`, preceding full branch GitHub
verification run `37752034470` passed (all CI groups, including browser,
PostgreSQL and Windows contracts). Focused
local tests distinguish deterministic behavior/architecture checks from the
full branch deployment gate.

## Next reviewable slices

1. **Capability boundaries:** Orders Warehouse, Service and Customers/Morning
   already have composition roots. Continue with Kupa Bank/Dashboard/shell and
   remaining Orders Finance/Checks wiring; narrow public APIs to actual consumers.
   Retire lazy references where producer ordering is possible, and bind genuine
   construction cycles explicitly. Do not introduce an application service locator.
2. **Lifecycle phases:** local/shared startup recovery and its UI-readiness
   boundary are now explicit. Orders remote hydration, local services and
   background startup, and Kupa cloud/local/connection startup have phase ports.
   Continue owner-transition/preflight decomposition and explicit job/resource
   ownership from their capability owners. Preserve
   lock/owner/protocol ordering and first safe render after Main and Shared.
   Test partial failure, write gating and resource cleanup. Expand resource
   ownership beyond connectivity without aborting in-flight durability commits.
3. **Storage/Cloud correctness:** document sequence, flight, owner/epoch and ACK
   revision invariants end to end; extend fault injection only where coverage is
   missing. Preserve valid no-op acknowledgements and pending data. Do not change
   serialization, SQL or compatibility as part of composition cleanup.
   Non-destructive Main hydration now commits before publication and fences the
   observed journal head, leadership and authorization. See the
   [hydration contract](STORAGE_CLOUD_HYDRATION_CONTRACT.md) for failure outcomes
   and independent Main/Shared/Finance ownership.
4. **I/O ports and static contracts:** move browser/network adapters behind small
   integration ports and add incremental checkJs to critical persisted/runtime
   boundaries. Preserve credential rules, CSP, cancellation and error semantics.
5. **Sources of truth and retirement:** inventory generated assets and SQL
   deployment copies before generation changes. Keep deployed migrations immutable.
   Inventory legacy readers/writers and supported clients; remove persisted-data
   readers only with migration and recovery evidence. CSS remains a later slice.

Use focused local tests for each slice. The full verification matrix includes
browser and PostgreSQL suites and must pass before deployment. A local focused
pass is not a deployment baseline; record the full CI result for this change.

## Main remaining workstreams (after local Bridge ports)

The Kupa save-confirmation review reproduced false no-flight success with a
real IndexedDB append. Save/poll now share a fresh scoped confirmation decision
after asynchronous boundaries; a committed Flight is distinct from a fully
clean Main head. See [the save confirmation contract](KUPA_CLOUD_SAVE_CONFIRMATION.md).
Historical journal compatibility, ACK/SQL/merge semantics and existing polling
owners remain intact. New reviews of transfer UI receipts and remaining jobs
must begin with behavior evidence rather than assuming similar bugs.

The Document Bridge deadline review also reproduced an actual Global Search
spinner after request-body timeout. The canonical client now distinguishes
`DOCUMENT_BRIDGE_TIMEOUT` from caller cancellation, retains the first cause and
supports preview metadata cancellation. Current recent/search/paging/preview and
match failures offer scoped retry; pagination retains its rows and old requests
cannot replace a newer query/preview. See [the deadline contract](DOCUMENT_BRIDGE_DEADLINE_CONTRACT.md).
Timeout remains outside automatic Drive fallback and does not introduce retries.

Google Drive now has canonical policy, transport and browser-platform owners,
with a small generated integration. Token/result caches and asynchronous
responses are fenced to the authenticated account and login epoch, including
logout/relogin of the same user; ordinary access-token refresh preserves the
scope. See [the Drive scope contract](GOOGLE_DRIVE_ACCOUNT_SCOPE.md). The review
reproduced cached-token use after account change/logout in both app runtimes.

Kupa credit now captures operation authorization independently of automatic
scheduling. A real-browser logout race proved stale projection publication;
refresh/reset/settings and structured diagnostics now publish only after a
scoped finance confirmation. Lease waiting/renewal and authenticated network
retries retain the captured scope. See [the credit operation contract](KUPA_CREDIT_OPERATION_OWNERSHIP.md).
Kupa Bank now has separate operation read/write ownership, scoped archive/image
transport and commit-before-cache publication. Real-browser logout and controlled
archive races reproduced stale success and cache replacement; the operator's
post-commit refresh warning is retained. See [the Bank operation contract](KUPA_BANK_OPERATION_OWNERSHIP.md).
Orders Bank/Credit and manual Finance operations now retain explicit read/write
authorization through provider results, leases, response parsing and publication.
Bank archive publication and post-commit readout are scoped and revision-confirmed;
the separate Finance scheduler owns stop/restart across logout/offline/disposal.
Real-browser logout and lost-response cases preserve Main/Shared journals and
recover the same record identities. See [the Orders Finance operation contract](ORDERS_FINANCE_OPERATION_OWNERSHIP.md).
Morning orchestration, other jobs and narrower Finance capability APIs remain
separate review tracks; this is not a claim of universal controller coverage.

Strict JavaScript checking now covers seventeen canonical authorization, publication,
status, startup, polling, current-record writer, Main RPC receipt/JSON equality
and durable-ACK policy modules, including the persisted JSON/checkpoint/operation
and cloud-record decoders and historical bootstrap compatibility. Their actual implementations and negative
consumer cases are compiled in the models gate, including offline tooling.
Pre-refactor sealed records retain exact bytes/checksums, and both sites have
real-IDB ACK rejection/abort/handoff tests with fresh-runtime ID/content recovery.
Main RPC success no longer substitutes the sent snapshot for missing authoritative
state. Both app regressions failed before the change; a controlled malformed-success
replay retains the flight and newer pending work through real IDB recovery.
Main/Shared recovery now decodes checkpoint structure before granting recovery
or claiming a writer. Historical missing/null metadata remains readable; invalid
JSON/state/metadata fails closed without discarding pending records. Both sites
have real-IDB restoration drills for these boundaries.
See [the static contracts scope](STATIC_CONTRACTS.md) and
[checkpoint recovery contract](STORAGE_CHECKPOINT_RECOVERY_CONTRACT.md).
Operation replay and cloud pending-state reads now share checked validation and
owner/epoch scope. Persistent deletion-intent corruption is classified as fatal;
historical annotations/indices and writer bytes remain intact. Real-IDB tests cover
compacted pending operations and retained emergency copies through exact test-only
restoration, durable ACK and fresh recovery of original IDs/content.
See [the operation recovery contract](STORAGE_OPERATION_RECOVERY_CONTRACT.md).
Base/Flight/Control kind and scoped pair decoding now also gates recovery, retained
Flight replay and fenced IDB transactions before ACK/compaction/control deletion.
Sixteen pre-change real-IDB faults reproduced unsafe acceptance in both apps;
raw stores and historical annotations are retained, with exact restoration and original
IDs/content verified after immutable replay. See [the cloud-record recovery contract](STORAGE_CLOUD_RECORD_RECOVERY_CONTRACT.md).
Full journal/IDB transactions/business RPC payload validation, Finance leases and most application consumers remain separate
coverage slices; this does not replace runtime validation or recovery gates.

These are completion tracks, each delivered through separate focused changes;
they are not a claim that every older audit finding is still present.

| Track | Remaining scope | Completion evidence |
| --- | --- | --- |
| Capability APIs | Orders Finance/Checks and Kupa Dashboard/Bank now have capability compositions; Kupa Bank has account query ports. Remaining private controller responsibility decomposition, shell/Notes interactions and shell wiring | Narrow public commands/queries, explicit binding and representative cross-capability behavior tests |
| Morning ownership | Captured account/login/write authority spans reservation, issuance, recovery and PDF publication; recovery wakes coalesce by scope and operation ID. Historical debt metadata requires a scoped local commit and retains unconfirmed staging for retry. Completed forms/browser/PDFs now clear across auth changes; unaccepted confirmations, Blob URLs, caches and download links have presentation owners. Other business-page caches and full workflow inventory remain | Native pre-change privacy/IDB evidence, original-operation replay, metadata abort/retry/reload, production composition races and 100 display cycles; see MORNING_OPERATION_OWNERSHIP.md, MORNING_RECOVERY_WAKE_IDENTITY.md, MORNING_METADATA_DURABILITY.md and MORNING_ACCOUNT_DISPLAY_PRIVACY.md |
| Calendar queue confirmation | Same-realm writes and committed cross-tab work are checked before synchronous publication inside a fresh native read transaction. Attributed offline display cache, local editor/confirmation fences, cross-tab account invalidation and Calendar resource disposal are covered. Competing delivery now has exclusive origin-wide ownership, a fresh queue read on grant and cancellation of ungranted work. Committed peer queue/cache writes now emit optional payload-free hints; a scoped native observer updates pending/display without provider retry or fabricated remote confirmation. Read failures have an independent warning | Native two-tab pre-change failures, pending identity retention, ordered same-ID delivery/replay, queued disposal, final-read abort and explicit recovery/reload; see CALENDAR_TRANSACTION_CONFIRMATION.md, CALENDAR_DELIVERY_OWNERSHIP.md, CALENDAR_COMMIT_OBSERVATION.md and CALENDAR_ACCOUNT_DISPLAY_PRIVACY.md. Client delivery ownership and point-in-time read evidence are separate from a provider ACK |
| Finance/read models and privacy | Kupa Credit separates confirmed Finance commit/display/local follow-up. Orders Bank/Credit automatic preferences now pause independently on storage failures, release busy and require explicit confirmed recovery; Kupa local Bank snapshots now disclose pending confirmation separately from Bridge status and provide scoped same-ID recovery/retry; remaining general Finance/optimistic edits, file/backup result separation and cross-tab cached document privacy | Pre-change Node/native-IDB evidence, exact snapshot/transaction recovery and scoped publication contracts; see KUPA_CREDIT_PUBLICATION_CONTRACT.md and KUPA_BANK_LOCAL_PUBLICATION.md. Other paths still require focused evidence |
| Runtime/resource ownership | Orders Checks owns private Shared flights and search/save wakeups; Orders Finance owns effects/preference timers and preserves started commits; Kupa Dashboard owns attributed cache/flights/cooldown/auth subscription; Bank owns controller operations/search/diagnostic and image lifetime. Remaining Kupa Shared and finance/integration/import jobs, other shell listeners, reconnect/owner transitions and preflight; Global Search owns nested control/auth listeners and preview cleanup | Start/stop/dispose idempotence, no duplicate/orphan jobs, live access fences and controlled failure tests |
| Remaining I/O ports | Remaining timers and other concrete browser effects after inventory; Kupa credit preferences, Google Drive and local Bridge clients now have explicit ports. Credit preference failure/restart policy still needs broader review | Injected fake ports, adapter contracts and import enforcement; installed settings/auth compatibility |
| Static contracts | Extend the existing strict JS gate beyond current writers/checkpoint/operation/cloud-record decoding/Main receipt/ACK policy, Credit preferences and Calendar authority/queue observation/confirmation to full journal/IDB transactions/business RPC/read candidates, Finance lease callers, capability ports and application consumers | A real mismatch fails CI; actual implementation bodies and negative consumers are checked, runtime validation and historical record readers remain intact |
| Bridge decomposition | Document HTTP/access gate, typed routing, native preview process/session, text/binary preview/file reads, match-text cache, complete PDF index reads/writes, file locks, manual maintenance process ownership and scoped Everything inventory now have explicit owners and native coverage. Bank HTTP/configuration/vault, owned shutdown, bank session/scraper lifecycle, account/enrichment reads, cheque-image and diagnostic/status file ownership, browser discovery and sequential credit orchestration also have explicit boundaries. Remaining Document search merge/pagination and scheduled maintenance/installer process boundaries, plus Bank larger issuer adapters and token/CLI process boundaries | Existing external contracts preserved, classified failures and provider tests before live scraper changes; see DOCUMENT_INVENTORY_BOUNDARY.md, DOCUMENT_PDF_INDEX_WRITE_CONTRACT.md, DOCUMENT_MAINTENANCE_PROCESS_OWNERSHIP.md and related Bridge contracts |
| Canonical sources and compatibility | SQL deployment inventory/generation; historical keys/RPC/readers and supported-client inventory | Immutable deployed migrations, deterministic generation, proven retirement criteria and restore tests |
| Readability/UI/release | Large modules by responsibility, dependency budgets, CSS/RTL/performance, final docs/rollback | Behavioral and visual regression checks, measured performance and full release gates |

Storage correctness is a mandatory gate across these tracks, not a new blanket
rewrite. Existing ACK/hydration/status contracts and real IndexedDB, offline,
lost-response, restart, owner-change and two-computer scenarios must stay green;
extend fault injection only for uncovered paths found during each review.

The Main ACK boundary now binds every reconciled checkpoint to the sequence
captured by its sync owner, including merge-conflict checkpoints. Browser caches
cannot infer that fence. The journal rejects missing/stale candidate sequences,
and native IndexedDB preserves its atomic metadata fence. Both apps have
before-fix native reproductions, unchanged-store rejection, fresh-document replay
and full sync-owner recovery coverage. See [the ACK contract](STORAGE_CLOUD_ACK_CONTRACT.md).
This closes a proven local recovery gap without changing schemas, SQL, RPC
idempotency, no-op revisions or the independent Shared/Finance owners.

Main post-commit publication now also requires the captured live storage
owner/epoch and authenticated login epoch. Colliding sequence/generation values
and an old adapter cache receipt cannot authorize another identity's model,
session, retry/conflict control, backup or follow-up flight. The browser cache
has its own scope fence for pending/conflict flags and outbox activation.
Native ACK/rebase identity transitions and fresh recovery extend the existing
contract; this does not redesign the ACK protocol or claim every other
application publication path has been audited.

The remaining Finance document writers and Orders' manual Kupa settings now
require a validated authoritative receipt before cursor advancement or success
publication. Three before-change native reproductions proved false success for
malformed HTTP 200 responses. Captured wire JSON, delegated no-op/replay policy,
classified unknown outcomes and read-only recovery preserve Main/Shared stores
and record IDs. See [Finance write confirmation](FINANCE_WRITE_CONFIRMATION.md).
This completes one write receipt boundary. Remote lease grants now also use a
canonical checked receipt tied to the requested token, a positive server fence
and a valid deadline. Incomplete grants, foreign granted tokens and malformed
renewals cannot authorize provider entry; real contention remains separate.
Four pre-change native reproductions and retained Main/Shared recovery evidence
cover both Bank/Credit owners in both apps. See
[Finance lease confirmation](FINANCE_LEASE_CONFIRMATION.md).
Full Finance transaction/business input typing, broader unknown-outcome policy
and narrower capability APIs remain separate work.

The Credit nearest-cycle table body now has one canonical presentation owner,
`shared/credit-detail-sections.js`, used by both application views with four
explicit formatting/rendering ports. This removes duplicate cycle grouping and
keeps the responsibility budget intact while preserving per-card open-cycle
selection and full-month overlap. Native UI coverage verifies partial bank
settlement, mixed-month headings and unchanged issuer record IDs.
See [Credit display contract](CREDIT_NEAREST_CYCLE_DISPLAY.md).

Committed Main ACKs now also distinguish safe publication from a later local
edit. A bounded post-ACK recovery proves the new journal delta against the visible
model and authoritative base, then uses an atomic writer/head/checksum CAS to
retain pending work without a permanent benign `concurrent-ack` fence. Real
conflicts and changed authority still require review. Orders has a backup-first,
guarded recovery action for an existing fence, with native abort/quota/reload
coverage. See [the recovery contract](ORDERS_CONCURRENT_ACK_RECOVERY.md).

Document Bridge now separates its common HTTP/origin/token/body/response boundary
from typed private routing and command implementations. Seven explicit command
facades preserve existing file/search/preview/maintenance ownership. Installer
dependency checks and actual isolated Windows startup protect the new module
boundary; remaining index/preview and Bank server decomposition continue as
separate slices. See [the HTTP contract](DOCUMENT_BRIDGE_HTTP_BOUNDARY.md).

The native preview helper now has a scoped command/session owner and a separate
Windows process adapter. Two before-change reproductions proved duplicate first
startup and a former child's exit rejecting the replacement's command. Readiness,
per-child streams/pending, bounded deadlines, stopped-owner recovery and terminal
disposal now prevent those races, with 100 resource cycles, real child pipes and
the compiled C# host exercised without operator files or dialogs. See
[native preview ownership](DOCUMENT_NATIVE_PREVIEW_OWNERSHIP.md).

Document text/binary preview policy now has three explicit ports and checked
response kinds, while a separate native file adapter owns bounded reads and
handle cleanup. A before-change native growth test proved that the old binary
path could exceed its budget after search metadata was captured. Bounded
lookahead, short-read accumulation and native HTTP/client integration now enforce
that limit without changing Office routing or wire formats. Remaining Document
index/cache and Bank server decomposition are separate slices. See
[preview file boundary](DOCUMENT_PREVIEW_FILE_BOUNDARY.md).

Document match-text caching now also has per-fill publication authority. Two
before-change production-helper/native-file reproductions proved stale cache
resurrection after invalidation and duplicate extraction for one path/version.
Identity-fenced success/error, owned coalescing, bounded LRU/TTL and terminal
disposal now preserve replacements and original callers without hidden retries.
Actual match responses, 100-reader and 100-replacement cases extend the checked
contract. Persistent index publication remains separate work. See
[match-text cache ownership](DOCUMENT_PREVIEW_CACHE_OWNERSHIP.md).

Persisted PDF index loading now constructs a complete, checked candidate before
synchronous publication. Two before-change regressions proved successful reads
after journal I/O/parse failure. Native server/compaction tests now retain the
last-known model and exact file bytes under faults, prevent unread journal
truncation and recover the same paths/text/form geometry after exact restoration
and fresh read. Successful reload retires related match text. Existing writer
format/schema and business storage remain independent. See
[PDF index read contract](DOCUMENT_PDF_INDEX_READ_CONTRACT.md).

Document index/maintenance locking now uses captured process/token identity,
live-PID exclusion, serialized dead-owner reclamation and confirmed scoped
release. A before-change native test proved age-based takeover of a live owner.
Unknown ownership/probe/cleanup failures remain visible; started work drains.
Two native contender processes and 100 scoped cycles extend the checked contract.
Legacy PID metadata remains readable; transient tokens do not change index or
business wire formats. See [file-lock ownership](DOCUMENT_FILE_LOCK_OWNERSHIP.md).

Manual Document maintenance now also owns its start probe, child messages,
coalesced stop handshake, close proof and bounded disposal. Before-change
production-function tests proved launch after shutdown and leaked worker IPC on
init failure; native workers now drain a held synthetic commit and terminate on
failure without orphaned IPC. Status rereads the manual owner after scheduled
lock observation. Shutdown refuses teardown until drainage is established. See
[maintenance process ownership](DOCUMENT_MAINTENANCE_PROCESS_OWNERSHIP.md).

PDF index mutations now have a checked commit-before-publication owner using the
canonical decoder to stage exact wire bytes. Native before-change regressions
proved no-newline append corruption and uncommitted on-demand Map publication.
Storage failure is distinct from extraction failure. Synced temporary snapshot
and journal replacement, retained raw faults and two native process/crash drills
extend the index recovery contract without format changes. A committed head is
reused only after signature revalidation to avoid repeated full journal parsing.
See [PDF index write contract](DOCUMENT_PDF_INDEX_WRITE_CONTRACT.md).

Everything result decoding and PDF inventory enumeration now have explicit,
checked boundaries. Before-change production regressions proved false-empty
JSON/count acceptance, silent row loss and last-page cancellation publication.
One captured native source, whole-page validation, unique progress and before/
after-await stop fences now refuse invalid reconciliation while retaining index
bytes and backlog. The actual pinned ES source confirms blank zero-result output
compatibility. Search/recent normalization use the same decoder. See
[inventory boundary](DOCUMENT_INVENTORY_BOUNDARY.md).

## Major completion stages from the current code

These are bounded completion tracks, not a restart of completed refactors.
Structural changes stay separate from SQL, persisted formats, provider policy
and CSS. Each slice needs concrete evidence/contracts and its appropriate gate.

The October 12, 2026 review of the supplied continuation plan confirms the
initial composition width: Kupa/Orders roots had 61/68 static imports; their Main
sync factories have 41/32 collaborators, Cloud UI has 41/44, Backup UI has 31/39,
and Kupa Bank/Orders Finance controllers have 28/29. These counts justify
consumer-driven capability boundaries; they do not by themselves prove bugs
or justify arbitrary splits. The Finance and Checks slices reduce Orders to 56
imports; the Dashboard/Bank query slice reduces Kupa to 60. Orders Finance
connectivity/clipboard/diagnostic-download effects now use
an explicit adapter. The wide private controllers remain. Bank Bridge requires
HTTP/vault/session/provider boundaries and fixtures before policy-preserving
decomposition. The canonical migration manifest matches the unchanged SQL.

The proposed direction is sound, with two qualifications: existing capability,
startup and polling owners must be reused, and a context timer notification
must not be mistaken for an independently owned scheduler. Main cloud polling
already has an explicit owner (see CLOUD_POLLING_RESOURCE_CONTRACT.md).
Historical persisted readers remain compatibility boundaries, not evidence of
parallel V1 writes. Wide factories, resource fields, file size and long lines
are review signals; each change needs a responsibility/consumer inventory and
behavior evidence. The proven save collision therefore comes first, followed
by capability/runtime work and strict boundaries, before larger Bridge or
cosmetic restructuring.

| Order | Remaining stage | Exit criterion |
| --- | --- | --- |
| 0 | Close proven application save scheduling defects before broader structural work; Orders Main/Checks timer collision has a bounded owner/receipt slice | Pre-change failing regression, independent obligations, quiescence, strict owner contracts and full branch CI; see ORDERS_SAVE_SCHEDULING_CONTRACT.md |
| 1 | Complete the remaining capability/runtime boundaries after Orders Finance/Checks and Kupa Dashboard/Bank: private controller responsibilities, shell and Kupa Shared/finance/import listeners/jobs | Explicit commands/queries and start/dispose; no broad app context, stale callback publication or duplicate jobs |
| 2 | Extend strict contracts to real transaction/RPC/business consumers: journal/IDB callers, Finance lease callers, Morning/Calendar commands and capability ports | Implementation bodies and negative consumers fail on mismatch; unknown payload validation and historical fixtures stay covered |
| 3 | Finish Bridge responsibility boundaries: Document search merge/pagination orchestration and scheduled maintenance/installer process boundaries; Bank account/transaction reads, cheque-image cache, installed-browser selection and larger issuer adapters. Bank HTTP/configuration/vault, shutdown, bank session/scraper lifecycle and sequential credit orchestration now have explicit boundaries | Small public APIs; native process/file and endpoint/failure tests; existing provider retry/fallback semantics preserved |
| 4 | Canonical SQL deployment sources and compatibility inventory | Deterministic generated-current checks; immutable deployed migrations/receipts; removal only with consumer evidence and restore coverage |
| 5 | Large view/controller responsibilities, measured performance, then CSS/RTL | Representative behavior/visual regression and measured budgets; no split based only on file length |
| 6 | Final recovery/rollout drill and runbooks | Full CI plus controlled actual two-computer/live-provider checks where required; backup/rollback and unknown-outcome procedures exercised |

Types and failure tests accompany their relevant stage. Physical two-computer
and live provider behavior are separate evidence from synthetic CI ports; CI
does not certify them automatically. Existing Storage V2 ACK/owner/recovery
contracts remain mandatory regression gates throughout.

Kupa Credit now joins the explicit capability boundaries. Finance composition,
navigation/connectivity and UI actions use commands, queries and runtime ports;
the controller is private. Card-order presentation moved into Credit, reducing
Kupa Main to 56 static imports. Its browser effects and connection form have owners,
disposal fences late publication, and drainage includes renewal requests and
accepted editor receipts. Strict input contracts preserve credential strings.
See [Credit capability ownership](KUPA_CREDIT_CAPABILITY.md) for evidence, native
retained-journal verification and the remaining scope.

Both automatic local backup paths now own captured targets, detached snapshots,
serialized work and private wakeups. Proven wrong-target writes and Kupa
wrong-directory verification cleanup are fixed; V2 source quiescence drains
accepted backup commands. The redundant Kupa startup service promise alias is
removed. See [automatic backup ownership](AUTOMATIC_BACKUP_OWNERSHIP.md) for
contracts, native file/journal evidence and the remaining folder/UI scope.

Orders working-file writes and explicit restore snapshots now share one private
queue with captured selections, detached inputs and FIFO safety barriers. Proven
late permission publication, cross-directory forced backups and parallel restore
streams are fixed. Folder UI uses focused selection/authority/persistence/picker/
presentation ports; V2 source quiescence drains file and permission work before
automatic backups. Context preparation/queue/promise fields are removed. See
[Orders folder write ownership](ORDERS_FOLDER_WRITE_OWNERSHIP.md) for behavioral,
native file/journal and strict boundary evidence.

Primary tab locks now privately own native release, coalesced acquisition,
fallback identity and all heartbeat/channel/listener resources in both apps.
Before-change tests proved self-demotion on native reacquisition, duplicate
fallback registration and two accepted writers with an inherited session ID.
An inert browser adapter, final disposal/pagehide fences and native fresh/secondary
tab/journal tests cover the corrected boundary. The unused context release callback
and Orders tab-guard collaborators are removed. See
[primary tab lock ownership](PRIMARY_TAB_LOCK_OWNERSHIP.md), including the explicit
limits of the non-atomic storage fallback and the unchanged read-only-until-reload
policy.

Calendar sync/reconnect flights and browser resources now have private owners.
Before-change regressions proved new-login gestures blocked by old context
promises, superseded day-editor callbacks and non-final pre-composition disposal.
Async commands and accepted native queue writes can drain after final disposal;
exact Calendar/Main/Shared records and original identities are retained. The
three Calendar resource fields are removed from contexts and its controller uses
connectivity/scheduling ports. See
[Calendar runtime resource ownership](CALENDAR_RUNTIME_RESOURCE_OWNERSHIP.md) for
scope, strict boundary evidence and the remaining presentation/OAuth/controller
decomposition.

Bank Bridge configuration now has one private FIFO owner shared by all seven
mutations, coherent status queries and both mutually exclusive provider commands.
Before-change native HTTP regressions proved lost profile updates, reset undone
by a held save and unguarded mutation during provider work. Settings validation,
encrypted vault I/O and Windows protection/process ports are separate from HTTP;
ownership covers cleanup and result publication. Exact ciphertext rollback,
real CurrentUser DPAPI, installer dependency closure and frozen provider policy
fixtures cover the boundary. See
[Bank Bridge configuration ownership](BANK_BRIDGE_CONFIGURATION_OWNERSHIP.md)
for scope and remaining HTTP/provider/process decomposition.

Bank HTTP now has an inert handler and strictly checked private route registry.
Status queries, financial commands and safe diagnostic queries expose focused
facades; HTTP has no vault/browser/metadata authority. Command ownership retains
accepted provider work through publication even after client disconnect. Existing
native HTTP characterization and frozen public-response/provider-policy fixtures
protect the wire and issuer behavior; installer graph and actual staged startup
with Windows HTTP/DPAPI writes cover concrete composition. Import/collaborator
budgets guard these boundaries. See
[Bank HTTP capabilities](BANK_BRIDGE_HTTP_CAPABILITIES.md) for the preserved Bank
alias/CORS policy and remaining session/provider/process lifecycle scope.

Bank process shutdown now closes admission and joins accepted configuration,
read and provider tasks, followed by the diagnostic queue, listener closure and
exit. Its idempotent owner retains work after client disconnect and owns signals
and the delayed shutdown flight. Replacement has no kill authority: positive
shutdown acknowledgement and refused loopback TCP establish normal closure;
timeouts and lost responses stop replacement. Native cmd.exe coverage also
protects startup-failure rollback from swapping an unconfirmed active runtime.
See [Bank shutdown ownership](BANK_BRIDGE_SHUTDOWN_OWNERSHIP.md) for the reproduced
failures, strict contracts, native staging evidence and remaining provider scope.

Bank session authentication and scraper lifecycle now have separate inert
capabilities. Credit connector entry and sequential multi-profile orchestration
have their own facades. Bank orchestration and Credit session implementations
are strictly checked, with invalid consumer and implementation-mutation tests.
Historical provider digests remain unchanged and session/error digests preserve
the baseline policy. Native staged-server coverage joins the actual HTTP command,
session, bank reader and local diagnostics while holding terminal browser cleanup.
See [Bank provider boundaries](BANK_BRIDGE_PROVIDER_BOUNDARIES.md) for the required
ports, before-change characterization and remaining reader/cache/adapter scope.

Bank account/window reading, transaction enrichment, cheque images and installed-
browser selection now have inert capabilities with explicit collaborator/API
budgets. Native file fault injection proved an orphaned temporary binary after
metadata write failure; publication/refresh now clean their owned attempts. A
second pair of native faults proved early abandonment of sibling read/delete
attempts; all accepted siblings now settle before returning the original failure. A
private serial file owner prevents partial-pair observation and joins accepted
image reads during shutdown, including disconnected clients. Twenty-three frozen
read-policy functions preserve the baseline provider behavior, and actual browser/
file-owner implementations have strict negative consumer/mutation coverage.
Required Windows tests run held native image reads, cache faults, provider cleanup
and DPAPI alongside transitive installer staging checks. See
[Bank reader and artifact ownership](BANK_BRIDGE_READER_ARTIFACT_BOUNDARIES.md)
for evidence, preserved formats and remaining issuer/diagnostic/Document scope.

Bank status and diagnostic documents now have fixed namespace capabilities with
private FIFO owners and atomic temporary-file publication. Before-change native
faults proved truncated status, orphaned Bank/Credit diagnostic attempts and an
unowned credit-log summary; publication cleanup and shutdown drainage now retain
these obligations. Metadata patches capture inputs and preserve historical/unknown
JSON fields. Safe diagnostic policy has one canonical model and frozen AST checks;
its rotating log owns readers together with append/prune/rotate. The actual JSON
owner has strict negative consumer/implementation coverage. Required Windows
HTTP/DPAPI tests retain disconnected artifact/log readers through normal shutdown,
and installer dependency closure includes re-exports. See
[Bank artifact ownership](BANK_BRIDGE_ARTIFACT_OWNERSHIP.md) for exact compatibility,
failure evidence and remaining issuer/token/Document scope.

Credit adapter routing, browser authentication/lifecycle, HTTP transport/policy,
issuer models, month projections and diagnostic evidence now have explicit
canonical modules. The initial stable facade retained its 35 former exports;
that facade was retired in the subsequent Credit core stage. The 118 frozen
declarations protect reviewed provider behavior. Before-change tests proved that
CAL response-body interruption escaped network classification; the acquisition
boundary now retains its stage/cause without additional requests. Strict sync
scope contracts, pure-module/import budgets, acyclic graph checks and mandatory
native staged Credit/Windows coverage protect this boundary. See
[Credit adapter responsibility boundaries](CREDIT_ADAPTER_RESPONSIBILITY_BOUNDARIES.md)
for the evidence and the remaining wide factory, complete payload typing, shared
helper and DigitalV3/Camoufox scope.

Credit core profile, transaction, amount and failure policies now have canonical
pure modules. All Credit production consumers import those narrow models directly;
the Bank Bridge library initially retained only its 34 Bank functions/constants
before its subsequent Bank core retirement. The temporary
Credit adapter/diagnostic facades, uninstantiated generic scraper and date alias
have been retired after migrating all consumers and installer entries.
Immutable AST fixtures preserve 73 Bank and 30 Credit declarations, including
credential identity, charge signs, pending authority and cooldown policy. The
actual monetary codec has strict negative consumer and implementation checks,
and staged Bank/Credit server tests cover the new import graph. See
[Credit core model boundaries](CREDIT_CORE_MODEL_BOUNDARIES.md) for the next
Credit payload contract work.

The remaining Bank model library is now retired. Thirteen canonical modules
separate terminal-login polling, navigation policy, account identity/selection,
cheque and permission details, transaction/date normalization and failure policy.
All 70 active Bank declaration ASTs match the immutable fixture; three helpers
with only obsolete test consumers were removed. Production, tests and installer
entries import the actual owners directly. Strict implementation and negative
consumer checks cover the selector, date and detail codecs; mutation/import/effect
guards protect the boundary. Native staged Windows tests verify real HTTP startup,
DPAPI and provider cleanup through the new graph. See
[Bank core responsibility boundaries](BANK_CORE_RESPONSIBILITY_BOUNDARIES.md)
for retained provider semantics and remaining object/envelope typing.

The recurrent Orders document privacy test timeout was reproduced as two search
owners publishing to the same DOM: cloned nodes did not remove the application's
auth subscription. The fixture now disposes that owner before binding its source
and forces the old auth interleaving inside each request. Local/cross-tab cases
retain the original privacy, listener-disposal and exact Journal assertions.

Orders Finance document commands now own Kupa/Finance mutation, manual lease
queuing, receipts and separate readout confirmation. The controller receives
three commands and one read query rather than raw writers; collaborators
decrease from 30 to 23. Embedded-Finance and two-write Bank fallbacks are removed,
and a missing lease port cannot manufacture a grant. Frozen policies and
conflict/FIFO/scope tests preserve active behavior; native browser/IDB tests
retain unknown-confirmation recovery. The actual publication boundary has strict
implementation and negative-consumer checks. See
[Orders Finance document commands](ORDERS_FINANCE_DOCUMENT_COMMANDS.md) and
[remaining major work](ARCHITECTURE_REMAINING_WORK.md); private Bank/Credit
workflows and full writer/caller typing remain.

Orders Bank archive readout now owns scoped caches, hydration flights, projection
revisions and all accepted row/snapshot reads. Three pre-change failures proved
early hydration completion, early Finance lease release and former-account
error reporting. Accepted siblings are joined, stale errors are fenced and Bank
pauses invalidate background publication without abandoning accepted work.
Controller collaborators decrease from 23 to 20. The actual owner is strict
`checkJs`, with negative consumers, body mutation and boundary budgets. Native
browser tests retain exact Main/Shared IndexedDB journals under each failure.
Provider, archive-window, receipt and persisted-format policy is preserved. See
[Orders Bank archive readout](ORDERS_BANK_ARCHIVE_READOUT.md) and
[remaining major work](ARCHITECTURE_REMAINING_WORK.md).
