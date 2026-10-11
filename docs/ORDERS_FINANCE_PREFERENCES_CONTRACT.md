# Orders Finance automatic preferences and storage failures

## Evidence and baseline

Baseline main `e62fcb5b4c4c81698756b77bb8ef53a1b4c5440c` passed full verification
`38121775483`; its application source is the tested PR118 head
`8a2df32b71f13b988f8437b9656c918de333466e`.

Four Node regressions failed before the change. A quota exception while recording
an automatic Bank/Credit attempt escaped before `try/finally` with the busy flag
already set. Subsequent Bank **and** Credit actions were blocked. A preferences
read exception escaped Finance snapshot rendering instead of retaining the
confirmed read model. The native `--baseline --kind bank --case attempt` drill
also reproduced the escaping exception in the actual browser composition after
real Main/Shared ownership transfer and journal commits. This is a proved
controller/UI failure, not evidence of production journal loss.

## Responsibility and permission

The existing integration remains the only implementation of the historical
computer-local keys. `domains/finance/automation-preferences.js` owns the narrow
policy for its synchronous preference port; it performs no browser/network I/O.
Construction does not read storage or schedule work. Its actual body and negative
consumer fixture are checked by strict JS typecheck.

| Evidence | Meaning |
| --- | --- |
| Successful preference read | Current saved permission/mode/cooldown, not permission to clear a previous failure |
| Successful automatic attempt write | Cooldown recorded before busy/lease/provider entry; not a remote commit |
| Confirmed Finance receipt | Existing scoped remote commit proof; not an offline outbox or proof that Main/Shared journals are clean |
| Preference failure | Pause that resource's future automatic starts in this runtime and retain the last confirmed business data |

Reads and writes produce classified `FINANCE_PREFERENCES_UNAVAILABLE`,
`FINANCE_PREFERENCES_QUOTA` or `FINANCE_PREFERENCES_INVALID` failures. Raw stored
values, tokens and exception messages are excluded from the warning. Invalid
attempt metadata is retained; it is never cleared or interpreted as a ready
cooldown. Timestamp writes also reject invalid clocks. Existing one-hour Bank
and daily Credit cooldowns, four-hour/daily freshness and provider policy remain.

Bank and Credit have separate suspension and timer ownership. A shared pairing
token read failure pauses both; a failed Bank-only setting does not disable
Credit. Clearing a queued timer also fences its already-delivered stale callback.
No new scheduler or provider retry loop is created.

An automatic attempt must persist its timestamp before setting busy or entering
preflight/lease/provider work. Failure returns `false`, publishes the independent
warning and leaves both controllers usable. An explicit manual refresh remains
available when its token, account/primary, lease and commit guards are valid.
A started provider/remote commit drains normally; an optional later preference
failure cannot roll it back or force a repeat scan.

## UI, explicit recovery and restart

The effective checkbox is off during suspension. Bank/Credit headline and
diagnostics show an automatic-permission warning independently of the latest
confirmed Finance result. Manual refresh success cannot clear this warning;
it also cannot present the preference failure as an unsuccessful remote commit.
The last successfully read Credit mode remains visible after a failed mode write.
The snapshot remains available when reads are blocked. Query-time failures do not
recursively rerender their own query; background failures notify the mounted
status once per classified transition.

Login, reconnect, start/stop, recovered reads and a successful mode write do not
clear suspension. An explicit enable/disable must write successfully and reread
the complete permission/mode/cooldown before clearing it. A mismatched readback
is a failed confirmation. A partial Credit reset reports the preference warning
while preserving the already-confirmed Bridge/Finance reset and releasing busy.

`localStorage` is not transactional and no alternate persisted permission or
secret store is added. If disable did not persist, suspension only belongs to the
current runtime. Reopening reconstructs permission from the unchanged historical
setting; a still-blocked read/attempt write pauses again before provider entry.
If storage becomes writable after reopen, an old saved opt-in can apply again.
The visible warning explicitly states this limitation. To keep automation off,
repair browser storage and explicitly disable and confirm the setting before
reopening. A bad timestamp must be corrected deliberately; automatic enable
does not delete it. This is not a promise of a durable offline Finance queue.

## Verification, recovery and rollback

- Controller regressions reproduce both busy/read failures and verify that a
  later manual refresh still confirms exactly one scoped remote result.
- Preference-owner/integration tests cover denied reads/writes, separate owners,
  token failure, retained malformed timestamps, mode readback, explicit recovery,
  truthful diagnostics and 1,000 scheduler stop/start cycles with stale callbacks.
- `runtime_orders_finance_preferences.py` runs 14 disposable native browser
  profiles: Bank/Credit read, attempt, disable, malformed timestamp, token and
  started-provider drain; Credit also mode and partial reset. Main/Shared raw
  records are compared before/after; the exact note ID/content survives fresh
  runtime recovery. Storage faults and Bridge/Finance responses are synthetic.
- The native suite is in the canonical browser-lifecycle gate. Full branch CI
  must also pass existing Node, typecheck, assets/lint/graph, real IDB, database,
  offline/recovery, two-tab/two-computer and Windows suites before merge.

No persisted keys are renamed, no journal/outbox is erased and no schema, SQL,
ACK or provider wire format changes. Reverting this commit restores application
code without a data migration; it also restores the proved blocked-storage bug.
Live bank/issuer login, physical disk exhaustion and production devices are not
verified by controlled faults. Export/restore of business data is independent of
these computer-local permissions; storage reset is not a repair instruction.
