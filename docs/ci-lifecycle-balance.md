# Browser lifecycle allocation — 2026-10-27

The four lifecycle jobs use longest processing time first with deterministic
tie breaking. The allocator was correct; its October 19 cost snapshot no longer
represented the expanded browser scenarios. For example, `runtime_loaded_data.py`
was estimated at 105.17 seconds but its observed median was 480.33 seconds.
`runtime_startup.py` had grown from a 103.21-second estimate to 396.79 seconds.

The refreshed weights are medians of successful suite completion lines from the
latest job attempts in these successful GitHub runs:

- [40436972191](https://github.com/218218y/netunim/actions/runs/40436972191)
- [40392463816](https://github.com/218218y/netunim/actions/runs/40392463816)
- [40391992463](https://github.com/218218y/netunim/actions/runs/40391992463)

The observations and original job IDs are retained in
`tests/fixtures/ci-lifecycle-2026-10-27.json`. The network filter prevented local
artifact ZIP downloads, so the same successful suite timings were read through
the GitHub connector's job log API. Failed or incomplete suites were not sampled.

| Lifecycle machine | Previous placement, recent median costs | Refreshed placement, same costs |
| --- | ---: | ---: |
| 1 | 622.35 s | 737.05 s |
| 2 | 827.10 s | 733.91 s |
| 3 | 847.03 s | 736.80 s |
| 4 | 648.51 s | 737.23 s |

These are replayed cost estimates, excluding machine setup and queue time.
The regression contract replays all three measured profiles against the current
allocation and requires a maximum/minimum ratio of at most 1.15 per profile,
allowing individual runner variation, and at most 1.02 on their medians. Coverage remains
37 suites, each assigned exactly once; all four machines still run sequentially
within their own partition.

To recalibrate a subset in the future, collect successful `results.json` reports
and run `python tools/update_ci_timings.py --merge-existing --report-root <reports>
--source <run-url>`. Repeat `--report-root` and `--source` for independent runs.
The merge option preserves unmeasured suite costs, Node file costs and their
source URLs. Omitting it deliberately replaces the snapshot as before. These
estimates affect scheduling only; no previous result can skip verification.
