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
