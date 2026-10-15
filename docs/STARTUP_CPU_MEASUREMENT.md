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
