# Service Worker installation investigation — 2026-10-25

Windows CI reproduced a real installation rejection during this investigation.
Passing reruns do not establish its cause or resolution.
Both production workers still install with atomic `cache.addAll(SHELL)`, validate
release headers, wait behind existing controllers and claim only at activation.
No product worker algorithm, retry policy or timeout has been changed.

Previously, the PWA wait enabled the CDP ServiceWorker domain only after app
startup. Early installation exceptions and transient version states could already
have happened by then. Startup also awaited a single long ready/controller promise
without preserving the installation phase. These are confirmed observation gaps,
not proof of a product installation race.

`BrowserSession` now enables native worker events before first navigation, stores
bounded timestamped registration/version/error and network-failure evidence, and
retains it across browser-process restarts. Waits record registration, installing,
waiting, active and controller states. On deadline they identify whether there
was no registration, installation, waiting or activation/control. Cache names,
entry counts and a small path sample are captured separately instead of polling
the cache backend throughout installation. Failed sessions save evidence before
their owned profiles are deleted; unavailable CDP/cache diagnostics cannot replace
the original failure. URL query data is redacted from persisted native events.

Evidence is JSON in `NETUNIM_SUITE_REPORT_DIR` (the normal CI artifact directory),
or `.work/service-worker` for direct local runs. Existing CI artifact upload
already retains it. Success samples are also retained, allowing comparison with
later failures. Timestamped event records include browser-process generation.

Local Windows/Chrome 156.0.8078.48 experiments used separate disposable cold
profiles and loopback origins, sequentially, without real providers:

- Orders and Kupa release-fence tests passed with mixed future-release HTTP bytes
  and offline fetches. The focused release suite passed twice with the new
  observer; the final run also includes the negative installation experiment.
- A separate tiny worker deliberately throws during evaluation. The native
  `workerErrorReported` event is detected before the wait deadline; registration,
  cache state and timestamped evidence survive cleanup. This validates failure
  detection, not reproduction of the historical `cache.addAll` failure.
- Nine safety tests pass, including preserved errors when diagnostic reads fail,
  redaction and refusal to accept an active controller after a native worker error.

The existing cold/cached/offline CPU startup, legacy upgrade, process-restart
offline and release compatibility suites remain in the mandatory CI inventory.
Startup now uses the same observed wait with its original 30-second deadline.
In PR #302 run `40171105395`, Windows job `121101929824` failed during the legacy
upgrade: worker version 2 rejected `event.waitUntil`, with `TypeError: Failed to
fetch` at the `cache.addAll(SHELL)` installation line. The existing controller
remained activated, with no installing/waiting replacement. This is a genuine
installation rejection, not a polling deadline. Page-target network diagnostics
were empty: worker-initiated fetches are not reliably represented on that target.

For that reason SW browser sessions also write temporary native NetLog files.
After owned-browser shutdown the harness extracts only failed source IDs, paths,
timestamps and network codes into the suite artifact directory. Raw headers,
queries and payloads are never copied into artifacts; raw files disappear with
the disposable session. Network logging does not alter install requests or add
retries. A synthetic NetLog contract checks extraction and redaction.

The failing asset/network code is not yet established. Concurrency/Windows
backend, loopback server rejection and a product install race remain hypotheses.
One manual failed-job diagnostic rerun is permissible; it does not resolve or
erase the preserved first failure. The unrelated mock-browser CI contract was
updated to explicitly initialize its no-worker mode.

## Completion review

Eleven local harness safety contracts pass, including failed NetLog URL/code
extraction and redaction. The mandatory cold/cached/offline, release-upgrade,
process-restart and Windows acceptance suites remain enabled. HTTP/1.1 connection
reuse is a verified harness improvement; it has not established the cause of the
historical `cache.addAll` rejection.

The bounded investigation remains open only on new evidence: preserve a fresh
isolated profile's worker error/version/lifecycle state together with redacted
NetLog path and network code. Classify native browser/storage/network crashes
separately from worker installation. In particular, run `40186227810` recorded
Windows LevelDB checksum corruption after a hard kill and a separate Linux
Chromium network-service crash; its Windows PWA and release scenarios passed.
These failures do not justify product retries, timeout increases or a changed
worker installation algorithm. Retain original failure artifacts even if a
single diagnostic retry passes.
