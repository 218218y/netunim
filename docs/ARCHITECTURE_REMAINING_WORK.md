# Remaining major architecture work

This is the current inventory after Bank/Credit Bridge model separation and
Orders Finance document-command and both applications' Bank archive readout
extraction, Kupa Bank snapshot commands, shared Finance lease renewal ownership
and both applications' Bank/Credit local connection ownership. The chronological
[refactor record](ARCHITECTURE_REFACTOR.md) documents completed slices; older
remaining-scope paragraphs describe their stage's starting point.

## Verified foundations

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
  and a pause during Bank refresh. Its controller has 18 collaborators, down
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
  successful closure. The controller has 16 collaborators, down from 17, and
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
  readout or invent a Bridge version. Finance provider orchestration remains open. See
  [Orders Bank connections](ORDERS_BANK_CONNECTION_OWNER.md).
- Kupa local Bank status/cache, vault/account commands and diagnostics have a
  strict six-port owner. Native forms own identity, pairing and listeners;
  accepted requests drain after disposal. Financial warnings survive passive
  status probes, and local vault acknowledgements preserve real version evidence.
  The controller's effect port and embedded local connection code are retired;
  provider/lease orchestration remains open. See
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
  retired. Provider acquisition and broader Credit orchestration remain open.
  See [Bank snapshot publication](ORDERS_BANK_SNAPSHOT_PUBLICATION.md).

## Four major work packages

| Package | Concrete remaining work | Exit evidence |
| --- | --- | --- |
| Private controllers and composition | Orders Finance Bank/Credit workflows beyond document/archive owners; Kupa Bank provider/Bridge/lease orchestration beyond archive/snapshot owners, Credit and Calendar orchestration; large customer-document/view responsibilities; remaining wide cloud/backup/shell factories and callbacks | Narrow owners and lifecycle where jobs exist; dependency/API/I/O budgets; representative production behavior preserved |
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
