# Transaction completion is receipt authority

`completeIndexedDbTransaction` in the existing connection module is strict checked.
It accepts a transaction port and synchronous work, installs completion/error/abort
handlers before work, preserves the first failure and rejects unfinished work.
Preparing a result does not settle the promise. Only transaction complete grants
the receipt, including for readonly transition evidence.

The Main/Shared journal, boundary writes, bootstrap/birth transitions and workbook
store use this body. They keep their existing stores, schemas, decoders, physical
key checks, business decisions and account/writer fences. This is a shared
transaction completion mechanism, not another persistence owner or writer.

The review reproduced premature successful transition reads after request success
followed by native abort. Boundary/bootstrap/birth readers now reject that path.
Existing direct multi-store account/engine adoption transactions retain their own
owners; this does not claim full strict coverage of journal/runtime/bootstrap code.

Native Chromium injection aborts after get/put success. It proves that transition
creation/advance and Main/Shared ACK retain prior durable evidence, flights and
cursors, including restart. Negative consumers reject asynchronous work and wrong
receipt types. Compiler mutation rejects a fabricated receipt; a runtime mutation
that resolves on abort demonstrates the failure detected by the contract.

The common body removes duplicate transaction plumbing without adding an eager
module or increasing the existing source/timing budgets. Existing input capture,
business-schema, checkpoint retirement and owner-binding gates remain required.
