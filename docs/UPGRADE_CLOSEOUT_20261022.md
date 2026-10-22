# Search and Bridge completion evidence, 2026-10-22

## Proven defects corrected

- Native Everything proximity silently omitted a valid long repeated-prefix
  fixture and kept doing regex work after its ES client was cancelled. The
  application now retrieves simple content candidates and verifies them using the
  existing canonical matcher before publishing/paging. Candidate exhaustion is
  explicitly partial, visible in both UIs, including empty searches and pagination.
- Search cancellation previously stopped at the client/HTTP boundary. Typed
  read-only cancellation now reaches ES and fences ignored late output. Accepted
  commands still drain and disconnected command failures remain audited.
- A native execFile timeout had `code:null`, which numeric conversion mislabeled
  `ES_EXIT_0`. It now reports `ES_TIMEOUT`.

The existing canonical browser/Bridge/classic-worker matching contract is retained;
no second text algorithm, storage layer or synchronization owner was introduced.
See [native reproduction and limits](EVERYTHING_PROXIMITY_20261022.md).

## Native Windows upgrade evidence

`tools/probe-document-bridge-upgrade.py` copies the real root modules from pinned
historical commits (38: `cbe8f80a0fecf7644ff35a4e08cdff0ddca037a5`,
39: `530ea4832d094d84b5ffd3e9718e355fbf5f2cef`) and the current source. A reviewed,
hash-verified private Node executable starts each listener in a disposable root.
Only the staged port constant is substituted; the working installation is never
contacted. A copied Node executable rejects ES arguments, preventing a real
Everything/provider launch. Before each replacement the probe verifies the PID
belongs to its owned child, runs the actual newer `--check-running` (must reject
the older service), then `--stop-existing`, and confirms clean old-process exit.
Each new version passes its real health/version check and preserves the token and
configuration. The final owned service shuts down cleanly.

The [raw observation](evidence/document-bridge-upgrade-20261022.json) identifies
revisions, staged module hashes, port substitution and the private executable hash.
It deliberately reports the working tree's dirty state. It is a native listener/
replacement test, **not a full installation acceptance**: global startup shortcuts,
maintenance-task registration, installed preview handlers and mixed offline/PWA
tabs were not exercised by this probe. Existing automated installer rollback,
accepted-work drain, native C# preview and stale-client tests remain required.

Reproduce on Windows from a checkout containing those historical Git objects:

```powershell
python tools/probe-document-bridge-upgrade.py
```

The tool never fetches missing history or modifies an installed service. The
existing required Windows runtime test also now uses a disposable port, so it
can run locally while the working Bridge occupies 8766. Its real private runtime,
HTTP gates, shutdown and C# preview host are still tested.

## Research and decisions

**PDF boundaries:** the immutable PDF.js corpus now includes an actual synthetic
PDF containing single words, touching font runs, a small positive visual gap,
an extracted space and a line break. The pinned PDF.js extractor returns the same
`alphabeta` string for a single item, touching differently styled items and a
small positive gap. Font runs alone are not word boundaries. Geometry distinguishes
these particular cases, but does not establish a universal threshold for kerning,
tracking, RTL layout and older documents. Existing zero-gap fallback remains;
the known possible false positive is explicit. No safe behavioral change was
proved against representative business PDFs. The new corpus test preserves that
evidence for future work; it does not claim broad PDF precision is solved.

**Bank security:** isolated native restart/token revocation now passes, including
Windows DPAPI byte preservation. Default CORS reflection remains unchanged pending
an inventory of installed/custom application origins, browser/PWA/private-network
permission tests and rollback evidence. See
[the threat model](BRIDGE_THREAT_MODEL_20261022.md). The valid-token foreign-origin
case remains a known hardening gap, not an authentication bypass.

**Performance:** the native regex/canonical verification comparison addresses a
proven search defect. Its before/after samples are not median/p95 UI benchmarks.
No representative weak/normal physical-machine study was available; no cache,
framework, DOM virtualization or durable-write changes were justified.

## Verification and remaining acceptance

PR [276](https://github.com/218218y/netunim/pull/276) passed the complete gate at
`b007847e7a9d7e1f44511018f37a4cd5615fd664` in
[run 39756263950](https://github.com/218218y/netunim/actions/runs/39756263950), including
Windows, PostgreSQL, strict contracts and real-browser suites. Its merged main
tree was verified identical. Subsequent cancellation/evidence changes require
their own complete branch gates; the final completion message records their exact
passing revisions/runs. Duplicate runs of an identical tested merge tree may be
cancelled without rerunning that source solely because it reached main.

A CI attempt also observed `.git/objects` changing during temporary test-repository
cleanup. Disposable asset fixtures now disable automatic Git maintenance/GC so
background object writers cannot outlive their commands. This fixture policy does
not alter the working repository's Git configuration or weaken asset checks.

Focused local checks cover native Everything, both application DOMs, canonical
search, PDF corpus extraction, HTTP disconnects, cancellation, late output,
shutdown/audit, token revocation and isolated Windows replacement. Full verification
stays in CI; the broad local repair selection was stopped after it proved too slow
for this environment and is not counted as a completed gate.

Two physical Windows computers, destructive power/save interruptions, actual
installed-version/PWA/offline upgrades, backup restoration with pending work and
financial-provider test accounts remain **NOT RUN**. Follow the existing
[operational acceptance plan](OPERATIONAL_ACCEPTANCE_20261022.md). No production
account or business data was used for failure experiments. Further architectural
refactoring stops here unless a reproducible defect or representative measurement
justifies it; the remaining deployment/physical evidence cannot be manufactured
by adding more abstractions or synthetic tests.
