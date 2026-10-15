# Remaining major architecture work

This is the current inventory after Bank/Credit Bridge model separation and
Orders Finance document-command and both applications' Bank archive readout
extraction, Kupa Bank snapshot commands, shared Finance lease renewal ownership
and both applications' Bank/Credit local connection ownership, Kupa Notes
durability, Cloud/Sync/Backup capability decomposition, Calendar session ownership
and shared Morning PDF presentation/accepted-command ownership. The chronological
[refactor record](ARCHITECTURE_REFACTOR.md) documents completed slices; older
remaining-scope paragraphs describe their stage's starting point.

## Verified foundations

- Morning draft/official PDF publication uses one strict five-port owner. Two
  reproduced stale-preview/modal-replacement races are fenced; close/replacement
  releases native URLs/observers while accepted provider reads remain drainable.
  The browser tracks complete accepted read/metadata commands. Unknown media
  responses are decoded before display; immutable issuance/debt/recovery policies
  remain unchanged. Issuance/recovery now tracks complete accepted commands and
  superseded flights, with final disposal and joined customer runtime drain.
  Verified debt allocation has a separate strict five-port capability with an
  immutable financial policy. Reconciliation now has a strict five-port owner;
  operation/issuance replies and failure envelopes are decoded before retry,
  allocation or cleanup decisions. Six reproduced evidence gaps retain exact
  recovery, with native malformed-response/resumption coverage. See
  [Morning operation commands](MORNING_OPERATION_COMMANDS.md).
  Status decisions now have a strict six-port owner and a pure presentation
  model. Current read/form publication fences preserve unrelated draft guards;
  application joins are bound to operation identity and current joined displays.
  Immutable messages, strict implementation mutations and native journal/modal
  races protect the boundary. See [Morning status ownership](MORNING_STATUS_OWNER.md).
  Issuance/recovery decision surfaces now share a strict four-port mounted
  session. Reproduced detached/closed choice writes and retained recovery-only
  account displays are fenced, preserving accepted confirmation allocation and
  unrelated draft guards. See [Morning modal presentation](MORNING_MODAL_PRESENTATION.md).
  Form/footer, allocation warnings, recovery comparison and operation views now
  use a strict readonly presenter with two ports. An immutable 207-case fixture
  preserves output policy, while native held confirmation/choice tests retain
  exact journal events and unrelated dirty drafts. The controller decreases from
  about 51.6 KB to 41.5 KB at that stage. Form actions now require their mounted
  session and receipt/Bank controls use scoped roots. Bank link intent/catalog
  has a strict five-port owner, a strict four-port field adapter and private
  composition, replacing fifteen flat collaborators. Immutable twelve-function
  payment policies and 576 Bank link/restore cases plus native control/payload/drain
  checks preserve behavior. See [Morning form/Bank capabilities](MORNING_FORM_BANK_CAPABILITIES.md).
  A strict three-port read catalog now owns search caching, metadata flights,
  details and fresh links. Unknown replies must match operation/document identity
  before local metadata persistence or display; a reproduced foreign-ledger link
  is blocked. Null metadata remains retryable and native failures retain journals.
  Broader customer orchestration and general form/payload validation remain open.
  See [Morning catalog](MORNING_CATALOG_OWNER.md), [Morning operation drain](MORNING_OPERATION_DRAIN.md) and
  [Morning media ownership](MORNING_DOCUMENT_MEDIA_OWNER.md).

- Orders Calendar separates connection intent, Google verification, sync/reconnect
  flights and polling from its display/editor controller. A private capability
  removes raw Google API/journal/login ports; the controller has 16 inputs, down
  from 19. Two reproduced late authorization/disconnect disposal races are fenced
  without losing accepted-request drain. Strict session bodies, negative consumers,
  immutable event/sync policies and native disposal fixtures accompany the slice.
  Readonly board/toolbar projection, event permissions/pending overlays and full/
  quick editor parsing now have strict boundaries. The controller decreases from
  41.5 KB to 29.0 KB. Unknown Google envelopes/events/replies are decoded before
  cache publication or durable ACK; malformed replies retain exact pending
  operations. Four-worker reads join accepted siblings on failure. Immutable
  original functions and executed presentation policies, strict body mutations
  and native failure/restart/recovery cases protect the slice. Editor modal/
  command decomposition and persisted-row validation remain open. See
  [Calendar projection and payloads](CALENDAR_PROJECTION_PAYLOADS.md) and
  [Calendar session capability](CALENDAR_SESSION_CAPABILITY.md).

- Kupa sticky-note input is journaled before owner transfer can fence writes.
  A native before-change regression reproduced loss of an unblurred edit;
  transfer and restart now retain its exact content. Strict Notes commands own
  accepted saves and confirmation cancellation, and source quiescence drains
  them. Both Cloud/Backup roots now compose distinct auth/open/transfer/reset,
  restore/local/catalog/presentation owners. Main sync separates flight, ACK,
  confirmation and polling lifetimes. Its runtime now takes twelve role APIs,
  bound by ten-owner compositions in both startup roots, replacing 33/42 flat
  inputs. Common strict write authority and Kupa Main wire transport have owners;
  immutable save/hydration/recovery policies and production composition fixtures
  protect the slice. Internal save/hydration coordination remains separate work.
  See [Main sync composition](MAIN_SYNC_COMPOSITION.md).
  See [Cloud/Sync/Backup boundaries](CLOUD_SYNC_BACKUP_CAPABILITIES.md).

- The Orders Main/Checks save collision is fixed and regression-protected.
- Orders Finance/Checks and Kupa Bank/Dashboard/Credit have private capability
  compositions. Both Main roots currently import 56 modules.
- Former timer/promise/lock-release fields no longer occur in either
  `state/contexts.js`. Main/Shared sync, backups, working files, primary locks
  and Calendar have explicit runtime ownership slices.
- Bank HTTP/configuration/vault, provider sessions, browser selection,
  account/enrichment, cheque files, status/diagnostics and shutdown have owners
  and native tests. Broad Bank/Credit libraries and adapter facades are retired.
- Orders Finance documents have a command owner, required real leases and
  current write APIs. The controller has 18 explicit collaborators, down from 30
  overall, including the local Bank/Credit connection owners, and no
  embedded-Finance or two-write Bank fallback.
- Orders Bank archive cache, flights and projection revisions belong to a strict
  read owner. Failed reads retain accepted siblings; account handoff suppresses
  former-account error details; Bank pauses prevent background publication.
- Kupa Bank archive owns scoped caches and accepted reads, with disposal/drain
  and a pause during Bank refresh. Its controller has 13 collaborators, down
  from 28 across archive and snapshot slices. Both apps use one strict paired-read algorithm with separate owners;
  Kupa's local/file persistence and revision/render policy remain independent.
- Kupa Bank snapshot commands require atomic cloud writes and real lease ports;
  local/file saves no longer call Finance cloud writers. Both browser apps retire
  the unused raw Bank merge export, retaining the active SQL reconciliation path.
- Bank/Credit in both apps join accepted lease renewals before release and
  completion. The strict heartbeat owner captures account/token/epoch, fences
  failed renewals and owns idempotent asynchronous stop. Kupa Credit cleanup
  uses account authority independently of publication fences; automatic
  preflights suppress former-account network error details. The old heartbeat
  facade is retired. See [lease runtime](FINANCE_LEASE_RUNTIME.md).
- Kupa Credit local status/profile/diagnostic operations have a private strict
  owner with pairing generations, accepted-work drain and disposal. Financial
  refresh/reset combine device and account authority; native forms own their
  successful closure. The controller now has 13 collaborators, down from 17, and
  the obsolete modal-close service port is removed. See
  [Credit local connections](KUPA_CREDIT_CONNECTION_OWNER.md).
- Orders Credit connections have a strict owner for pairing/status, local
  diagnostics and vault commands. Forms own their pairing/identity/listeners, respect native close visibility and capture
  authority before confirmation. Finance joins controller, local connection,
  archive and confirmation work after disposal. Native IDB and immutable
  issuer/Bank/input policies protect this slice. See
  [Orders local connections](ORDERS_CREDIT_CONNECTION_OWNER.md).
- Strict bodies and negative consumers cover critical storage JSON/receipts,
  scopes, resource ports and selected business/Bridge boundaries. Coverage is
  selective, not a complete application type proof.
- Bank scalar evidence is canonical across both sites and the standalone Bridge.
  Missing balances cannot become authoritative zero; nullable financial fields
  remain unknown. Both Bank workflows require corrected Bridge v74 and captured
  device authority before provider/publication work, independently of lease
  cleanup. Kupa command acceptance now uses the canonical task owner. See
  [Bank financial evidence](BANK_FINANCIAL_EVIDENCE.md).
- Orders local Bank status, vault/account commands and diagnostic publication
  have a strict owner. Its native form/listener and confirmations have a joined
  presentation lifetime, and stale pairing/results cannot replace current
  readout or invent a Bridge version. Broader financial edit contracts remain open. See
  [Orders Bank connections](ORDERS_BANK_CONNECTION_OWNER.md).
- Kupa local Bank status/cache, vault/account commands and diagnostics have a
  strict six-port owner. Native forms own identity, pairing and listeners;
  accepted requests drain after disposal. Financial warnings survive passive
  status probes, and local vault acknowledgements preserve real version evidence.
  The controller's effect port and embedded local connection code are retired;
  provider refresh now belongs to its operation owner; broader manual-edit contracts remain open. See
  [Kupa Bank connections](KUPA_BANK_CONNECTION_OWNER.md).
- Full CI covers PostgreSQL, native browser/IDB, lost ACKs, ownership changes,
  recovery and Windows, and remains mandatory for each slice.
- Both applications' full local Finance connection import now has a strict
  device owner and native file-selection owner, joined by Kupa Bank and Orders
  Finance. Confirmation/publication cannot drift to a replacement device;
  disposal removes inputs/listeners and drains accepted file/Bridge work. The
  callable importer and unowned picker exports are retired; canonical document
  and historical identity algorithms are preserved. See
  [Finance import ownership](FINANCE_CONNECTION_IMPORT_OWNERSHIP.md).
- Orders Bank accepted-result publication has a strict seven-port owner for
  reconciliation, paired archive verification, Checks barriers and one atomic
  snapshot. Finance joins its preparation/publication work after disposal. The
  private financial model and full provider/lease algorithm match the immutable
  pre-extraction AST; old flat publication dependencies and silent defaults are
  retired. Provider acquisition now belongs to the Bank/Credit operation owners.
  See [Bank snapshot publication](ORDERS_BANK_SNAPSHOT_PUBLICATION.md).
- Bank cloud archive reconciliation uses one canonical four-port owner in both
  apps, based on the Orders sequence and six identical financial policies.
  Morning enrichment stays in the Orders read adapter; Kupa local persistence
  and receipt-confirmed Main publication retain tested data ownership. Kupa's
  flat transaction/image defaults and duplicate policies are retired; Orders
  publication now has five ports. See [path alignment audit](BANK_PATH_ALIGNMENT.md).

- Bank/Credit lease operations now share a canonical three-port owner for
  acquisition, renewal and cleanup. Disposal stops wakeups immediately and
  joins accepted requests/providers before same-account release; account changes
  remain fenced. Four reproduced disposal regressions, strict actual bodies,
  immutable financial policies and native journal/recovery fixtures protect it.
  Flat controller lease callbacks and Credit's heartbeat set are retired. See
  [lease operation owner](FINANCE_LEASE_OPERATION_OWNER.md).

- Orders Bank refresh now has a strict six-port operation owner for cloud
  freshness, lease/provider acquisition, snapshot publication and joined cleanup.
  The controller retains admission and presentation; its direct Bank provider,
  snapshot and lease-session workflow is retired. Bank's dedicated lease owner
  retains original cleanup authority independently of device/component disposal.
  The immutable before-change AST and older lease/publication fixtures still
  match. Native lifecycle coverage now includes four preflight/provider phases
  and both exact Main/Shared journals. See [Bank refresh owner](ORDERS_BANK_REFRESH_OWNER.md).

- Orders and Kupa Credit refresh now have strict seven-port operation owners.
  Controllers delegate provider planning/acquisition, lease lifetime, diagnostics
  and cleanup. App-specific freshness, cooldown, publication and return policies
  retain immutable full-function AST characterization. A shared unknown-result
  envelope rejects invalid counters, profile identities and diagnostic rows;
  native pairing/disposal and malformed-reply fixtures preserve journals/recovery.
  See [Credit refresh operations](CREDIT_REFRESH_OPERATION_OWNERS.md).

- Kupa Bank provider refresh now has a strict seven-port operation owner and a
  strict three-port candidate policy. The controller retains admission and UI;
  provider/lease/reconciliation/candidate/publication coordination is retired.
  Snapshot identity and Shared watermark are still captured after Checks, with
  preserved cloud/local durability, 365/30-day and partial-home LKG policies.
  Local-only cloud grants and malformed home-failure evidence stop before archive
  publication. Immutable full-function fixtures, strict body mutations and nine
  native held stages protect lifecycle and exact journal recovery. Provider
  refresh coordination is now separated across all four Bank/Credit refresh paths.
  See [Kupa Bank refresh](KUPA_BANK_REFRESH_OPERATION.md).

## Four major work packages

| Package | Concrete remaining work | Exit evidence |
| --- | --- | --- |
| Private controllers and composition | Remaining financial edit commands and manual-edit lease queue lifecycle; Calendar and large customer-document/view responsibilities; internal Main save/hydration coordination, remaining shell composition width and backup UI/resource account ownership | Narrow owners and lifecycle where jobs exist; dependency/API/I/O budgets; representative production behavior preserved |
| Business and transaction contracts | Remaining journal/IDB callers, Finance leases/RPC envelopes, complete Bank/Credit profile/result payloads, Morning/Calendar commands and capability consumers | Unknown-payload validation and actual implementation mutations; an unchecked decoder never grants authoritative confirmation |
| Bridge orchestration | Document search merge/pagination and scheduled maintenance/installer processes; Credit adapter construction, DigitalV3/Camoufox internals and remaining Bank CLI/token processes | Before-change retry/fallback characterization, native provider/process/file fixtures and preserved wire contracts |
| Canonical sources and retirement inventory | Classify remaining legacy readers, preference keys, SQL setup/operator copies and generated assets; deterministic current/operator SQL generation where missing; retire only proven unused paths | Consumer inventory, immutable deployed migrations/receipts, deterministic generation and old-record/backup restore evidence |

Typing and resource ownership accompany each boundary change. A clean import
graph, absent context timers or a factory split alone does not prove all internal
responsibilities and lifecycles complete. No completion percentage is inferred
from file counts or commits.

## After the main structure

Organize shared namespaces and finish consistent formatting once owners settle.
Measure startup/render/sync/service-worker behavior before lazy splits, then
address CSS structure and visual/RTL regressions. Generated copies from `shared`
remain intentional and deterministic.

Final rollout still needs controlled backup/restore and two-computer/live-provider
drills where synthetic fixtures cannot supply evidence. Full CI does not certify
a real issuer session or physical multi-computer environment.

New JavaScript does not convert earlier IndexedDB records, preference data or
imported backups. Historical readers require a verified migration or proof that
retained data no longer needs them; they are distinct from obsolete write paths
and dead API exports.
