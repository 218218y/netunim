# Kupa Bank capability and browser effects

A pre-change test reproduced an actual resource leak in the Bank controller:
if native diagnostic-download click failed, the allocated Blob URL and appended
anchor remained live. The command returned false and reported the original
failure, but cleanup was installed only after the failed click.

## Capability boundary

`composition/bank.js` constructs Bank's controller, then binds its presentation
after modal/date/navigation ports exist. Ten explicit collaborators describe
the authoritative model/session, Checks commands, cloud/Bridge adapters, local
persistence, operation/automatic access, queries, revisions and platform.
The raw controller and view are private.

Consumers receive `commands` for the existing user actions, `queries` for
Bridge/readout/local-snapshot observation, `presentation`, `runtime` and one
delegated action pack. Main's Bank render/wakeup, Dashboard snapshot warning,
Checks image context, connectivity and UI registry use these ports. The private
manual `commitBankSnapshot` is not a public capability command. Credit keeps its
existing controller and Finance automation still composes Bank/Credit owners.

Binding is validated and single use; construction/binding starts no network,
timers or DOM work and does not mutate the existing model. Kupa's existing local
snapshot model requirement is retained. Bank supports its existing live model,
rather than inventing a new unhydrated state contract.

## Effects and form commands

The already tested Finance browser adapter moves from Orders' platform folder
to canonical `shared/finance-browser-effects.js`, generated for both apps.
Both Orders Finance and Kupa Bank consume the same implementation. Each
capability owns a separate adapter instance and download resource set.

Bank requests `effects.saveJson`; the adapter owns Blob creation, filename
validation, JSON/MIME serialization, temporary anchor, one-second cleanup and
idempotent disposal. Create/append/click/timer failures release resources and
retain the original failure. Strict checkJs, negative consumers and implementation
mutation checks now target the canonical implementation. No duplicate helper or
retired platform facade remains.

Delegated Bank actions read token and credential fields and pass explicit input
to controller commands. The controller preserves existing normalization,
validation and Bridge payloads; it no longer knows DOM field IDs. Pairing clears
the non-empty field in the UI. Credentials remain transient input and are not
introduced into application state or persistence. Lease heartbeat timers use
the controller's existing injected timer implementation.

## Resource lifetime

The controller tracks outstanding public async operations and automatic runs.
Its `drain` awaits them; disposal cancels future automatic deadlines and fences
unstarted tracked work. Capability disposal closes new commands/actions, the
automatic owner, lazy search, diagnostic resources and the active image preview.
Captured operation/read guards also reject former-capability publication.
Started journal/cloud work is not aborted or fabricated as acknowledged.
Stopping automatic scheduling retains the existing independent operation scope
and received-result durability behavior.

The view checks capability lifetime before asynchronous status publication and
after image retrieval. It owns one preview release function, releases the prior
preview before replacing it, handles modal construction failure, and releases it
on disposal. Retained preview-download callbacks and search callbacks cannot
publish after disposal. Native UI callbacks remain behind the presentation
boundary. Import actions are closed on disposal and the Finance import modal/
completion ports recheck lifetime; the generic file-picker/import runtime
remains a separate owner review, not a new claim of cancellation for a submitted
Bridge import.

## Validation and retained semantics

- The original Bank diagnostic click-failure regression now passes through
  the actual controller and common effects owner.
- Capability tests cover validated/inert binding, private APIs, held diagnostic
  drain/disposal, search/automatic cancellation, closed actions, explicit form
  input, held image results and modal-allocation cleanup.
- `runtime_kupa_bank_capability.py` runs actual application actions with native
  Blob/anchor/timers and IndexedDB. It checks failure/success/cleanup, late
  diagnostic publication, closed actions, exact Main/Shared raw-record retention
  and fresh recovery of the same independent note ID/content.
- Existing native local Bank abort/retry tests use capability commands and
  still confirm the same snapshot/transaction without another provider scan.
  Operation/lease/unknown-receipt/financial fixtures use the public role ports.
- Architecture checks cap Bank composition width, reject root controller/view
  imports, and prohibit concrete form/download/browser/timer I/O in Bank's
  controller. Full CI includes existing real-browser, PostgreSQL, fault/recovery,
  financial calculation, performance and Windows gates.

Persisted formats, SQL/migrations, RPC/provider policy, financial calculations,
lease/fencing/ACK rules and independent Main/Shared ownership are unchanged.
The large private Bank controller, broader business/capability typing, generic
import/other resource owners and Bridge decomposition remain separate work.
Synthetic local diagnostic tests do not certify physical/live provider runs.
