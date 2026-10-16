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

## Remaining IDB input authority

Base/flight/control records and all cloud/local/clean/recovery head preconditions
are captured and decoded synchronously before opening or queuing IDB work.
Checkpoint/operation capture stays on its existing owners. The transaction still
checks the active writer, owner, epoch, sequence, cloud range and persisted head;
capture does not replace these checks or grant a receipt before commit.

Boundary, bootstrap, bootstrap patches and local-birth payloads also had caller
references crossing `open()`. They now receive a detached JSON input before that
wait while retaining their transactional transition checks. The fenced-account
path already sealed its two heads synchronously and needed no rewrite.

Only the small capture/decision helpers enter strict checking. Native IDB tests
exercise 30 record/precondition mutations across all three journal namespaces,
plus four transition payload captures. Changed inputs are re-signed with valid
checksums, proving the accepted command is retained instead of merely catching
checksum damage. Existing ACK/rebase/adoption/conflict tests continue to pass.
No eager modules or byte ceilings are added in this stage.

## Selective business evidence and readability

The final audit follows authority, not file length:

| Response | Decision | Evidence boundary |
| --- | --- | --- |
| Main / Shared writes and Orders' Kupa settings | Added success-envelope cardinality before selecting a row; reject coercible revision/replay metadata | `document-write-ack.js`, both transports, Kupa Main writer |
| Finance writes | Existing receipt checks the full original envelope and authoritative state; retains SQL numeric strings | `finance-write-receipt.js` |
| Atomic Bank snapshot | Existing independent Finance/Kupa revision receipt remains the publication boundary | `bank-snapshot-receipt.js` |
| Bank archive reconciliation | Added all five integer counts and complete-snapshot flags, including empty-source success | `bank-response-records.js` |
| Finance lease grant/renewal | Existing requested-token/fence evidence retained; calendar/clock normalization now rejected | `finance-lease-receipt.js` |
| Morning operation/recovery | Existing exact-operation/document/amount checks retained; verification timestamps now use strict calendar/clock decoding | `morning-operation-evidence.js` |
| Bank/Credit provider results | Existing account/balance and profile/month decoders retained; complete Bank coverage also requires a transaction array before implying absence | `bank-balance-result.js`, `credit-refresh-result.js` and provider model owners |
| Legacy pending local restore | Require explicit matching account and app before any remote stage/apply | both `ui/backup-restore.js` adapters |

An older local restore group without owner evidence stays preserved and blocked;
the current login cannot supply its missing provenance. This legacy pending case
requires operator review of the original account and server ledger; never retag
the record from the current login. Ordinary V2 backup imports remain available
when account startup is ready. Generic group creation can now retain an explicit
owner for callers that have proven it. Server-only recovery already records its
owner before writing.

A separate concrete Credit defect was demonstrated: `canonicalBillingDates`
returns an array, but inference divided by `dates.size`, producing NaN and disabling
the 60% confidence threshold. A 3-of-6 history incorrectly inferred a billing day.
The regression fails before the fix and passes with `dates.length`; 3-of-5 remains
eligible and issuer fallback remains available.

Only the long-function hotspots in Credit billing cycles and Bank archive commands
were expanded. Their formatting preserves every token, literal and Acorn parse
tree, separately from the one intentional billing calculation change. Evidence is
in `docs/evidence/readability-authority-20261016.json`. The canonical ratchet drops
from 507 to 495 lines over 500 characters, and from 123 to 117 over 1,000. The global
maximum remains 3,252; unrelated views were not reformatted. Static Bank assertions
now ignore source whitespace while retaining their behavior fragments.

Final normalized startup measurements: Kupa **294 / 1,718,827 bytes**, Orders
**394 / 2,338,429 bytes**. The reviewed final ceilings are **1,735,000** and
**2,361,000** bytes, approximately 1% reserve. Module counts remain exact. These
explicit updates cover measured validation/recovery and the two readable hotspots;
CI never increases budgets automatically and no additional lazy split is introduced.

Release coverage and remaining physical/operator checks are recorded separately
in `RELEASE_AUTHORITY_MATRIX_20261016.md`.

## Release scope

Full CI includes real PostgreSQL, native browser/IndexedDB, recovery/fault injection,
account switching, and Windows deployment contracts. Physical weak-device and
live Bank/Credit provider checks remain operator evidence; synthetic tests or CPU
throttling cannot prove these. No live customer/provider data is needed for the
four code changes.
