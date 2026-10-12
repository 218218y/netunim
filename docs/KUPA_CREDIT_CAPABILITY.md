# Kupa Credit capability and resource ownership

## Evidence

Two pre-change controller tests failed: a native diagnostic click failure left
its Blob URL/anchor allocated, and the controller offered no dispose/drain
owner for an accepted status request. The download regression now uses the
existing canonical Finance effects adapter; the underlying Bridge protocol and
diagnostic payload are preserved.

## Capability boundary

`composition/credit.js` owns a private controller, selectors, view, existing
manual-record editor, connection/card-order dialogs, lazy search and effects instance.
Its constructor receives model, UI and optional platform ports. Inert, single
use `bindServices` receives Bridge, cloud, persistence, authority and presentation
ports. View and editor binding retain the existing startup dependency order.
Finance composition, root navigation, connectivity, card order and delegated
actions use explicit `commands`, `queries` and `runtime` roles. No controller
alias or controller/view import is added to Main.

`queries.uiState` exposes scheduling readiness as a boolean, never a timer ID.
Controller promises, polling deadlines, renewal timers and editor persistence
receipts stay with the owners that created them. The remaining wide private
controller is not claimed as completely decomposed.

## Lifetime and durability

`runtime.start/stop/wake` control automatic scheduling. Ordinary stop leaves
an accepted operation's authorization and publication contract intact.
`runtime.dispose` is idempotent: it closes new actions/commands, fences later
controller publication, stops polling and all renewal timers, removes the
connection dialog's listeners, cancels search and releases diagnostic resources.
The view checks lifetime before an asynchronous status repaint; retained focus,
search and modal callbacks cannot operate after disposal.

`isPending/drain` include public async commands, automatic work, accepted lease
renewal requests and existing manual-editor persistence receipts. A held renewal
is still drained after its provider request finishes. Disposal does not abort
an accepted journal append, network request or clipboard write. It blocks later
effects and presentation, rather than pretending the accepted operation was
never sent. Captured authority/fencing still guards finance publication and
former-owner lease release; the existing TTL policy is retained.

## Connection input and browser effects

The controller requests `effects.writeText/saveJson`; it creates no Blob, URL,
anchor or DOM field. Each capability owns its separate canonical effects
instance, including failure cleanup and one-second download cleanup.

`ui/credit-connection-dialog.js` owns provider-specific presentation and form
listeners. Each open has a generation and exact native form identity; callbacks
also require the modal to be open. Replaced, closed and disposed callbacks
cannot read or submit another form. The dialog passes an explicit input to
`commands.saveCreditConnection`, preserving local profile credential retention,
provider field visibility and existing Bridge wire fields.

The actual `credit-connection-input.js` implementation and negative consumers
are checked with strict checkJs. Credential strings retain leading zeros and
password spaces. Provider validation/encryption remains at the local Bridge;
credentials are not added to Main state, preferences or cloud finance data.
This is a focused input contract, not a claim that the entire controller or
capability is strictly typed.

## Verification

- Node cases cover inert/private binding, provider stop versus disposal,
  renewal ownership/drain, held destructive confirmation, clipboard drain,
  accepted manual-editor receipts and stale form callbacks. Two additional
  pre-change shared card-order tests proved late success/error modal writes;
  Kupa Credit and Orders Finance now supply their lifecycle to that shared view.
- A compiler mutation rejects converting actual card suffix input to a number.
- `runtime_kupa_credit_capability.py` uses the production UI/capability, native
  forms/Blob/anchors/timers and real IndexedDB. It checks form wire input,
  diagnostic failure/success, closed actions and late results, exact retained
  Main/Shared journal records, and fresh read-only recovery of the same note
  and check IDs/content. Synthetic local responses do not certify live providers.
- Existing publication, preferences, account/lease/freshness and action tests
  use the new ports. Architecture checks reject concrete browser effects in
  the controller and root/private-controller coupling, and budget capability
  constructor/service width. The native suite is in the full CI inventory.

SQL/migrations, persisted formats, finance merge/publication/ACK contracts,
provider retry/fallback/cooldown and financial calculations are unchanged.
Startup/backup/import resources, broader strict boundaries, Bridge separation
and the remaining large controllers are subsequent roadmap stages.
