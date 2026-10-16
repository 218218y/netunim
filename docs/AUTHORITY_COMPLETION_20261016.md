# Authority completion, 2026-10-16

Four sequential changes, each verified on its branch before merging:

1. Bank acknowledgement and archive response evidence.
2. Restore recovery list/receipt evidence and server-only startup adoption.
3. Synchronous capture of remaining low-level journal inputs.
4. Selective audit of responses that grant business authority, followed by focused readability and release evidence.

## Bank boundary

The SQL contracts were checked directly: missing acknowledgements return
`transaction_id, acknowledged_at`; alert acknowledgements also return `alert_kind`;
manual handling returns `transaction_id, handled_at` (null only when clearing).
Only exactly one row for the requested transaction grants success. A malformed
success leaves the outcome unknown; no invented local acknowledgement clock.

Archive/snapshot reads now select account columns and require exact account and
role, numeric archive identities, money, timestamps and warning evidence. Duplicate
archive IDs across pages reject the whole read. Only `[]` is valid absence.
Snapshots validate coverage and payload count. Morning links validate link and
transaction identities and verification clocks. The Morning RPC's existing SQL
owner/account filter remains its scope boundary: its result has no account column.

## Startup budget policy

No new lazy loading is justified by the existing CPU evidence. New required
validation is measured as startup code. Keep module counts exact: a new eager
module requires an explicit fixture change and explanation, not an automatic bump.

For source bytes, retain a small reviewed reserve of approximately 1%. CI still
uses a fixed ceiling and never rewrites it. A ceiling change must cite the measured
before/after size and the actual reason. Formatting or validation must not be
compressed to fit an obsolete sub-kilobyte reserve.

Bank stage measurements (normalized source bytes, `tools/startup-graph.mjs`):

| App | Previous modules/bytes | Bank modules/bytes | Reviewed ceiling |
| --- | --- | --- | --- |
| Kupa | 290 / 1,690,047 | 292 / 1,696,917 | 292 / 1,714,000 |
| Orders | 390 / 2,308,716 | 392 / 2,315,514 | 392 / 2,339,000 |

The two new eager modules implement Bank business decoding and shared primitive
evidence validation, also needed by restore/other authority boundaries. Both are
strictly checked. No presentation subsystem was moved into startup.

## Restore boundary

Restore list decoding follows the actual SQL result: UUID, app enum, incomplete
phase, creation/update timestamps and unique IDs. The list RPC does **not** return
revisions, so it cannot prove them; the apply receipt separately requires the
matching UUID, `completed`, positive Main revision and a positive/null Checks
revision. Stage receipts accept an already-completed phase for idempotent replay.

Server-only recovery now writes an owner-scoped durable pending identity before
applying the group. It reads both authoritative documents after completion, checks
their revisions against the receipt, and uses the existing paired V2 boundary to
adopt them. The pending identity is cleared only after adoption. A fresh client
can retry even when the server no longer lists the completed group. Pending local
edits are never overwritten to finish this recovery: the clean-head precondition
stops it. Account/login changes fence recovery publication.

Both startup paths keep mutations blocked on a failed restore instead of
reporting the error and continuing with old heads. A new startup retries durable
recovery. Tests cover malformed lists/receipts, post-commit read/adoption failure,
stale heads, owner isolation, startup mutation gates, and a fresh writer using
native IndexedDB and the actual paired boundary in both apps.

The two additional eager modules own restore response decoding and server-only
recovery. Restore-stage source was measured within the existing byte reserve;
module ceilings move explicitly from 292/392 to 294/394. No byte ceiling increase
is needed. Enum values must be strings, never coercible arrays.

Kupa restore reads request the exact Main head without the display-only overlay
from the independent Finance document. The ordinary cloud read keeps its existing
overlay behavior. Restoring Main must not manufacture a composite cloud base.

## Release scope

Full CI includes real PostgreSQL, native browser/IndexedDB, recovery/fault injection,
account switching, and Windows deployment contracts. Physical weak-device and
live Bank/Credit provider checks remain operator evidence; synthetic tests or CPU
throttling cannot prove these. No live customer/provider data is needed for the
four code changes.
