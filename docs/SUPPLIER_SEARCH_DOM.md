# Supplier search measurement and rejected DOM experiment, 2026-10-25

Decision: retain the existing Supplier view. Removing unmatched rows reduced the
connected DOM but did not demonstrate a consistent latency improvement. The
candidate production view and its generated release assets were restored to the
pre-experiment implementation before merge. No virtualization or new cache is
introduced. Physical target-machine acceptance remains NOT RUN.

## Same-runner comparison

The existing scoped probe now accepts a Git baseline view and installs it only
in its disposable site before lexical instrumentation. Baseline and candidate
use fresh profiles on the same runner, identical seeds, CPU rates and sampling.
Reports retain source hashes, connected-row count, heap/DOM counters, three
unprofiled samples and a separate trace/profile attribution sample. Three samples
support a median/range, not p95 or a physical-machine SLA.

Run [40213900089](https://github.com/218218y/netunim/actions/runs/40213900089)
compared baseline `fc3ddf0b0cf9b76b6a098566710dcb1c46a70729` with candidate
`c083d833933856d8079d300ae702fdfdcbc35800`, on Linux Chrome 155.0.8059.39,
4 logical CPUs, Intel Xeon Platinum 8573C. Only the selected Supplier view differs
between the two instrumented sites. Source identity, original samples, counters,
trace attribution and artifact hash are retained in the
[measurement receipt](evidence/supplier-search-20261025.json).

Input dispatch to two animation frames, milliseconds:

| Rows | CPU | Baseline median (range) | Candidate median (range) |
| --- | --- | --- | --- |
| 1,000 | native | 148.1 (147.9–167.5) | 141.9 (136.6–146.0) |
| 1,000 | x4 | 338.0 (333.8–366.9) | 301.9 (290.9–302.3) |
| 10,000 | native | 722.6 (705.1–732.1) | 813.8 (632.6–817.0) |
| 10,000 | x4 | 3,507.9 (3,399.3–3,508.8) | 3,418.6 (3,187.9–3,705.1) |

The candidate detached unmatched rows, keeping the same nodes/inputs for later
restoration. Connected transaction rows fell from 10,000 to one. That alone was
insufficient: the native 10k trace moved much of the cost from style updates
into the filtering call (about 34 to 347 ms inclusive), while prepaint remained
about 312 to 318 ms. Inclusive trace durations may overlap and are separate from
unprofiled latency. Retained-node memory did not decrease. The candidate's wider
latency range and native 10k regression fail the proposed merge criterion.

## Retained checks and remaining work

The probe improvements remain available for a future evidence-based proposal.
Additional native event assertions protect existing row/input identity, unsaved
drafts, search focus, bulk selection and the same scroll host. They make no
requirement to detach rows. Existing Hebrew/case/summary, filter/year/edit,
move/scroll and performance gates remain in place. Production source and startup
budgets are unchanged from before the experiment.

The synthetic 10k workload remains slow; this report does not claim it meets a
target hardware SLA. Reopen optimization for a concrete target workload and a
candidate that improves comparable latency without losing edit/focus/selection
behavior. Normal/weak Windows hardware is unavailable. Broad DOM rewriting or
virtualization is not justified by this unsuccessful candidate.
