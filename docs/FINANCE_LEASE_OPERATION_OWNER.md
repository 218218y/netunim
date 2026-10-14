# Bank/Credit lease operation ownership

The October 14 baseline (`ef9391eaf3cdf9f7879433f81fe241d56b7b1b74`)
retained a Bank heartbeat timer after Kupa disposal and both Bank/Credit timers
after Orders Finance disposal while provider work was pending. Kupa Credit
stopped the timer, but its disposal guard also prevented same-account cleanup.
Four before-change controller regressions reproduce these distinct failures.

`shared/finance-lease-owner.js` now owns acquisition, renewal and cleanup for
each accepted Bank/Credit operation. Its three ports are leases, account/storage
authority and timers. Each composition supplies an exclusive instance to its
controller; Orders Bank and Credit may share that controller's owner, while
their sessions own independent timer handles. The owner has one command:

```text
commands.acquire(kind, token, {assertCurrent})
  ready          decoded grant with synchronous publication guard
  assertCurrent  account + device/component + heartbeat fence
  close()        joins acquisition/renewal, then captured-account release

runtime.isPending() / drain() / dispose()
```

The caller closes in `finally`, after its accepted provider, archive or durable
publication work settles. Disposal immediately prevents new acquisitions and
renewal wakeups. It retains accepted work for drain and never releases a lease
under a pending provider. Closing during acquisition joins the eventual response
and prevents heartbeat allocation. Cleanup releases once, after any accepted
renewal, including failed renewal; its promise supplies no document ACK.

Account/storage authority comes from the original composition scope, separately
from component disposal and device pairing. Disposal or a pairing transition
cannot authorize publication, but can release a confirmed grant under unchanged
account/storage authority. Account epoch, storage ownership or leadership loss
still rejects cleanup and leaves the old lease to server TTL. Orders therefore
captures lease authority from the original `readAccess`, while its existing
publication scope continues to include capability lifetime. No token from a new
login is used to release a former login's lease.

The existing heartbeat implements TTL 1200 seconds and renewal at TTL/3. Local
Kupa file/directory grants allocate no remote heartbeat and close through the
existing local adapter. No provider request, retry/cooldown policy, financial
merge, wire format, schema, deployed migration or Morning path changes here.
Manual document edits retain their separate FIFO lease/no-provider policy.

The old controller claim/release ports, heartbeat construction and Credit's
heartbeat set are removed. Kupa Credit requires one explicit lease capability
instead of two flat ports with synthetic default grants (16 -> 15 collaborators).
This retires an unused internal API, without removing active historical data or
backup readers. The existing heartbeat module remains the active implementation
used by the owner, rather than a compatibility facade.

Integration verification exposed two retained records that borrowed the old
temporary operation guard: a confirmed Credit write's follow-up warning and an
unconfirmed local Bank snapshot. Both now retain account/device/component
authority independently of the completed lease. Credit checkpoint execution
still checks the live operation fence; warning recovery reads the confirmed
Finance revision without another issuer request. Local Bank recovery preserves
the exact staged snapshot and avoids another provider scan. Pairing transitions
retire Credit warnings and block local Bank retry without throwing during status
rendering. Before-change regressions and native existing recovery fixtures cover
these effects; immutable provider/merge policies remain unchanged.

Credit commit callers explicitly supply both the active-operation assertion and
the retained-receipt assertion. Provider refresh/reset retain their captured
device identity; manual cloud settings retain account/component authority and
never require a local Bridge. The old four-argument commit contract is retired,
with missing/async retained-authority consumers rejected by strict checking.

Evidence includes isolated lifecycle tests, four production controller disposal
regressions, immutable AST characterization of all four financial refresh bodies,
strict checkJs/negative consumers in both generated copies and an actual cleanup
implementation mutation. Twenty-four native browser cases exercise acquisition,
provider and renewal disposal/account changes through real HTTP lease decoders,
production compositions, Main/Shared IndexedDB journals and fresh recovery.
Focused local runs cover representative cases; the complete set runs in CI.

This slice does not finish provider orchestration, complete financial result
typing or manual-edit queue ownership. Remaining work is tracked in
[the architecture inventory](ARCHITECTURE_REMAINING_WORK.md).
