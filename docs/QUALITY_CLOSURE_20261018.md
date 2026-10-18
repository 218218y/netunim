# Quality closure after PR #244

This is a dated evidence record. The only open-work plan is
[ARCHITECTURE_REMAINING_WORK.md](ARCHITECTURE_REMAINING_WORK.md).

## Programmatic completion

- [UI completion](UI_ACTION_COMPLETION.md): real calendar filter dates, returned
  delegated completion, one fallback for escaped rejections and native event tests.
- [Runtime admission](STORAGE_RUNTIME_COMMAND_ADMISSION.md): 22 reproduced
  mutable-input cases, late boundary locks, strict option capture and native
  durable checkpoint/recovery evidence. Existing journal/ACK owners are retained.
- [Feature contract](FEATURE_ENTRY_CONTRACT.md): Acorn/scope analysis checks every
  application action pack. Negative examples cover discarded conditional calls,
  raw browser effects, owner-bypass imports and unmanaged timers. An executable
  new-feature example composes an existing command and mutation admission.
- Long lines in Global Search and cashflow decrease from 22 to zero; their
  parsed programs and cooked values are identical. [Hashes and metrics](evidence/readability-quality-20261018.json)
  record the proof. Canonical totals decrease from 412/94 to 386/88 over 500/1,000
  characters. The ratchet now prohibits recurrence in those files and cleaned packs.
  Only 108 source bytes were added; no runtime module or timing ceiling changed.
- Earlier refactor/stage documents are marked historical. Bank integrity evidence
  includes PR #244. Retained formats, compatibility readers and deployed SQL remain.

## Loaded-data measurement

`runtime_loaded_data.py` is part of the full CI inventory. It seeds native IDB,
reloads the actual application and measures checkpoint capture, local recovery,
opening, delegated search, global search, durable editor work and retained JS heap.
Both applications run at 1,000 and 10,000 business rows with CPU throttled 4x.
Kupa additionally renders two synthetic Bank feeds with 2,000/20,000 observations
spanning approximately 0.68/6.85 years and measures the shared forecast. A second
tab must remain without command admission. The measured Bank feeds are transient
synthetic read fixtures; this is not a live archive/provider latency measurement.

The [local 1,000-row diagnostic](evidence/loaded-data-local-20261018.json) records
Windows/AMD64, instrumented shells, the dirty source revision, fixture bytes,
durations and post-GC heap. It is an exploratory observation, not a portable CI
baseline. Representative observations under 4x CPU: Kupa local recovery 80.5 ms,
Bank opening 3,750 ms, forecast 175 ms, durable editor work 3,292 ms and retained
heap 7.60 MB; Orders recovery 185 ms, supplier opening 1,338 ms, delegated search
5,412 ms, durable editor work 2,261 ms and heap 7.43 MB. These single samples
identify full-table rendering/search and editor work for follow-up measurement;
they do not establish a new timing ceiling or justify more module splitting.

The CI run retains `.work/loaded-performance/latest.json` alongside the existing
startup/performance artifacts. The report binds revision, environment, data sizes,
CPU rate and missing milestones. Unavailable command readiness stays `null`.
The existing uninstrumented repeated cold/cached/offline startup gate remains
separate. Hardware-constrained memory, physical weak machines and representative
private business datasets remain operator measurements. No bundler, new cache,
parallel writer or synthetic speed claim was introduced.

## Operational evidence and release boundary

An authenticated `BEGIN READ ONLY` catalog capture at **2026-10-18 11:09:17 UTC**
matched all 41 migration identities and SQL hashes, 128 functions, application
tables/columns/constraints/indexes, grants/RLS/policies/triggers/types, pg_cron and
both active retention jobs/settings. The supported recorder refreshed the source
audit and hash-bound Production receipt; no migration or business row was changed.
The read-only check and offline release gate passed. This observation does not
certify a future static upload; the next upload needs its own fresh gate.

| Scenario | Evidence / status |
| --- | --- |
| Unit/contracts, native browser/IDB and isolated PostgreSQL | Full branch CI is the merge requirement for each stage. |
| Runtime command capture and failure/boundary admission | Focused regressions and native IDB replacement/recovery pass. |
| Production schema and installed SQL | Fresh authenticated read-only catalog/manifest postflight passed. |
| Old/current release asset mixing | Existing native compatibility and deployment contracts remain in CI. |
| Loaded rows, long synthetic Bank history and two browser tabs | Automated measured fixture; CI artifact retained, no physical-client claim. |
| Two physical computers, A-B-A in installed apps | Not performed in this continuation. |
| Live Bank/Credit, installed Bridge update/interruption | Not performed; only the working-data connection is available. |
| Actual staggered Orders/Kupa rollout and weak-hardware performance | Not performed. No static site was uploaded in this continuation. |

The safe next operational sequence is the existing
[paired rollout/recovery runbook](DEPLOYMENT_COMPATIBILITY.md): record exact source
and previous deployment IDs, obtain a fresh DB gate, upload Orders, then upload
Kupa. Run the separate optional public checks when network access is available.
Roll forward only the failed project or restore that project's
recorded prior deployment and smoke it against its exact prior checkout. Saving,
closing and reopening existing app tabs activates their waiting workers. Browser
or database business state is never reset to recover a static deployment.

Start installed/provider checks with reads. Interruptions, destructive restore
and account-transfer failure drills require disposable data and a separate safe
environment. CI completion does not close these operational requirements.
