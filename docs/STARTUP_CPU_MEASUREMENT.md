# Repeated startup under CPU throttling

The native startup gate now measures five isolated profiles per app at native
CPU speed and five with Chromium's 4x CPU throttling. Each profile includes cold,
cached and offline navigation with actual Service Worker ownership, plus the
secondary-tab command-admission check. Storage, Auth, recovery and background
Finance ownership remain eager.

The report preserves native `samples`/`summary` and adds `cpuThrottled`. Each
metric records n, min, median, nearest-rank p95 and max. With five samples p95
equals the maximum: this is a regression observation, not a stable population
tail estimate. Raw samples and module request timelines are retained alongside
the summaries in the existing CI artifact.

Resource timing records each module's request start, response completion and
transfer bytes, plus how many requests start after the first module response.
This helps distinguish dependency discovery/scheduling from CPU execution.
Request start times are browser observations, not a pure network measurement.

CPU emulation is reproducible evidence under slower execution, not a claim of a
physical weak-device test. Network, disk and memory are not throttled. Generous
existing timing ceilings remain regression gates, not speed targets.

Use `NETUNIM_STARTUP_REPETITIONS` (1-10) and `NETUNIM_STARTUP_CPU_RATE` (2-8) for
focused diagnostics. Full CI uses five repetitions at 1x/4x and uploads
`.work/startup-performance/latest.json`. Production splitting or bundling needs
comparable before/after evidence; no new lazy boundary is justified solely by
this measurement expansion.

## CI observation

Five samples per profile from the successful browser measurement job in
[run 38789272135](https://github.com/218218y/netunim/actions/runs/38789272135)
are preserved in `evidence/startup-cpu-20261015.json`. This identifies the
measurement job and exact source revision independently of other run jobs.

| Cold startup, ms | Kupa native | Kupa CPU 4x | Orders native | Orders CPU 4x |
| --- | ---: | ---: | ---: | ---: |
| Last module response median | 499 | 813 | 662 | 821 |
| Last module response p95 | 633 | 1058 | 1118 | 1047 |
| ScriptDuration median | 24 | 92 | 40 | 153 |

All cold/cached/offline profiles passed the existing readiness and offline
gates. Module response timing remains a larger elapsed interval than measured
script execution; the data does not establish a causal bottleneck or a speedup
from any new split. Variability is visible even between isolated profiles. No
new lazy presentation or build system is introduced on this evidence alone.

## Completeness and physical evidence

The report now records its exact source revision, clean/dirty status, execution environment and fresh-profile workload. Every metric retains `n`, `missing` and `complete`, including metrics with zero observed values. Their min/median/p95/max remain null. A missing Kupa business view or command-ready milestone on the initial connection screen is visible as missing evidence, rather than disappearing from the summary.

`python tools/startup_evidence.py .work/startup-performance/latest.json --output .work/startup-inspection.json` recomputes the summary from raw samples. `--require-complete` returns failure unless both apps have at least five measurements of every metric in cold/cached/offline mode. Explicit zero remains valid; booleans, invalid numeric values, CPU-emulated substitutes and a forged supplied summary cannot satisfy the check.

For a physical release measurement use `--require-physical --revision FULL_COMMIT_SHA` on an operator-collected report with native CPU measurements. The environment must identify a clean Windows revision, an interactive `browserMode: "headed-chromium"` session and operator-supplied `hardwareClass: "weak"`, `deviceDescription`, `diskDescription` and `networkDescription`. These descriptions are operator evidence, not independently inferred hardware certification. Existing-account view/command-ready measurements still need the corresponding loaded workload; a fresh connection screen cannot substitute for it. CI/headless/CPU-throttled observations do not prove physical weak-device performance.

No further lazy loading or bundling is justified by this reporting change. It makes the remaining measurement work explicit and preserves the existing size and timing ceilings.

### Current automated observation

The successful [Bank/Credit branch run 38870926031](https://github.com/218218y/netunim/actions/runs/38870926031), commit `5cb8da126c6756cd5677b4c6c93380d7c24433ff`, was reanalyzed from its raw artifact. Five native-CPU cold samples show ScriptDuration median/p95 of 35.8/38.7 ms for Kupa and 55.4/62.7 ms for Orders. Orders first view and command-ready medians were 893.3 and 909.7 ms. Kupa has zero observed first-view/command-ready samples in all three modes: all five are missing at its initial connection screen. This is incomplete business-readiness evidence, not zero latency or a failure to load the connection screen.

The full reanalysis and Actions provenance are in `evidence/startup-completeness-20261016.json`. These CI observations establish neither weak physical hardware performance nor a causal bottleneck. Completeness is separate from speed: actual latency values still need comparison within the same hardware/workload, alongside the existing regression ceilings.
