# Kupa Bank operation ownership and publication

## Evidence

The original controller accepted a provider result after logout, account change,
same-account relogin or loss of primary-tab access. It continued into archive
requests and snapshot publication. A disposable real-browser reproduction using
production composition, auth/logout, owner transfer and IndexedDB reproduced
success after logout before the provider response. This proves stale publication
and success reporting, not production data loss.

Before the change, 21 of 22 controlled Node cases failed. They also reproduced
archive-cache publication before a failed atomic snapshot save, reuse of one
account's cache by another with identical feed keys, and erasure of the warning
for an unverified refresh after a committed snapshot. An additional regression
proved that an older display query could replace a committed projection when
the account/feed timestamps matched.

## Owners and boundaries

`createFinanceOperationScope` captures connection mode, durable storage owner,
authenticated account and login epoch. Writable access is required for provider
refresh, manual balance changes and acknowledgement of a missing transaction.
Read access is separate: an authorized secondary tab may read archives/images.
Both access modes require local recovery/readiness and a matching account owner.
Ordinary token refresh keeps the login epoch; logout/relogin replaces it.

Automatic scheduling remains a separate owner. Disabling automatic refresh or
stopping its timer prevents another provider session. A result from an already
started session may drain through the existing commit path while authorization
and ownership remain valid. Going offline does not itself change the captured
identity; network failure still prevents unconfirmed publication.

Bank refresh validates its captured owner after cloud preflight, lease claim,
Shared Checks preparation, provider retrieval, each archive write, image sync,
archive reads, snapshot commit and post-commit refresh. The lease carries the
operation guard, including heartbeat fencing, into transport. Pagination,
response-body reads and every authenticated retry use that guard. A scope error
cannot be downgraded to an optional image warning.

Lease renewal/release cannot send requests under a replacement authorization.
Release ports discard runtime token tracking even when the old scope has closed;
the former account's remote lease then expires under its existing TTL. No new
retry, lease duration or server policy is introduced.

## Publication and recovery

Cloud archive rows read during refresh remain a candidate until the bank snapshot
save succeeds under the same scope. Failed publication preserves the displayed
bank and archive. Confirmed cache entries carry read authorization and feed keys.
Independent display requests coalesce only within a live scope and matching feed
targets; late queries cannot replace a new login's query or a confirmed snapshot.

Manual balance edits retain the existing model-before-journal staging contract;
they validate ownership before staging and after durability. Local-mode provider
refresh retains its existing local journal path and staged edit if persistence
fails; a declined persistence confirmation cannot report refresh success. This
additional regression reproduced `true` after `saveState` returned `false`.
These are distinct from cloud
snapshot publication. Main/Shared journal, ACK, merge, serialization, SQL and
compatibility semantics are unchanged.

A committed bank snapshot can remain visible if the subsequent cloud refresh is
unavailable. The operator warning survives the final status update. Conversely,
a lost commit response leaves the Last Known Good projection in place; an
explicit subsequent refresh can recover the same transaction IDs. The browser
does not roll back a server commit or manufacture an ACK after an auth change.

## Verification and limits

- `tests/kupa_bank_operation_ownership.test.mjs`: controlled ownership races,
  manual balance/secondary access, cache replacement, lost-response recovery,
  scoped Bank RPC/body/pagination and image upload/retention/download boundaries.
- `tests/kupa_finance_cloud_ports.test.mjs`: scoped preflight and release tracking.
- `tests/runtime_bank_operation_ownership.py`: production Kupa composition and
  real IndexedDB/auth under logout, account replacement, same-user relogin,
  primary loss, publication race and network failure; Main checkpoint/journal
  remains identical and a note's ID/content survives a fresh-runtime reload.
- Existing local Bank, Shared Checks, finance automation, Credit and image
  behavior tests remain required. The browser suite is included in the full CI
  lifecycle group; Browser/PostgreSQL, two-computer and Windows gates remain
  release requirements.

New failure tests use simulated provider/Finance transport in disposable browser
profiles. They do not claim live-bank scraper or production Supabase validation,
and this change does not fence every remaining Orders Finance controller. Image
guard options are backward compatible; Kupa explicitly supplies the guards.
