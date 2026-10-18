# Kupa local source transitions, 2026-10-18

Directory, direct-file and automatic remembered-folder opening now share the same
admission and import path. `prepareDirectory` builds a detached candidate without
changing active file/backup references. A candidate's JSON, projection, automatic
checkpoint comparison and backup catalog are validated before the existing paired
Main/Shared V2 import. Only after that durable boundary succeeds are the file
handles, connection mode and visible model installed synchronously in one turn.

The checked source-transition owner admits one transition at a time, blocks new UI
edits, and drains accepted saves/polls/backups against their original source.
Primary-tab, durable-owner generation, auth epoch and local-edit generation must
remain valid across preparation and import. Late native picker results cannot
replace a newer selection. A failed transition keeps the old handles, connection,
model, preference and remembered handles. Source preparation may create the normal
data/backups directories or initialize a missing candidate file; it never activates
that candidate on failure.

Remembered handles and storage preference are startup hints, written only after
successful installation. Hint failures produce a visible warning while retaining
the accepted source. Backup creation is secondary and cannot make an acknowledged
source import appear unsuccessful. Backup-only selection/restoration likewise
prepares the directory and catalog before replacing its references. File mode
clears both directory and backup-directory references consistently.

Storage V2 remains the sole business writer. A failure after a durable boundary
has begun uses its existing retained-intent/recovery protocol; this change does
not promise rollback of a committed journal transaction or a physical disk write.

Evidence: `kupa_source_transition.test.mjs`, `runtime_kupa_source_transition.py`
(native OPFS and real IDB recovery), the existing paired-boundary/file-adoption
suites and `checked-local-source-transition.mjs`. Physical interruption and real
external-file permissions remain in the operator release matrix.

The second required authority owner brings the eager graph to 302 modules and
1,756,823 bytes (1,757,000-byte ceiling). This is a bounded correctness
addition to the previous 301-module/1,753,000-byte gate; timing ceilings are
unchanged and repeated native/4x CPU measurements remain required by Full CI.

The earlier extraction-only token comparison still verifies untouched mutation
and publication decisions, with the reviewed source-admission guard explicitly
excluded. File adoption intentionally changes order and is now verified by the
failure/recovery behavior suites instead of freezing the previous unsafe order.
The unused `ensureDirectoryFile` wrapper is removed; `prepareDirectory` replaces
that internal port without increasing the backup capability's public API budget.
Picker dialogs and remembered-handle reads capture the same authority before
their first await, so an account replaced while a native dialog is open cannot
import its late result into the new account.
