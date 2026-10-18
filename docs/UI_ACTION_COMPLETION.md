# Delegated action completion evidence

This is an implementation record. Open work is tracked only in
[the current backlog](ARCHITECTURE_REMAINING_WORK.md).

The 2026-10-18 review was reproduced against main after PR #244:
both Bank filters admitted `2026-02-30`, and both configuration action packs
returned `undefined` when their owning commands returned rejected Promises.
The dispatcher left these rejections unobserved. The original regression run
failed six cases; domain-handled failures and synchronous throws were positive
controls. Existing commands already own most operational failure handling.

Both filter entry points (range and individual boundary) now use `evidenceDate`
from the existing calendar owner, without coercing objects into dates. Valid
leap days, open ranges, reversed ranges and clearing retain their behavior.

The 26 application action packs contain 436 hyphenated action entries. Of these,
416 discarded a final call result; the other 20 already return their result,
use an expression body, or end in a synchronous preference assignment. All final
delegations now return completion, including conditional branches. An Acorn
comparison of all 26 original and resulting programs proved that terminal
expression-to-return conversion is their only semantic change. Cooked literals,
arguments, mutation metadata and evaluation order are preserved.

The dispatcher keeps DOM dispatch synchronous, including prevention and propagation.
It observes returned completion without serializing clicks, granting a receipt,
retrying a command, or changing its owner. Only an escaped rejection reaches the
fallback reporter. Settled domain errors generate no duplicate notice. Both roots
log action name/type and show a generic status message that makes no assertion
about whether a business write committed. A failing reporter has a guarded sink.
Synchronous programming errors and unknown actions keep their throw behavior.

Validation: focused Node regression cases, existing action registry/calendar
contracts, strict typecheck and module graph. Native event coverage exercises
rejection observation and synchronous propagation in both actual browser shells.
Full branch CI includes existing persistence/account/recovery suites.

Expanded action packs reduce canonical long lines from 412/94 to 408/93
(over 500/1,000 characters). No runtime module was added. The source-only eager
allowances rise by 4 KB in Kupa and 8 KB in Orders for returned completion,
error handling and readable presentation of the packs. Measured eager sizes are
1,781,097 and 2,393,881 bytes; 305/402-module and all timing ceilings are retained.

This entry audit is not a claim that every asynchronous continuation throughout
the application is strict checked. Shared workbook/card actions and detached
runtime work retain their existing owners and focused tests.
