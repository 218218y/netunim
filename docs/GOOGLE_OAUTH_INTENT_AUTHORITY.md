# Google OAuth lifecycle, 2026-11-03

Baseline: `ae8942a2`. Ten newly added handler regressions failed on that code:
late callbacks resurrected disconnected connections or superseded a newer start,
and missing/reduced token scopes could become successful sessions. The storage
failure regression already passed. The focused handler suite passes after repair.

`google_oauth_intents` contains only an owner, module, hashed intent and expiry.
It is not a credential store. Credentials stay in the existing connection tables.
Service-role-only RPCs serialize start, disconnect and publication on one owner/module
row. Publication checks and replaces credentials in the same database transaction.
DELETE RETURNING still consumes each callback state exactly once. Disconnect fences
in-flight callbacks even when there is no stored connection, deletes pending states
and removes the captured credential before provider I/O. A later explicit start is
a new user action. Concurrent starts are ordered by their database transactions.

Calendar requires both `calendar.events` and `calendar.calendarlist.readonly`;
Drive requires `drive.readonly`, including direct previews and exports. Both callback
and refresh require the actual provider response to contain every required scope.
A missing scope fails closed and requires reconnect; requested/stored scopes are
never substituted for a missing response. A rejected callback retains existing
credentials and never revokes the project grant as compensation for storage errors.

## Compatibility and rollback

Migration `20261103120000` is necessary for cross-isolate fencing. It changes no
business, Journal, ACK, Storage V2 or financial schema. Existing connections remain
readable; old pending states have no intent and require a new start. No production
migration or Edge deployment is authorized by this change.

For a future deployment, pause OAuth start/callback/disconnect traffic, drain old
Edge invocations, apply the additive migration, deploy both updated functions,
verify service-role RPC availability and resume traffic. Do not run old unguarded
callback writers alongside the new functions: a rolling mixed-version deployment
cannot provide this fence. If rollout fails, keep OAuth mutation endpoints paused
and retain the additive schema; restore the last compatible fenced functions or
fix forward. Returning to unguarded callbacks is not a safe functional rollback.
Only after all fenced clients are removed and OAuth is paused may an operator drop
the three RPCs and metadata table; existing credential tables are never dropped.

## Disconnect decision still required

Both modules use the same client ID. The existing `/revoke` call is retained.
[Google documents](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)
that revocation can invalidate all project scopes/tokens. Thus Calendar disconnect
can affect Drive remotely even though local metadata is scoped to one module.

Recommended product decision: use local module unlink for the ordinary module
button and offer a separately named action to revoke all Google access, clear both
local connections/intents, and explain the impact. This requires explicit approval;
the patch does not implement that policy change. A new authorization started while
an existing project revocation is in flight can still be affected by Google.
Separate Google test accounts/project are required for real cross-module proof.
Synthetic tests prove local isolation, not provider grant behavior.

[Granted-scope guidance](https://developers.google.com/identity/protocols/oauth2/web-server#checkauth)
requires checking actual scopes before enabling the associated operations.
