# Lifecycle timing recalibration — 19 October 2026

The four lifecycle jobs were balanced against an older timing snapshot, but
`runtime_loaded_data.py` was added after that snapshot. It received the global
median fallback of **6.962s**, although four recent successful runs measured
**101.405, 101.514, 108.831 and 165.78s**. Its 4x CPU-throttled, 1k/10k-row
browser scenarios therefore joined an already full lifecycle-3 partition.
Lifecycle-4 was also lighter than predicted by the older finance timings.

The existing longest-processing-time scheduler is working correctly for its
inputs. Recalibrating those inputs balances all four machines without changing
suite membership, assertions, fixtures, throttling, browser concurrency or the
number of jobs. All 36 lifecycle suites still run once, sequentially within
each machine. The local full-group selection remains available.

## Measurements and replay

The [checked-in evidence](evidence/ci-lifecycle-20261019.json) contains the
per-suite measurements, original job durations and the new suite allocation.
The three earlier runs use native `results.json` artifacts. The latest run's
artifact host was unavailable through the local network filter, so its complete
successful job logs supply the printed per-suite timings, rounded to 0.01s.
Job metadata is read directly from GitHub. The lifecycle source files are
unchanged between these sampled revisions.

| Successful run | Measured old 1 / 2 / 3 / 4, suites only | Replayed new 1 / 2 / 3 / 4, suites only |
| --- | --- | --- |
| [39160661592](https://github.com/218218y/netunim/actions/runs/39160661592) | 219 / 240 / 297 / 211s | 230 / 244 / 243 / 250s |
| [39188225621](https://github.com/218218y/netunim/actions/runs/39188225621) | 295 / 238 / 302 / 224s | 293 / 241 / 258 / 268s |
| [39188234644](https://github.com/218218y/netunim/actions/runs/39188234644) | 221 / 314 / 314 / 216s | 240 / 288 / 273 / 265s |
| [39188879252](https://github.com/218218y/netunim/actions/runs/39188879252) | 291 / 324 / 457 / 243s | 315 / 354 / 309 / 336s |

The last run's complete lifecycle jobs took **5:07 / 5:39 / 7:55 / 4:23**;
the complete workflow took **8:11**. Reassigning its same measured suite costs
reduces the longest lifecycle workload from 457s to 354s (22%). This replay is
an estimate, not a new execution: runner speed and queue delays still vary.
The two runs of the same pre-change commit also show machine-level variation.

The refreshed snapshot uses medians across the four recent suite samples, giving
`runtime_loaded_data.py` a cost of **105.172s**. New estimated lifecycle loads
are **265.144 / 266.347 / 265.732 / 266.546s**, a 1.4s spread. Lifecycle-4
now receives ten suites, including archive reconciliation and orders finance
ownership; loaded-data scenarios move to lifecycle-2 with fewer companion
suites. No manual shard list is introduced.

The complete timing snapshot is refreshed together: all 133 canonical suites
have current measurements, and the 444 discovered JavaScript files use native
per-file medians from the three artifact-backed runs. This also balances each
complete models job at about 164s and the two sync jobs at about 210–212s.
UI is estimated at 289s, so further lifecycle splitting would add setup without
consistently shortening overall verification.

## Keeping the allocation current

Use the explicit artifact refresh command in
[the original scheduling investigation](CI_SCHEDULING_20261018.md#refreshing-estimates)
after adding a substantial suite or expanding an existing one. Check unmeasured
suites and replay representative runs, then validate the resulting commit with
the full GitHub workflow. New suites always remain included even before they
have measurements; the fallback is a scheduling estimate, not a runtime limit.

## Validation

Local CI contracts verify complete, disjoint Python and JavaScript coverage,
deterministic allocation, inclusion of new tests and unchanged failure gates.
All 31 local CI contracts passed. The full GitHub workflow validates every group
and Windows deployment contracts.

The first post-change full run,
[39190286918](https://github.com/218218y/netunim/actions/runs/39190286918),
passed all 133 suites and Windows in **6:44**, compared with the latest baseline's
**8:11**. Complete lifecycle jobs took **5:40 / 4:47 / 4:14 / 6:29**. The longest
job dropped from 7:55 to 6:29, although actual jobs still varied substantially.
Every lifecycle-4 suite took 1.18–1.65 times its estimate, while lifecycle-3's
suites took 0.79–1.01 times their estimates. This is consistent with machine-wide
speed variation; it does not prove a particular hardware cause. The new timing
estimates balance expected work, rather than promising identical elapsed times
on independently assigned machines. Further full runs on the final PR commit
are linked from the PR validation record.
