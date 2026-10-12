# Orders Finance capability and browser effects

## Baseline and evidence

Baseline main `f725f7dfc2b6a8155f82ff8531aa1724bc0fddae` passed full verification
`38220311699`. Orders main still constructed the Finance Bridge, operation scope,
Bank selectors/cache, image adapter, Finance controller/view, connection importer,
credit-card ordering and Finance action packs independently. Nine direct imports
and their construction knowledge now move to the Finance composition capability;
main's import count falls from 68 to 59. This is a responsibility boundary, not a
new app context or service locator.

Two controller regressions failed before the browser-effects change. Bank and
Credit diagnostic exports allocated a Blob URL and appended an anchor, then a
failed native click escaped before the cleanup timer was registered. The UI
reported failure but retained both resources. No journal/data-loss claim follows
from that evidence.

## Capability boundary

`composition/finance.js` owns the existing producers and their binding order.
Construction creates adapters and authority but performs no storage read, network
request, render or timer registration. Unhydrated model state is not read.

| Phase/port | Responsibility |
| --- | --- |
| `bindReadout` | Scoped Kupa readout/cache plus focused Checks/Summary/alert presentation ports; cloud functions can be late bound |
| `bindCore` | Existing Bank/Credit orchestration, Finance/Kupa RPC and lease ports, Shared Checks preparation and image transport |
| `bindUi` | Finance view, import confirmation, card ordering, and the three existing action packs after producers/UI exist |
| `queries` | Snapshot, memoized snapshot, archive availability and explicit Finance refresh |
| `commands` | Bank/Credit refresh, automatic permission, card order and the peer integration/operation commands; no generic controller, Bridge or image adapter is exposed |
| `readout` | Refresh/recompute and dependent-view publication used by Main/Shared/cloud startup |
| `customerBankPort()` | Transaction query/ensure and verified Morning-link publication only |
| `presentation` | Finance rendering only |
| `runtime` | Start, policy-preserving wake for one resource, stop and idempotent dispose |
| `actionPacks()` | Finance bank, credit and card-order delegation with unchanged action names and mutation metadata |

Each bind validates its actual required methods before installing its phase,
rejects repeats, and rejects use before dependencies exist. Orders lifecycle,
connectivity, Cloud UI, Alerts, Settings, Dashboard, Checks and Customers consume
these focused ports. Main does not retain aliases to Finance internals.

The private controller remains substantial and still receives its existing
business/transport collaborators plus the effects port. This slice does not
claim to complete controller decomposition or its strict business-payload types.
The explicit capability boundary now permits those independent follow-up slices.

## Browser effects and resource lifecycle

`platform/finance-effects.js` owns connectivity, clipboard, diagnostic JSON
downloads and operation delays behind four effect commands and disposal. Finance
controller and Bank readout cache no longer refer to browser globals; module
graph rules enforce this direction. The adapter implementation and negative
consumers are strict-checkJs covered, with an implementation mutation check for
connectivity result types.

Filename validation/fallbacks, JSON pretty-printing/trailing newline, MIME type,
clipboard messages, 1000ms download cleanup and contention-delay policy retain
their previous behavior. Any failure after URL allocation releases the URL and
anchor immediately. Dispose cancels pending download cleanups and releases every
owned download once; delivered stale cleanup callbacks are inert. A started
operation delay resolves normally, allowing the existing operation guard to
decide its next step. No new cloud/provider retry loop is created.

Capability disposal stops existing Bank/Credit automation, closes its authority,
detaches the status listener and disposes effects. New commands/queries/start
calls fail closed; already obtained action handlers return false. A confirmation
opened before disposal cannot enter a later computer-owned Bridge write. Async
status completion cannot publish into a disposed Finance presentation; confirmed
operation results still return to their caller. Notifications and late import
renders are suppressed after disposal.

Closing this capability does not delete shared contexts, credentials, journal
entries, pending flags, checkpoints or independent Main/Shared data. Operations
already inside an external commit retain their existing receipt, unknown-outcome
and ownership policies. Disposal is not a cloud ACK or rollback guarantee.

## Verification and retained contracts

- Pre-change export failure regressions exercise the actual controller. Platform
  tests cover create/append/click/timer failure, original errors, multiple cleanup,
  serialization/naming, clipboard/connectivity and started-delay completion.
- Capability tests cover inert construction/binding, unhydrated startup, required
  methods, exact action names/metadata, automatic cancellation/stale delivery,
  held read disposal, pending confirmation and late presentation completion.
- `runtime_orders_finance_capability.py` exercises actual application actions,
  native Blob/anchor/timer ownership and real IndexedDB. Synthetic Bridge results
  exercise both export failure and success. Disposal preserves Main/Shared raw
  records; a fresh journal runtime retains the same note ID/content.
- Browser fixtures use the capability's ports, rather than main's retired
  controller/cache/view variables. Existing operation/lease/write/preferences,
  Morning, Calendar, status, performance and recovery gates remain mandatory.
- The older standalone Bank/Morning static contract was not in the suite inventory
  and assumed a pre-fencing handled RPC call even on baseline. Its assertion now
  requires the already deployed owner fence after server acknowledgement, and
  the full contract is included in CI. The application handled RPC was unchanged.

No persisted keys, formats, SQL, migrations, RPC envelopes, ACK/recovery policy,
provider retry/fallback/freshness or financial calculation semantics change.
Native tests use synthetic local diagnostics; they certify neither actual bank
scrapers nor physical two-computer provider behavior.
