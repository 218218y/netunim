# Document native preview process ownership

## Evidence

Two deterministic tests against the previous production helpers failed before
the change:

1. Two initial commands waited on host availability, then each spawned a child.
   The process singleton was checked before the asynchronous file check, with no
   shared startup/readiness promise. The observed spawn count was two, not one.
2. The original error/exit callbacks rejected a global pending map even when
   their child no longer owned the active process. A former child's exit rejected
   the replacement's pending command instead of delivering its response.

These are helper-level reproductions, not a claim that production data was lost
or that a particular operator experienced the race. This owner handles local
preview UI and folder selection; it does not write Main, Shared or Finance data.

## Responsibility and lifetime

`native-preview-session.mjs` owns one startup promise, readiness handshake,
per-child input buffer, command map, error/exit/close consumers and timeout handles.
Its public API is `command`, `isRunning`, `stop`, `dispose`.
`native-preview-platform.mjs` owns Windows availability, hidden spawning and the
existing bounded PID/process-tree termination sequence through explicit ports.
The server retains opaque-result authorization, Office classification, geometry,
folder response validation and authenticated HTTP routing.

- Concurrent callers join preparation and wait for `PING` before sending their
  commands. Startup failure retires that unready child before replacement.
- Output and errors settle only the command map owned by their emitting child.
  Old partial frames, write callbacks and process events cannot settle new work.
- Command deadlines remove only their command, preserving existing error codes.
  Late replies cannot convert a timed-out command to success.
- Stop rejects pending display commands and separately drains the owned `EXIT`
  handshake. New commands are blocked until teardown finishes. Dispose is
  terminal and also joins preparation so no host appears after it completes.
- The stream listeners detach on retirement; the owned error consumer remains
  until `close`, covering Node error/exit ordering, then all owned listeners leave.
- Failed termination prevents replacement. Explicit stop may retry the same
  owner; an actual exit/close of that owner also proves safe recovery. An event
  from another former child cannot clear or impose this fence.
- No preview cleanup cancels a started journal, RPC ACK or other business commit.

## Compatibility and packaging

Version 38, endpoints, opaque result IDs, Base64 path encoding, tab/newline framing,
Office/folder behavior and 400/410/503 HTTP mapping remain unchanged. The C# host
source, provider behavior, stored preferences and installation pointers retain
their formats. Existing native error codes remain; `NATIVE_PREVIEW_STOP_FAILED`
reports the bounded termination path that cannot certify a stopped process.

The installer stages both native modules with the server. The import-graph test
continues to require every static dependency before activation. Rollback uses a
complete previous versioned runtime; do not copy only the new server file.

## Verification and limits

- Controlled startup, delayed frames/events, readiness, timeout, write failure,
  live exit, disposal during preparation, cleanup failure/recovery and 100
  stop/start cycles. No arbitrary sleep authorizes a command or replacement.
- Real Node child processes and pipes: 25 concurrent UTF-8 commands, actual death
  and explicit restart, classified timeout and graceful cleanup.
- Strict checkJs of the actual session body and negative consumers: protocol
  scalars, numeric deadlines, child streams and asynchronous termination evidence.
  The Node platform adapter is linted/tested; its whole body is not yet typed.
- The real C# host compiled in an isolated directory passed local Windows
  `PING`/20 concurrent `HIDE` requests, graceful stop, restart and terminal disposal.
  The mandatory Windows CI startup test repeats this against staged modules and
  the reviewed private Node runtime, with no operator file, dialog or preview
  window opened.
- Full branch CI retains Browser/IndexedDB, PostgreSQL, owner change, offline/PWA,
  Morning, multitab and two-browser-device gates. Physical multi-computer and live
  Office/provider workflows remain separate operational verification.

This completes native process/session ownership. Document text/binary preview,
cache/index ownership, Bank server decomposition and other capability boundaries
remain separate focused work.
