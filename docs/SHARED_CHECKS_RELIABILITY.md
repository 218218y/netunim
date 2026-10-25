# Shared Checks and storage boundary reliability

## Owner fences and canonical durability queue

Baseline: clean main/origin/main at `166d878e`; its push verification passed.
The local baseline strict typecheck, ESLint and 73 focused tests passed.

Two reported races were confirmed by failing regressions: a cloud-state response
could publish into a replacement owner, and flush could report success after an
owner change. Additional failures demonstrated stale error diagnostics and
acceptance of an obsolete epoch. Read-only recovery also needed a storage/epoch
fence when an account is revisited.

Cloud-state publication and flush now capture the store and epoch and recheck
primary authority after awaiting. Storage exposes the existing Journal's settled
queue, including its retained failure, rather than deriving durability from the
last append promise. Flush rejects when inactive, stale or blocked; it does not
claim a cloud ACK. Sync and coordinated replacements also wait on that queue.
Old commit completions cannot modify current-context counters or diagnostics;
durability risks are associated with store identities rather than account names.

Ten deterministic held-promise tests cover A-B, A-B-A, epoch replacement, authority
loss, old successful/failed commits, earlier write failure and read-only recovery.
The real file-export consumer is checked to stop before recovery/file IO when
Shared flush rejects. Existing successful export and same-owner tests remain.
No cloud protocol, journal format or financial merge rule changed.

Source graph measurement after the fence changes is approximately 1,879,100 Kupa
and 2,499,300 Orders bytes (310/406 modules). The previous source budgets were
exceeded by less than 300 bytes. Each source allowance increases by 1,000 bytes
for the measured safety logic; timing/module limits remain unchanged. Full
browser, IndexedDB, crash recovery and database gates remain mandatory in CI.

Static implementation checking of Shared Checks and adjacent boundary/bootstrap
modules is the next stage. This safety repair alone does not add strict roots.

## Shared Checks implementation contracts

Both Shared Checks implementations now join the strict roots. The existing JSON,
check identity and bank-event sequence validator exposes the shape it proves;
amounts, status and other unvalidated metadata remain JSON values. External state
is unknown until that validator runs. Canonical journal, receipt, cloud ACK,
sequence, retry and owner contracts are reused. Initialization retains explicit
source-owner provenance; coordinated writes require boundary/sequence arguments.

The runtime checks a missing recovery/cursor/flight before dereferencing it and
validates recovered merge inputs. These paths already failed closed; the new
errors identify the failed contract. Optional Journal options are forwarded only
when present, preserving the engine's defaults. Incident sampling imports its
existing specific module directly, avoiding an unrelated spreadsheet dependency
graph. No alternate compiler or runtime declaration facade was added.

Two negative consumer fixtures and six real-body compiler mutations distinguish
admission from ACK, asynchronous durability, missing recovery, raw remote data,
string epochs and JSON bank-event evidence. The seven compiler tests and 84
focused runtime tests pass. The new reader return shape does not certify check
amounts as normalized money. Existing corrupt-record and mutation gates remain.

Measured eager totals are approximately 1,884,550/2,504,730 bytes, with unchanged
310/406 modules. Relative to the safety commit, roughly 3KB of the 6KB canonical
source delta is comments; the rest is explicit narrowing, option forwarding and
validation/error handling. Source allowances increase by 5,000 bytes per app to
1,885,000/2,505,000. Timing and module budgets remain unchanged and CI still runs
the real browser and IndexedDB gates. The compiler stays TypeScript 6.0.3.

## Boundary, bootstrap and local-birth handoffs

Five deterministic regressions failed before this separate runtime repair:
Shared/Main recovery could complete across an account handoff and still authorize
a boundary replacement; an old bootstrap callback could advance another owner's
group, or a replacement group under the same owner; Local Birth could advance its
durable phase after initialization lost its owner.

Boundary now rechecks its captured owner after recovery and before each side's
mutation. Bootstrap advancement accepts optional expected scope/group ID/plan
hash evidence, and the executor supplies the identity frozen at execution start.
An old proof cannot be attached to a new plan. Local Birth rechecks authority
after awaited initialization, auxiliary work and durable phase transitions.
Already completed side effects remain discoverable through normal idempotent
recovery; the fix does not rewind a committed journal or invent completion.

The five regressions and existing crash-phase, local-birth, detached-target and
account-transfer tests pass (77 focused tests). Strict checking of existing roots
and ESLint pass. Eager totals are 1,885,007/2,505,184 bytes, still 310/406 modules;
source allowances increase by 1,000 bytes per app for the measured fences.
Record formats, phase ordering and cloud payloads are unchanged.

## Boundary and bootstrap implementation contracts

The actual Boundary and Bootstrap implementations now join the strict program.
Boundary actions are a discriminated union: a cloud reset requires its revision,
and a pending import requires frozen sequences/revisions and the clean-cloud
precondition. Compact completion records do not contain executable actions.
Raw database reads remain separate from decoded, validated records. Main and
Shared keep their distinct replacement/reset signatures.

Bootstrap has a closed phase domain, awaited JSON proof callbacks and frozen
execution identities. Its historical validator deliberately accepts some
coercible sequence/identity/hash evidence; reader types retain those JSON values
instead of falsely claiming normalized strings/numbers. Current creation still
normalizes the fields it normalized before. The generic DB's bootstrap ID input
reflects its actual retained-JSON equality comparison; no key encoding changed.

Two negative fixtures and six actual-body mutations cover raw record bypass,
frozen numeric sequences, invalid phases, missing await, scope identity and
bootstrap admission. Seven compiler tests pass. Boundary/bootstrap/detached/
owner-transfer behavior tests pass (72 tests), and the prior/new bootstrap
implementations agree on 566 input/output/error cases, including malformed and
historical coercible records. No runtime guard was replaced with an assertion.

Eager totals are 1,889,498/2,509,675 source bytes, with unchanged module counts.
Relative to the safety repair, most of the canonical source increase is JSDoc
(about 3.2KB net); narrowing/reorganization accounts for the remainder. Source
allowances increase by 4,000 bytes per app to 1,890,000/2,510,000; timing limits
remain unchanged. Full Local Birth and Detached Target static coverage is
deferred; their ownership repairs and existing native crash tests are retained.

## Selected Bank Bridge account identity

`hapoalim-account-model.mjs` now joins the strict roots. Canonical bank, branch,
account number and composite account ID are strings; unrelated retained provider
metadata stays unknown. Object boxing preserves the old optional property access
and object-spread semantics, including partial rows. The exact-one-match rule,
bank/branch comparison, error codes and public descriptor projection remain.

Two actual-body mutations reject a numeric composite identity and an unnormalized
raw account number. A negative consumer rejects treating raw balance metadata as
verified money. Three compiler tests, nine focused model/policy/boundary tests
and 4,399 prior/current input-output-error comparisons pass. Only the three
changed equivalent declaration digests are individually authorized in the
existing reviewed-policy fixture; historical hashes and policy mutation checks
remain intact. No browser source budget or dependency inventory changes.

The monthly projection candidate was also probed. It pulls the MAX diagnostic
dependency graph into strict checking (77 initial diagnostics), so it is not
included in this focused stage. MAX, CAL and Isracard adapters are deferred to
separate provider-specific evidence work. There are now 375 strict roots: 242
product modules and 133 fixtures, with 18 remaining Bridge `@ts-nocheck` files.
This count is an inventory, not a completion metric.

## Maintenance decisions and operational limits

The required compiler remains TypeScript 6.0.3. On 2026-10-25 the official
[7.1 Beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
still describes the new sync/async API in a beta release. The
[7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
states that 7.0 has no supported compiler API. The prior isolated 7.0.2 CLI
experiment is not full mutation/API/offline parity, and was not rerun as a
substitute for it. A single complete migration should be reconsidered after the
appropriate API stabilizes; no second permanent compiler was installed.

Service Worker root cause remains unproven. Eleven local diagnostic/safety tests
pass, including native-event persistence, original-error preservation, query/header
redaction, NetLog failed-path/network-code extraction and HTTP/1.1 connection reuse.
Existing CI still covers cold/cached/offline startup, release compatibility,
process restart and Windows PWA acceptance. Passing those gates does not prove
that HTTP persistence caused or repaired the historical installation failure.
Reopen the investigation on a new installation worker error or deadline with the
isolated profile's worker/version state and redacted NetLog failure evidence;
identify the failed URL/code before changing product retries or timeouts.

In run `40186227810`, Windows job `121147475735` again recorded native LevelDB
checksum corruption and deletion of the isolated `restore-process-orders` fixture
database after a hard process kill. The owned profile marker survived, while
Chromium logged recovery from a corrupted database. Production PWA/release tests
in that same Windows job passed. Supabase job `121147475967` separately recorded
a Chromium network-service crash and an aborted loopback Kupa RPC before the
controlled response interception. These are distinct native failures; neither is
evidence of a Service Worker installation regression. Original logs/artifacts are
retained, with one bounded manual retry per failed job and no weakened gate.

No new TypeScript suppressions or broad `any` contracts were introduced. Mutation
tests check changed real JS bodies; held-promise regressions use explicit gates,
not arbitrary sleeps. Main/Shared journal protocols and business merge policies
are unchanged. Remaining static Local Birth/Detached Target and wider provider
coverage are bounded follow-ups; another broad hardening campaign is not required
to claim the repaired critical ownership paths.

## Final generation audit

A final held-promise review found a narrower A-B-A case: if ownership returns to
the same account without this runtime having opened the intervening account, its
store and journal epoch can remain identical while the durable owner generation
has changed. Three regressions failed before the repair: stale cloud-state and
flush completion succeeded, and persist admitted the old generation.

Shared runtime now retains its existing captured commit-authority predicate and
requires it for publication, readiness and admission. Recovery creates a fresh
store when that predicate is revoked, claiming the existing durable journal
without resetting its epoch or data. Writer read-only publication captures the
same predicate; secondary read-only recovery retains its non-writer route.
Accepted commit counters still drain on their own store even when admission or
leadership closes, while stale diagnostics cannot publish into a new generation.

Fifteen deterministic owner/epoch/generation tests pass, including a production
`createStorageOwnerBinding` refresh with an unchanged account and incremented
generation, plus writer read-only revocation. Existing Shared storage, sync,
accepted-commit and owner-transfer tests pass. No owner-binding protocol, journal
record, cloud payload or source budget change is required.

The final declaration review also narrows authoritative replacement and cloud
reset options to require a boundary ID, matching their existing runtime guard.
Negative consumers and an actual-body boundary-ID mutation enforce the signature;
an active-owner regression confirms missing IDs cannot alter the journal epoch.
