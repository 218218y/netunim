# Service Worker installation investigation — 2026-10-25

The historical intermittent Windows installation failure has not been reproduced
in this investigation. Passing reruns do not establish its cause or resolution.
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
Further root-cause work requires a failing artifact; concurrency/Windows backend,
network/cache rejection and a product install race remain unproven hypotheses.
