# Search batch follow-up, 2026-10-22

Base: merged `2ddb34af3f0eb42c04d397baa6e6241d0165999e`, Document Bridge v41.
This follow-up addresses reproduced boundary defects after PRs 276–279; it does
not reopen storage, synchronization or the canonical matching algorithm.

## Verified partial results and search scope

New tests failed against the base: a later `ES_TIMEOUT` rejected previously
verified rows, and a Word-only content search became partial because of an
unrelated PDF index. The coordinator now returns a partial page only when an
expected ES timeout follows at least one canonically verified result. A timeout
before verified progress remains an error, as do invalid JSON/content, lost IPC,
authorization failures and unexpected errors. Caller cancellation always wins,
including ignored abort followed by a late timeout. No unverified row is published.

Verified paths are deduplicated before the result offset/lookahead, while the
candidate cursor still counts every native row. Tests exercise duplicates,
rejected candidates, nonzero result offsets, `hasMore`, and a successful fresh
search after timeout. Publication stays with the existing search owner.

PDF preparation and its partial state apply only when the requested file type
includes PDF (`all`, `documents`, `pdf`). Word searches work even if PDF preparation
would throw. Existing historical paging/filter comparisons retain their immutable
baseline and explicitly account for this intentional change in PDF participation.

An empty partial result now says the search is incomplete, rather than claiming
no matches exist. Both actual app DOMs retain their partial notice on pagination.
Bridge/client v42 requires this corrected runtime; installed v41 cannot silently
serve the former timeout/scope policy.

Focused Node, HTTP, DOM, type and asset checks precede the complete branch gate.
The final report records exact tested revisions and passing CI runs. Duplicate
main runs need not repeat an already tested identical Git tree.

PR [280](https://github.com/218218y/netunim/pull/280) passed all 14 gate jobs at
`a2562f73897b7c3c7491a91043389b83ad19e3a8` in
[run 39766941545](https://github.com/218218y/netunim/actions/runs/39766941545).
Its merge `fd50901ec3e2da159436f0c8e6315adcf24f0c61` has the identical tested
Git tree `f3167abcb2571b7adb65c42b8a9eb6d7da265aef`. The v43 resource stage
requires its own full gate; its PR/final report records that exact source/run.

## Resource investigation and operational limits

Actual Everything 1.5.0.1424 and ES 1.1.0.38 reproduced the output ceiling, using
copied executables in a named index containing only disposable synthetic files.
The [before observation](evidence/everything-resource-before-20261022.json), from
clean `4ca967f64b18fab9fe646c365122f639cca430b0`, records both a 100-document
batch (about 26.2 MB text) and a single 18.4 MB document failing as `ES_EXIT_ERROR`.
The actual coordinator failed too. No production index, provider or business
document was queried. The subsequent probe records fixture sizes and all 563
indexed paths were checked against its disposable directory before content reads.

The 16 MiB subprocess limit stays unchanged. Only stdout overflow receives the
typed `ES_OUTPUT_LIMIT`; oversized stderr is not treated as document content.
The existing coordinator halves a failed candidate batch, retries the same cursor
and retains its overall deadline. Only successfully decoded and canonically
verified rows advance results. The smaller size is retained for the rest of that
request. Seven attempted sizes (100, 50, 25, 12, 6, 3, 1) bound reduction; a single
oversized candidate fails as `ES_CONTENT_TOO_LARGE`. Even earlier verified rows
do not turn that extraction/resource failure into a misleading partial success.
There is no new matcher, cache, stream parser or publication owner.

The [after observation](evidence/everything-resource-after-20261022.json) proves:

- Native 100-row output still hits the ceiling; 25 full contents total about
  6.56 MB, including their trailing text, and decode correctly.
- Adaptive search returns all 100 large documents in order, complete with
  `partial:false` and `hasMore:false`; the failed 100-row read retries at offset
  zero with 50 rows (about 13.1 MB per successful read).
- After rejecting 350 wrong-order candidates, offset 20 returns exactly valid
  names 020–029, with `hasMore:true` and `partial:false`.
- The 18.4 MB single document is rejected explicitly after bounded reduction,
  with zero published IDs.
- Caller abort and injected timeout termination after at least 64 KiB of real
  stdout both publish zero results. Timeout uses an injected SIGTERM after actual
  output begins, not a claim about natural service overload. Separate actual
  execFile-deadline tests remain in the existing test suite.

The report records wall time and before/after Node memory snapshots. They are
single samples from one machine, not peak RSS, a total-process 16 MiB memory cap,
UI median/p95, or a controlled cold/warm speed comparison. JSON decoding and GC
still add memory beyond the bounded subprocess output. No memory ceiling was
increased to make these cases pass.

Reproduce using the existing isolation owner:

```powershell
python tools/probe-everything-isolated.py --everything-exe '<Everything.exe>' --es-exe '<es.exe>' --resources --output .work/resource-report.json
```

Both observations identify exact base revisions, coordinator hashes and executable
hashes. The after report deliberately identifies uncommitted source (`dirty:true`);
the complete CI gate separately validates the committed source. The owned native
process exited in both runs.

## Runtime and completion decision

Bridge/client/installer v43 requires the bounded-batch correction; v42 cannot
silently serve the old resource behavior. The existing native replacement probe
also tested pinned v41 directly to the current v43 modules, on an owned disposable
port. Old-version checks reject v41, its owned listener exits cleanly, and v43
preserves token/configuration and passes health checks before clean shutdown.
See [native replacement evidence](evidence/document-bridge-upgrade-41-43-20261022.json).
The report records the working source/hash and `dirty:true`; it explicitly says
the full installer was not executed. Reproduce without repeating the old chain:

```powershell
python tools/probe-document-bridge-upgrade.py --from-revision 2ddb34af3f0eb42c04d397baa6e6241d0165999e
```

The proven code defects and native resource failure are corrected. Resource tests
cover same-cursor retries, canonical rejection, nonzero offsets, timeout after a
smaller successful batch, first/later oversized single content, and abort priority.
Further architecture work has no demonstrated basis. Full branch CI and exact
tested Git-tree verification remain mandatory before merge.

The existing [operational acceptance plan](OPERATIONAL_ACCEPTANCE_20261022.md)
remains authoritative. Two physical computers, full installed Startup/task/PWA
upgrades and financial test-provider scenarios remain NOT RUN without a suitable
isolated environment. Bank default-origin changes and PDF geometry changes still
require the compatibility/representative-document evidence described in the
[previous closeout](UPGRADE_CLOSEOUT_20261022.md).
