# Owner-store transaction authority

The previous binding and handoff reads used separate readonly transactions.
Writers compared owner names without a captured generation, so a delayed command
could regain authority after A -> B -> A. These are distinct from transfer proof
validation and must be enforced inside the IndexedDB transaction itself.

`storage-owner-idb.js` now owns both stores in one transaction. The actual body is
strict checked, with unknown sealed values decoded as one coherent snapshot.
Every mutation of an existing binding requires a positive safe-integer
`expectedGeneration` and compares it inside that transaction. Initialization is
create-only. Activation and prepared adoption change binding and handoff atomically;
completion retains the activated generation. Missing snapshots, orphan or
incoherent records, skipped phases, immutable patches and generation overflow fail
before authority. Completed historical records remain readable and retained.

Inputs are detached before the database-open await. Success is published only
from transaction `oncomplete`; successful request writes followed by an abort
produce no receipt. The public database module composes this owner without keeping
a second implementation. Binding hydration and refresh consume the atomic snapshot.

Evidence includes negative checked consumers, held/aborted transactions, malformed
checksum-valid records, stale generations and an implementation mutation removing
the generation comparison. Native IndexedDB in both apps exercises A -> B -> A,
coherent pair reads and abort after put success with neither store changed.
The existing native transfer and accepted unblurred-edit coverage remain required.
Eager startup ceilings are unchanged; this closes the owner-store body, not the
whole business-journal/runtime implementation.
