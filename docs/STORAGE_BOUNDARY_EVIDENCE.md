# Paired storage transaction evidence

The V7 audit pointed to unchecked journal callers. This slice closes concrete
restore/import and persisted-boundary evidence gaps without asserting that the
entire journal/IDB runtime is strictly checked.

Reproduced gaps:

- resume overwrote the persisted phase with prepared for validation; an unknown
  phase then skipped all work and unlocked ordinary edits without an error.
- phase-write replies were consumed without checking owner, operation ID, phase
  or immutable action content.
- restore converted booleans, blank strings and arrays with Number(), granting
  them revision authority. Source capture did not compare ACK and head sequences.
- local-only import checked bases but could overlook a retained flight/control.

storage-operation now decodes paired intents and compact completed markers.
Every consumer read and transition is checked. Invalid durable evidence stays on
disk and retains the edit gate. Completion must be read back for the same ID/kind.
Restore/import implementations are strict checkJs roots; unknown state, source,
head and receipts are decoded before boundary submission. Canonical integer
strings remain readable; ambiguous values, regression and explicit failure do not.

Shared Checks state validation and operation-ID generation use their canonical
checked implementations with their existing public exports preserved. No new
eager module or raised startup budget was needed. Historical operation/SQL and
checkpoint compatibility remain untouched.

Evidence: malformed phase/owner/action/transition matrices; exact original failure
reproduced by a consumer implementation mutation; negative type consumers; existing
crash/restart/local-only/import/restore suites. Native IDB stores an invalid but
checksum-valid intent, then verifies fail-closed resume without rewriting it.

Remaining: strict whole IDB/runtime and owner-transfer bodies are not claimed
complete. Continue only at a boundary where untrusted evidence grants authority.
