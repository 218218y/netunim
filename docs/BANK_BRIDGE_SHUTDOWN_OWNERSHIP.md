# Bank Bridge shutdown and replacement ownership

## Evidence and corrected behavior

At baseline `91a8b6c08814dc8b719b730be2fd12a9d288e98a`, shutdown
acknowledged the request and closed the HTTP server before exiting. Closing HTTP
sockets did not own accepted commands whose clients had disconnected. A native
staged-server test held an actual vault deletion after disconnect: the process
exited before the deletion could complete. Replacement also escalated accepted
shutdown past its wait budget, or a lost shutdown response, to a force kill.
Both failure cases were reproduced before changing the production behavior.

The replacement implementation also treated any failed HTTP health probe as
absence, including an unanswered request. Focused failing tests exposed that
ambiguity. The native replacement CLI now refuses replacement while a TCP
listener remains open despite an unanswered health request. Finally, real
cmd.exe execution of the installer's startup-failure block reproduced a rollback
swap after a failed stop command. The corrected block preserves all three
runtime directories when shutdown remains unconfirmed.

## Boundaries and lifecycle

| Owner or port | Responsibility |
| --- | --- |
| `operation-owner.mjs` | Reserve accepted configuration/read/provider tasks; close admission immediately; drain tasks through their final cleanup/publication |
| `shutdown-owner.mjs` | Own one delayed shutdown flight and signal subscription; join operations, diagnostic queue, listener closure and then exit |
| `credit-diagnostics.mjs` | Drain its existing append queue, including records appended while drainage is pending |
| `replacement-command.mjs` | Require service identity, pairing, positive shutdown acknowledgement and confirmed listener closure before allowing runtime replacement |
| `loopback-port.mjs` | Native TCP evidence: only ECONNREFUSED certifies listener absence; connect means present, other failures remain errors |
| `server.mjs` | Bind timers, signals, HTTP listener closure, process exit and loopback probes to these narrow boundaries |

The operation owner retains accepted work independently of sockets. Closing it
rejects new commands without discarding queued commands or poisoning the FIFO
after a rejection. A provider retains ownership through its existing browser
termination and metadata publication. HTTP rejects new private routes before
body consumption or capability entry while shutdown is pending. Existing public
health/preflight and authenticated shutdown retries remain available.

Constructing the shutdown owner starts no timer or subscription. `start()` is
idempotent; repeated requests join one promise. The listener remains open until
accepted operations and diagnostic attempts settle, so listener closure cannot
precede those obligations. Signals follow the same lifecycle. The owner releases
its signal subscription before exit. A teardown failure is reported, prevents
exit certification and allows a later shutdown request to retry.

The diagnostic logger retains its prior best-effort write-error policy,
redaction, rotation and retention. Drain waits for all queued attempts; it does
not turn previously ignored filesystem failures into a durability guarantee.

## Replacement and installer policy

`/shutdown` still returns `{ok:true}` before teardown. That acknowledgement
means shutdown was requested, not that accepted work has already completed.
The installer still waits up to five seconds for normal closure. A longer drain
returns `BRIDGE_SHUTDOWN_PENDING` and asks the operator to retry after it stops.
Unknown health, lost acknowledgement and failed TCP closure probes return
classified errors. No PID lookup or kill capability is available to replacement.
An unpaired or incompatible existing service must be closed normally before
retrying installation. Startup-failure rollback also requires a successful stop
before deleting or moving runtime directories.

Only refused loopback TCP connections prove absence; HTTP timeout, abort, parse
failure or reset alone cannot authorize replacing an occupied runtime. These
checks do not establish a cross-process installer lock or protect against an
unrelated process taking the port between checks. Windows forced termination,
power loss and external process kills cannot be made graceful by this owner.

## Validation and remaining scope

Focused tests cover disconnected accepted vault deletion, provider cleanup,
queued failure and subsequent commands, trailing diagnostic bytes, repeated
shutdown, signal entry, teardown failure/retry, admission/auth ordering, actual
replacement CLI timeout/unanswered health, native TCP open/closed distinction
and native installer rollback failure/success. Staged tests copy the actual
installer module closure, use a private port and isolated LOCALAPPDATA, and never
stop an installed service or log in to a live provider. Test-only gates hold
real filesystem obligations deterministically in those disposable copies.

Strict checkJs covers the actual lifecycle/replacement implementations, invalid
consumer ports and forbidden process-killing authority. An implementation
mutation must reject a string substituted for completed teardown. Import and
collaborator budgets keep both owners free of direct runtime I/O. Windows CI
requires native DPAPI, startup/shutdown and cmd.exe rollback execution; full CI
retains PostgreSQL, browser, recovery, ACK and fault gates.

Schema, encrypted formats, version 73 envelopes, provider algorithms and
retry/fallback policy are unchanged. Existing provider AST fixtures remain
unchanged. Bank session stages and credit profile orchestration still need
responsibility decomposition. Physical two-computer rollout and authorized live
issuer behavior remain separate validation work.
