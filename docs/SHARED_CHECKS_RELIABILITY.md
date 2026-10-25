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
