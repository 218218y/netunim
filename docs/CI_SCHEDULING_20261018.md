# CI scheduling investigation — 18 October 2026

The critical path came from two concentrated workloads: positional Python suite
striping, and one JavaScript file that repeatedly compiled the full TypeScript
contract program. Additional runner queues increased elapsed workflow time.

## Measured baseline

Downloaded job metadata, complete timing artifacts and timestamped models logs
from three successful push runs on the latest development branches:

| Run | Full workflow | Lifecycle 1 / 2 / 3, tests only | Models, tests only | Module contracts / Node models |
| --- | ---: | --- | ---: | --- |
| [39091864804](https://github.com/218218y/netunim/actions/runs/39091864804) | 671s | 535 / 280 / 246s | 367s | 32 / 336s |
| [39091815608](https://github.com/218218y/netunim/actions/runs/39091815608) | 595s | 510 / 325 / 338s | 351s | 35 / 315s |
| [39091804505](https://github.com/218218y/netunim/actions/runs/39091804505) | 497s | 464 / 317 / 272s | 460s | 45 / 415s |

These are separate successful snapshots, rather than controlled repetitions of
one commit. Differences therefore cannot be attributed exclusively to runner
speed. Nevertheless the same compilation-heavy cases were consistently slow:
the 83 cases in `typecheck_contracts.test.mjs` summed to 289.5s, 269.4s and 356.1s
respectively. They accounted for most of Node's elapsed time. Their individual
durations also increased in the slower run. CPU/memory and machine contention
are a plausible explanation for much of the models variation; the logs do not
establish a single hardware cause. Setup and queue durations are measured
separately and must not be treated as test execution.

Matrix jobs in one run began 19–240s after workflow creation. Removing a test
bottleneck cannot remove an account-wide or platform runner queue. Existing
push, PR, merge queue and manual triggers remain intact, as does the policy of
verifying every pushed version without cancelling earlier pushes.

## Changes and tradeoffs

- Lifecycle uses four duration-balanced partitions. Its roughly 1,081s median
  sequential inventory could only reach about 360s even with perfect balancing
  across three machines. Four machines bring the estimated loads to 269–271s.
- UI uses one machine. Its two previous shards together took 275–294s in the
  sampled runs. This is comparable to the new lifecycle loads and frees one job.
- Models uses two machines. Every discovered JavaScript file belongs to exactly
  one partition; each machine keeps the existing two isolated Node workers.
  Module, asset, type and lint contracts join one of the model partitions.
  File balancing reserves that additional workload before assigning Node files,
  so it balances the complete jobs rather than only their JavaScript portions.
- The 83 large implementation mutation cases now live in four independent files
  for core contracts, application behavior, documents and finance. The test bodies
  were transferred unchanged except for normalizing CRLF before one multiline
  mutation, so that case also exercises its intended change on Windows. The
  shared compiler fixture preserves a fresh
  compiler host, program and diagnostic check for every mutation. No assertion,
  negative type fixture or full-program check was removed or cached.
- Sync retains two machines and receives the same duration-based balancing.
- The matrix has 13 groups instead of 12. Its fixed 12-job cap was removed, and
  groups are offered in descending estimated duration. GitHub owns actual dispatch
  order and account concurrency, so this ordering does not guarantee start times.

Four lifecycle machines plus one UI machine and two models machines avoid making
UI much shorter than the other substantial jobs. More shards would add setup
work while UI remains close to five minutes. Increasing in-machine Node/browser
concurrency would instead add CPU/memory contention and could distort performance
measurements. Browser suites remain serial within each job; the performance
suite still owns its machine while it executes.

Replaying the four lifecycle allocations against the **same measured suite
durations** gives:

| Baseline run | Previous longest lifecycle shard | New four shard totals | New longest |
| --- | ---: | --- | ---: |
| 39091864804 | 535s | 254 / 265 / 266 / 276s | 276s |
| 39091815608 | 510s | 300 / 288 / 293 / 292s | 300s |
| 39091804505 | 464s | 264 / 260 / 269 / 260s | 269s |

These are estimates obtained by reallocating prior measurements, not actual
post-change execution times. The expected test critical path is around five
minutes before setup, artifact upload and runner queues. Total runner minutes
need not decrease: the purpose is to shorten elapsed verification time while
keeping resource contention and repeated setup controlled.

## Coverage, failures and reporting

### First measured post-change run

[39093704842](https://github.com/218218y/netunim/actions/runs/39093704842)
passed every job, including Windows and the complete verification gate, in
**305s (5:05)**. The same run recorded these execution times, excluding setup:

| Group | Measured test time |
| --- | --- |
| Lifecycle 1 / 2 / 3 / 4 | 215 / 211 / 267 / 266s |
| Models 1 / 2 | 203 / 140s |
| Combined UI | 216s |
| Sync 1 / 2 | 219 / 147s |
| Morning | 187s |

The Node reports contain exactly 424 distinct file completions across the two
models jobs, with no failures; all 83 implementation mutation cases passed.
The models difference includes both module-check overhead and the initial file
estimates. The final snapshot replaces the initial Windows/derived Node estimates
with these actual Ubuntu file measurements, combines all four runs' suite
measurements using medians, and reserves module overhead during Node allocation.
The final estimates are about 151s for each complete models job and 262–263s for
each lifecycle job. Actual timing still depends on runner conditions.

The local contracts group (all 19 suites), the scheduler/cleanup contracts, the
CI contracts and targeted ESLint checks passed on Windows. The full original
local models baseline exposed one existing CRLF-sensitive mutation; its
normalization fix was then verified against the real Windows source files.

### Coverage and artifacts

`verification_plan.py` remains the Python suite inventory. `node_models.py`
discovers all `tests/*.test.mjs` files, including new files. The versioned
`ci_timings.json` snapshot contains estimates only and cannot exclude a test.
Missing measurements receive a median default. Invalid measurements fail plan
construction; updates require an ordinary reviewed source change.

The regression contracts exercise complete, disjoint Python and JavaScript
partitions, automatic inclusion of new files, deterministic balancing, local
resource limits, Node failure propagation, retained child reports, and the
exact-job fast-deploy gate. A missing, duplicate, skipped or failed shard still
blocks deployment. Local full verification runs both model partitions, with
only one partition's two Node workers active at once.

Each model suite writes `node-files.jsonl` under its normal report directory.
The additional reporter observes the parent runner's file completion event,
including plain assertion files, import failures and process startup time;
it retains the normal spec output and native failure status. This uses Node's
[test runner event interface](https://nodejs.org/docs/latest-v24.x/api/test.html#event-testcomplete).
Reports are artifacts, never restored as verification results. The existing
fresh npm/pip installation policy is unchanged.

## Refreshing estimates

Download artifacts from representative successful runs, then explicitly rebuild
the checked-in snapshot using their report folders:

```text
gh run download RUN_ID --repo 218218y/netunim --dir .work/timing/RUN_ID
python tools/update_ci_timings.py --report-root .work/timing/RUN_ID --source https://github.com/218218y/netunim/actions/runs/RUN_ID
python tests/run_all.py --ci-matrix
python tests/ci_contracts.py
```

Repeat `--report-root` and `--source` for multiple runs. The updater deduplicates
overlapping input paths, uses medians, excludes unsuccessful/not-run samples,
and rejects invalid successful durations. Review the resulting partition loads
and diff before committing. Historical measurements are never fetched during CI
planning or used to authorize a deployment.
