# Checked Storage V2 orchestration

`storage-v2-runtime.js` now joins the strict implementation roots. Runtime
dependencies, modes, recovery results, asynchronous admission and cloud commands
reuse the Journal's existing State, operation, receipt and method contracts.
Accepted emergency durability retains its separate boolean; an IDB completion
remains a `Promise<boolean>`. Inactive/unhandled results have no commit receipt.
Successful recovery exposes the validated primary role, typed owner/epoch and a
separate source for writer/read-only recovery. Flush remains fallible.

The compiler checks the actual method bodies, including the optional current-state
projection into ACK/rebase commands. Caller data is detached before queue waits;
malformed collection shape cannot be certified as an operation record. Required
local-boundary and cloud-bootstrap inputs retain their runtime rejection paths.
Error properties are inspected as unknown instead of assuming every caught value
is an Error. No storage format or financial policy changes.

Journal incident observation is independently loaded from
`sync-journal-incident.js`; the existing adapter reexports it for current consumers.
This separates Journal observation from spreadsheet-only normalization and avoids
expanding strict checking into unrelated workbook implementations. The real
incident sample/classification bodies and activation-cache helpers are checked
too, with no declaration replacing executable code.

Seven compiler tests pass: the baseline/negative consumers and six actual-body
mutations cover immediate fabricated completion, ACK/local receipt confusion,
invalid recovery source, owner, epoch and omitted primary-role admission.
The 611-test focused storage/journal/incident selection and full static contracts
pass. Temporal owner checks still require held-promise runtime regressions; a
compiler cannot prove that authority stayed current across real asynchronous I/O.
No such static claim is made.

There are 326 explicit roots: 203 product modules and 123 fixtures. Excluded
Bridge files remain at 23. Measured eager graphs contain 310/406 modules and
1,849,600/2,474,067 source bytes (Kupa/Orders), including runtime JSDoc. Each
source-byte ceiling rises by 5,000 to accommodate measured contract text; eager
module and timing ceilings do not change. The isolated observer adds a lazy
module, not an eager startup dependency. TypeScript remains pinned to 6.0.3.

Transport and sync coordinators, the full cashflow reconciler, selected Bridge
models and a refreshed TS 7 comparison remain subsequent independent stages.
