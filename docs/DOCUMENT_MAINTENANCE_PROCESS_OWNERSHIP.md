# Document maintenance process ownership

## Evidence

Before-change tests executed the production server functions with controlled
ports. A manual start waiting for the scheduled lock probe could launch after
shutdown had begun. Failure at worker init also left its IPC stop listener and
connection active. Native tests now run that actual main branch in a synthetic
child and prove init failure closes IPC and exits.

Another controlled production-function regression proved that status could
report idle when manual work began during the scheduled-lock observation. Status
now reads the live manual owner again after that await. None of these results
demonstrates loss of application data or a failure at a live provider.

## Contract

`maintenance-process-owner.mjs` owns one manual child scope and exposes only
`start`, `stop`, `dispose`, and `view`. Process launch/IPC are a separate adapter;
the owner receives host, timers, clock formatting and diagnostic ports. The
server composes these ports and retains the existing public status fields and
worker message types.

- Concurrent starts join the same lock observation and launch. Terminal disposal
  fences that observation before a child can be launched. A scheduled owner or
  failed/uncertain lock observation does not authorize manual entry.
- Concurrent stops join one captured child's IPC handshake. Stop confirmation
  means the request was sent; it does not prove worker completion or a commit.
  Failed sends are visible and can be retried on that same live scope.
- Result/progress messages can update only their current running scope. A result
  remains provisional until process `close`, including IPC/stdio settlement.
  Spawn failures can emit `error` and `close` without `exit`; they still retire
  the scope. Exit zero without a result is reported as an unknown confirmation.
- On close the owner's scoped listeners are removed. A late callback from a
  previous scope cannot mutate a replacement or acknowledge its stop.
- Disposal permanently prevents new work. It joins the pending start, requests
  cooperative stop, and waits for close. The two-second server drain budget fits
  its existing 2.5-second installer shutdown request. A timeout or stop failure
  reports an error; it never kills the child or declares successful teardown.
  Listeners and ownership remain until actual close. A later shutdown request
  can confirm drainage, while new starts remain disabled.
- Shutdown HTTP returns success and enters listener teardown only after manual
  drainage and native preview disposal. A drain timeout returns 503 with
  `PDF_MAINTENANCE_DRAIN_TIMEOUT`; installation refuses activation. Writes already
  started retain their completion path rather than being interrupted by parent
  cleanup. The worker's existing abort checks still stop future extraction.
- The worker always removes its stop listener and disconnects IPC in `finally`,
  after its work settles, on success and failure. Its stable index lock is still
  released by the separate file-lock coordinator.
- Diagnostic log failure is observed independently; it cannot orphan a launched
  child or turn a sent stop into an apparent failed handshake.

The policy covers the child launched by this Bridge runtime. A separate Windows
scheduled task, external termination, old binary, filesystem mutation or full
maintenance/index writer semantics remain separate owners/gates.

## Verification and operation

Deterministic tests cover start/stop coalescing, scope replacement, closed/missing
result paths, bounded disposal, pending lock probes and 100 ownership cycles.
Native Node children cover IPC stop, actual spawn failure, production init error,
and a held synthetic disk commit that finishes before disposal. Actual HTTP
tests reject premature listener teardown and accept a later request after close.
Strict checkJs checks implementation bodies and negative consumers, including an
implementation mutation that returns text instead of boolean running evidence.

If shutdown reports a drain failure, keep the existing installation and inspect
the PDF maintenance status/log. Wait for the worker to close, then retry the
installer/shutdown. Do not kill an index writer or remove its live lock to make
installation proceed. Read the complete retained index before retrying work
whose outcome is unknown. The normal installer rollback stays in place.

Activate via the updated `install_document_bridge.bat`; both modules are staged
before validation/activation. No Storage V2, business journal, SQL, PDF persisted
schema, provider retry/fallback or browser protocol version changes are included.
