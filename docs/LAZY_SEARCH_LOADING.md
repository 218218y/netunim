# Deferred global search presentation

Both app shells bind a small shared interaction owner at startup. The full
global document-search presentation loads on first trigger/Ctrl-K use; business
index callbacks and the document-source capability remain eager. Storage, auth,
financial commands, background refresh and recovery retain their startup owners.

The loader body is strict checkJs. It joins imports, binds one presentation,
removes temporary listeners and preserves synchronous calls once loaded. During
loading the input can receive focus/text and Escape/backdrop/close cancel intent.
An actual blocked-import experiment proved that Chromium retains a failed module
URL in the current document. The recovery button explicitly reloads the page;
retrying import of that same URL in the same document cannot recover it.
Closing/disposal or any account observation
(including A to B to A) invalidates queued work before view creation. The loaded
presentation retains its existing provider deadlines, query cancellation, private
viewer mounts and account privacy guards. No provider warmup occurs before use.

All first-party deferred modules remain in the deterministic Service Worker shell.
Native tests prove no heavy search request at startup, first use after offline
reload, keyboard/trigger/close interaction, no viewer-vendor fetch for site search
and a held import invalidated by account changes. A native blocked-module test
proves successful first use after the recovery button reloads, with readable
Hebrew guidance. Existing privacy/deadline/viewer
suites and the full PWA/account/two-computer gates remain enabled. Model tests
include import/bind failure retry, disposal and a real implementation mutation
that recreates late opening after cancellation when the guards are removed.

## Measurement

Three isolated profiles per app/candidate produced cold, cached and offline
samples. runtime_startup.py now records all repetitions and min/median/max in CI.
The checked-in experiment summaries are in evidence/startup-search-20261015.json.

The deterministic eager graph removes 13 modules and about 91 KB from each app.
The startup ceilings tighten to 288 modules / 1,685,000 bytes for Kupa and
388 / 2,286,000 for Orders, preserving only bounded headroom. No bundler was added.

| Local cold median | Kupa before / after | Orders before / after |
| --- | --- | --- |
| ScriptDuration, ms | 24.5 / 20.9 | 40.2 / 36.9 |
| Composition, ms | 16.8 / 13.5 | 22.4 / 19.3 |
| Last module response, ms | 514 / 555 | 779 / 915 |
| Cached last module response, ms | 554 / 447 | 680 / 616 |

CPU work and the eager graph decrease; cold response scheduling is variable and
does not demonstrate an overall cold-start latency win. These small local samples
do not establish weak-machine or cross-machine performance. Keep future splits
measurement-driven; do not lazify transaction/refresh ownership to improve counts.
