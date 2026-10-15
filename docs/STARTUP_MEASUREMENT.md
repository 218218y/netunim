# Native startup evidence

`tools/startup-graph.mjs` follows the deployed ESM imports from `assets/app.js`.
It separates static imports from dynamic imports and worker entrypoints, counts
first-party source after CRLF normalization, and reports the marginal closure
removed by each static edge. Vendor internals are outside that source budget.
An edge with a large closure is a measurement candidate, not permission to defer
Storage/Auth/Shared recovery or move an authority check.

`shared/startup-timing.js` is the first dependency of both composition roots. Its
eleven allowed milestone names are recorded at most once per document. Snapshots
contain numeric times only: no business values, URLs, storage, telemetry upload,
observers, listeners or scheduled tasks. An unavailable Performance API cannot
change startup. The implementation is included in strict checkJs.

The timeline distinguishes dependency evaluation, composition, lock/owner
readiness, local Main/Shared recovery, first actual view render, boot completion
and permission to run commands. Boot completion alone is not command readiness;
the primary-tab, protocol, recovered-storage and capability gates still decide.
Kupa's first-run connection screen can finish boot without a business view or
editing session. Missing milestones are `null`, never inferred as zero.

The evaluation interval starts when the first imported module executes. It does
**not** include all JavaScript parsing/compilation: Chrome can parse modules
while fetching them. `runtime_startup.py` also records native Resource Timing,
DOMContentLoaded and CDP ScriptDuration/TaskDuration. ScriptDuration includes
startup JavaScript work, not just module evaluation. Resource response times
include browser scheduling and module discovery; they are not a pure network
bandwidth measurement.

The browser suite uses uninstrumented deployed modules, a disposable origin and
profile, actual Service Worker installation, cached navigation and offline
navigation. It also checks that a secondary tab never reports command readiness.
The test only enlarges the browser Resource Timing buffer before navigation;
it does not inject application bindings or replace startup functions. Existing
PWA tests separately prove real committed edits survive offline reloads.

## Initial observation, 2026-10-15

One local Chromium sample per mode is diagnostic evidence, not a portable speed
baseline. Before any lazy change, the instrumented production timeline observed:

| Cold local load | Kupa | Orders |
| --- | ---: | ---: |
| Static first-party modules | 303 | 401 |
| Last module response, ms from navigation | 1302 | 1123 |
| Dependency evaluation interval, ms | 1.2 | 18.0 |
| Composition, ms | 22.2 | 27.7 |
| Local recovery, ms | 12.0 | 7.5 |
| CDP startup ScriptDuration, ms | 33.3 | 54.7 |

Cached/offline module transfers were zero, but response scheduling still varied.
Do not claim a startup win from file counts or this single sample. The largest
optional common closure includes document search/viewers; its actual lazy split
must preserve cancellation, account replacement, first-use failure/retry and
offline cache availability before reducing budgets.

`tests/fixtures/startup-budgets.json` supplies deterministic source/module ceilings
and deliberately generous timing regression ceilings. They are not performance
targets or a cross-machine ratio baseline. CI uploads the complete cold/cached/
offline observations as `.work/startup-performance/latest.json`, including on a
failed job. Tighten timing thresholds only using repeated comparable CI samples.


## Repeated search presentation experiment

The second phase records three isolated profiles per app and min/median/max for
every cold/cached/offline duration plus module responses and ScriptDuration. See
LAZY_SEARCH_LOADING.md and evidence/startup-search-20261015.json for the measured
optional search split, tightened source ceilings and the explicit lack of a
proven overall cold-latency improvement. Full CI uploads every raw repetition.
