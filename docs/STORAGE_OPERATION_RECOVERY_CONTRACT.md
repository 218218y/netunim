# Persisted operation decoding and pending-work authority

## Evidence

Baseline: `bad616e5d54891bf42ce895b313a8f01d0a41d27`, after
[PR #103 full verification](https://github.com/218218y/netunim/actions/runs/37876923223).
Thirteen new regressions failed before this change:

- Null operations/changes produced unclassified TypeErrors; malformed optional
  annotations were accepted by replay.
- Invalid stored deletion intents raised the correct validation error, but
  recovery classified that persistent error as retryable.
- Cloud pending-state reads accepted checksum-valid malformed changes, foreign
  owners and duplicate deletion IDs without using the replay validator.
- Fresh Main recovery reported a retryable TypeError for a null change.

These are controlled component/fault-injection findings. They are not evidence
that production user journals were corrupted or that user data was lost.

The first full browser run of `3c9e2efca1b868651484055d4cc5ad5538459375`
failed the new foreign-owner drill. Real IDB's secondary index selects on
`data.owner`; changing that payload field hides an entry whose primary key still
belongs to the original owner. Conversely, another namespace's entry can claim
the original owner's payload name and enter that index query. Memory fixtures
do not implement that index, so their passing tests did not cover this boundary.
The browser finding is addressed at the query owner, not by weakening the drill.

## One validation policy

`storage-operation.js` owns both validation of a proposed operation and decoding
of a checksummed persisted operation. The old model exports forward to this
implementation; replay and cloud pending-work reads use the same policy.

1. JSON representation and checksum are proved by the existing codec.
2. The operation header must carry version 2, bounded non-empty owner/epoch/ID/
   timestamp, safe integer sequence >= 1 and generation >= 0, and non-empty
   changes. Metadata is an object when present; surface/mutation type are text
   when present. Null/absent historical annotations remain supported.
3. Every change is decoded before any replay mutation. The existing schema
   still owns allowed fields/collections, explicit insert/replace/delete, record
   identity and insert ordering. Full-state replacement still requires the
   existing import/normalization/bootstrap authority. Historical upload-owner
   bootstrap eligibility is unchanged and now checked from its implementation.
4. Persisted deletion intent collections and IDs retain their existing bounded,
   non-duplicate shape. Invalid intents are a fatal persisted-data error during
   recovery; transaction abort, quota, secondary-tab and fencing failures retain
   their retryable classification.
5. Journal recovery proves operation shape/checksum/scope before taking a stored
   sequence as committed metadata. Cloud pending reads and newly materialized
   flights also require the current journal owner/epoch before deriving
   generation, mutation metadata or deletions.
6. IDB selects the physical `[owner, epoch, seq]` primary-key namespace before
   decoding payload ownership. All journal writers use this key form starting
   with schema v1 (`d59bfbdb`); current append/boundary/bootstrap writers retain
   it. Local/account fenced-recovery reads use the same query. No store, key or
   index is migrated; the historical index remains installed.

The decoder proves a storage operation, not a business record schema, an
authenticated account, an immutable Flight or a durable ACK. Existing domain
validation, account/primary fences and IDB transactions remain mandatory.

## Historical forms and representation

The reader contract is distinct from the current writer contract. Absent/null
metadata, deletion intents, surface and mutation type are retained exactly.
Extra JSON fields remain intact. A replacement's historical index was ignored
by replay and remains non-authoritative: its reader type deliberately does not
claim a numeric ordering index. Inserts still require a safe integer index.

No defaults, operation IDs, timestamps, schemas, checksums, property order,
writer bytes, SQL/RPC semantics or ACK/retry scheduling are changed. The golden
fixture still checks eight actual writer/ACK/rebase stages. Historical bootstrap
and Main/Shared boundaries retain their existing tests.

## Failure and verification

Failed decoding grants no recovery readiness or writer claim. The failure
retains the checkpoint, metadata, journal, base, immutable flight, control and
emergency records. It does not acknowledge, drop or normalize the pending work.
This change adds no automatic repair or invented empty recovery state.

Node tests prove the pre-change failures, detached reads, compatibility export
identity, historical annotation/index behavior, scope rejection and recovery of
the same note ID/content. Strict checkJs checks the actual decoder and historical
compatibility implementation, both generated decoders and negative consumers;
an injected implementation returning a string sequence must fail compilation.

Both deployed app roots additionally run real IDB fault injection for Main and
Shared Checks. Tests compact a checkpoint while retaining its unacknowledged
journal/flight, inject malformed changes/metadata/deletion intents/sequence or
foreign scope, and check active cloud reads plus fresh primary/secondary recovery.
All stores and the writer must remain unchanged. Test-only restoration of the
exact captured operation then recovers the same ID/content once, with the same
flight, revision and pending cursor. A malformed emergency duplicate is retained
until its exact known-good replacement is proved; a final durable ACK and fresh
runtime verify that only acknowledged work is cleared.
Raw journal keys and values are also compared independently of the owner index.
Neighboring physical owners cannot inject rows by forging a payload owner, and
changing an owned row's payload owner cannot hide it from validation.

Full Browser/PostgreSQL, two-tab/two-profile, offline/PWA, performance and Windows
verification remain required before merge. Flight/base/control kind decoders,
complete transaction typing and full application/business input typing remain
separate coverage work; this slice does not certify them.
