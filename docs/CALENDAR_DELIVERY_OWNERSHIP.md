# Calendar delivery ownership

## Proven failure and scope

At baseline `0bd62159`, independent production Calendar controllers in two tabs
could flush the same physical IndexedDB queue simultaneously. In the native
browser reproduction, A's first PATCH remained unresolved while B sent both the
old and new PATCH, deleted both acknowledged rows and published a successful
sync. A's delayed old PATCH then took effect and its response was lost. Google
state was old, while the local queue was empty. The Node reproduction failed
independently for overlapping delivery and duplicate snapshot consumption.

Google/OAuth responses were synthetic; IndexedDB, two tabs, production
composition/auth/API/journal/controller and Web Locks were real. This proves a
client ordering defect; it is not evidence that production users lost data.

## Boundary

`platform/calendar-delivery-owner.js` owns the exclusive Web Lock
`netunim-orders-calendar-delivery`. Its name identifies the origin's physical
Calendar queue, regardless of account, instance or primary-tab status. Secondary
tabs may still edit and synchronize Calendar; they serialize their delivery.
The composition root supplies this narrow port to the journal. Neither domain
policies nor the journal reach into browser globals for ownership.

The journal captures live authority **before** waiting, validates it on grant,
and reads the durable queue **after** grant. Ownership covers ordered delivery,
response/body settlement, local acknowledgement, and error bookkeeping. A
following owner therefore cannot deliver a previously acknowledged snapshot.
`deliver` remains private so a consumer cannot bypass this boundary.

Controller lifetime cancellation removes an ungranted lock request. Native
Web Locks do not release a granted lock when that signal aborts: already-started
work settles under the old owner's lock. The existing operation fences prevent
further delivery or local acknowledgement under revoked authority. Neither
logout nor disposal deletes pending operations or changes their stable IDs.
Started Google requests are not aborted by this presentation cleanup.

Missing/refused native ownership fails with `CALENDAR_DELIVERY_UNAVAILABLE`;
other native errors propagate. There is no unowned or in-memory fallback in
production. Pending rows remain durable and the existing Calendar UI displays
the error. Read-only cache use, Main/Shared/Finance, SQL, IndexedDB schema version,
Google request formats and provider retry/idempotency policy remain unchanged.

## Evidence

- `calendar_delivery_ownership.test.mjs`: lost-response race, fresh queue on grant,
  local ACK settlement/abort, former-login fencing, missing/refused/failed ownership, and 100 failed/recovered
  delivery cycles. Existing insert-409 verification, delete-404 idempotence,
  ordered delivery and account-scope tests still apply.
- `runtime_calendar_delivery_ownership.py`: actual two-tab controllers, stable
  event ID, delayed old PATCH/lost response, native queue ACK abort, retained queue on queued disposal,
  explicit recovery, unchanged raw Main/Shared stores, fresh-document recovery.
  Also tests queued cancellation, retained granted ownership after abort, and
  100 native lock cycles with zero remaining delivery locks.
- `--baseline` replays the old journal in a disposable browser profile and
  intentionally fails the acceptance check after reporting the old remote state
  and empty queue. No user profile or real account is involved.
- Strict checkJs compiles the actual ownership adapter and negative consumers.
  The browser suite is part of the canonical full verification inventory.

## Limits, recovery and rollback

This establishes exclusive **client** delivery for one origin's physical queue.
It is not a server-side idempotency ledger, an owner across separate computers,
or proof of when Google finishes an unknown request after a transport disconnect.
Existing same-event-ID replay/reconciliation remains the recovery policy; no
automatic new operation/event ID or blanket provider retry was introduced.
Idle cross-tab committed-work observation is now owned separately by the local
read observer; see CALENDAR_COMMIT_OBSERVATION.md. Its hint does not deliver or
retry provider work, and cannot substitute for the delivery lock or remote ACK.

After a delivery error, keep the queue and use the existing reconnect/manual
sync path under the original Google account. The next granted owner rereads it;
failed/uncertain delivery does not imply a complete sync. If safe native ownership
is unavailable, use the HTTPS site in a current supported Chrome/Edge browser.
The extra lock requires all loaded tabs to run this version; refresh stale site
tabs during rollout. Old tabs that ignore the lock cannot participate in its
guarantee. Full browser/DB/Windows gates remain required before release.

Rollback deploys the prior compatible assets without deleting Calendar stores.
There is no data migration or persisted-format change; rolling back also restores
the known concurrent-delivery defect. Live Google/provider and physical
two-computer drills are separate operational evidence.
