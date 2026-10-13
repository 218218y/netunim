# Kupa Bank snapshot commands and retirement

Starting main: `a6cc5fac24cbfae98c6d930543fa9d40fe6ebd82`.
Three pre-change regressions failed: construction without an atomic snapshot
writer enabled a Finance/local two-write fallback; missing claim ports received
a synthetic acquired grant; a file-mode Bank refresh called the authenticated
Finance writer before local durability. The latter also failed through the
actual capability in a native browser. The first two concern partial private
controller construction; production composition already supplied complete ports.

## Owner and commands

`snapshot-commands.js` receives six ports: authority, Bank candidate/mode,
Shared readiness, local snapshot persistence, atomic cloud/readout, and
synchronous publication. It creates no jobs or IO at construction. Its commands
prepare Shared checks, commit a manual snapshot, publish cloud/local provider
results and retry an existing local snapshot; one query exposes local
confirmation status. The parent controller owns accepted promises and provider
lease lifecycle; composition creates the local persistence owner.

The Bank controller receives this command API, one Finance freshness query and
a required claim/release port. Collaborators decrease from 26 to 18. It no longer
receives document writers, local save/recovery callbacks, Shared writers or a
synthetic lease default. A missing atomic writer cannot select separate Finance
and local writes. Provider/cloud mode uses the existing atomic receipt, confirmed
Bank candidate, archive publication and minimum independent document heads.
Committed data remains distinct from verified post-commit readout.

Local/file/directory provider results use local persistence only, fixing the
proven authenticated-write leak. The existing unconfirmed snapshot warning,
same-ID recovery/retry and no-rescan behavior are retained. Manual snapshots
retain their local durability semantics in all supported modes, with Shared
readiness in cloud mode. `manual-snapshot.js` constructs their money, watermark,
feeds and metadata using supplied time/token functions.

## Retirement evidence

The raw `mergeBankTransactions` browser transport existed in both apps. Consumer
inventory found no active production call: Kupa passed it through composition
to an unused constructor parameter; Orders had no production consumer. Tests
alone called it. Both functions/exports and Kupa's unused wiring are removed.
Archive identity and scope tests now exercise the canonical snapshot RPC.

The server merge implementation, v6 writer protocol and immutable migrations
remain: snapshot reconciliation and operator/authorization contracts still use
them. A retired browser export does not prove that its SQL implementation is
dead. Historical persisted readers and preference data are unchanged.

## Evidence and limits

Focused tests cover required ports, dirty Shared checks before/after sync,
scope changes, missing/unknown atomic receipts, minimum document heads,
synchronous publication, mode guards and local failure without fallback.
The actual command body and negative consumers compile under strict `checkJs`;
mutating readout confirmation to operator text fails in the implementation.
Inputs include typed snapshot metadata and captured Bank leases; full payload
and complete provider/controller caller typing remain incremental work.

Fourteen retained Bank/Shared/archive declarations match earlier immutable AST
digests after namespace routing. The original manual command remains a hashed
test-only reference; 16 combinations compare the new projection with that
pre-extraction behavior. Both apps' archive identity, canonical snapshot RPC
and atomic snapshot writer retain six pre-retirement body digests.

Native file-mode verification creates exactly one Main journal operation,
retains Bank transaction and note IDs, preserves Shared byte-for-byte and calls
neither Finance nor atomic cloud writers. Existing native fault/retry verifies
the same snapshot and one provider scan through recovery. Replies/file handles
are synthetic; real IndexedDB and production composition are exercised.
Full branch CI remains required, including PostgreSQL/browser/Windows gates.
See [remaining major work](ARCHITECTURE_REMAINING_WORK.md).
