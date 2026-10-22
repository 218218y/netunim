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

## Resource investigation and operational limits

The 16 MiB ES output limit and 100-content-row batch are investigated separately
with the existing opt-in isolated Everything probe before changing either policy.
A synthetic process overflow alone is not proof of native Everything behavior.

The existing [operational acceptance plan](OPERATIONAL_ACCEPTANCE_20261022.md)
remains authoritative. Two physical computers, full installed Startup/task/PWA
upgrades and financial test-provider scenarios remain NOT RUN without a suitable
isolated environment. Bank default-origin changes and PDF geometry changes still
require the compatibility/representative-document evidence described in the
[previous closeout](UPGRADE_CLOSEOUT_20261022.md).
