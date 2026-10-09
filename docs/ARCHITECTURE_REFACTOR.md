# Architecture refactor: verified baseline and next slices

This plan records boundaries that have been checked in the active code. Changes to
persisted formats, Storage V2 ownership, journal replay, and cloud RPC semantics
remain separate from structural refactors.

## Verified now

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
and cloud-record decoders and historical bootstrap compatibility. Their actual implementations and 131 negative
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
| Capability APIs | Orders Finance/Checks and shell/Notes interactions; Kupa Dashboard/Bank read-model and remaining shell wiring | Narrow public commands/queries, explicit binding and representative cross-capability behavior tests |
| Morning ownership | Captured account/login/write authority now spans reservation, issuance, recovery and PDF publication; remaining cross-tab cached-display policy and full business workflow inventory | Native IDB pre-change reproduction, original-operation replay and production composition races; see MORNING_OPERATION_OWNERSHIP.md |
| Finance/read models and privacy | Distinguish non-outbox failures, unsaved projection and optional backup warnings; define cross-tab cached document display policy | Truthful separate commit/publication/backup results and controlled two-tab auth/visibility scenarios |
| Runtime/resource ownership | Remaining Shared-specific and finance/integration jobs, shell listeners, reconnect/owner transitions and preflight | Start/stop/dispose idempotence, no duplicate/orphan jobs, live access fences and controlled failure tests |
| Remaining I/O ports | Kupa credit preferences/timers and other concrete browser effects after inventory; Google Drive and local Bridge clients now have explicit ports | Injected fake ports, adapter contracts and import enforcement; installed settings/auth compatibility |
| Static contracts | Extend the existing strict JS gate beyond current writers/checkpoint/operation/cloud-record decoding/Main receipt/ACK policy to full journal/IDB transactions/business RPC/read candidates, Finance leases, capability ports and application consumers | A real mismatch fails CI; runtime validation and historical record readers remain intact |
| Bridge decomposition | Bank HTTP/vault/session/provider/retry diagnostics; Document HTTP/auth/index/preview | Existing external contracts preserved, classified failures and provider tests before live scraper changes |
| Canonical sources and compatibility | SQL deployment inventory/generation; historical keys/RPC/readers and supported-client inventory | Immutable deployed migrations, deterministic generation, proven retirement criteria and restore tests |
| Readability/UI/release | Large modules by responsibility, dependency budgets, CSS/RTL/performance, final docs/rollback | Behavioral and visual regression checks, measured performance and full release gates |

Storage correctness is a mandatory gate across these tracks, not a new blanket
rewrite. Existing ACK/hydration/status contracts and real IndexedDB, offline,
lost-response, restart, owner-change and two-computer scenarios must stay green;
extend fault injection only for uncovered paths found during each review.
