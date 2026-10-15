# Everything session and readiness lifetime

The Document Bridge now delegates readiness, preferred/fallback IPC probing,
cached probes and coalesced startup to a strict five-port session: configuration,
executable discovery, process commands, clock/wait and audit. Private cache and
probe/start flights no longer belong to the HTTP server. Search's single exit-8
reprobe invalidates this owner explicitly; its original transport function still
matches the immutable policy after that one ownership binding is expanded.

The existing fast `Promise.any` winner remains fast. A native child fixture proves
that a losing probe may still be alive after both the original and current calls
return. The new session independently tracks each accepted process read, so server
shutdown seals new probing and joins losing children too. It also joins accepted
configuration writes. Disposal during config/discovery/launch logging prevents a
later process launch or cache/config publication. It does not stop an installed
Everything application that it previously started.

Before editing production, the original declarations were recorded. Executed
old/current comparisons cover 96 preferred/fallback/version/auto-start/fresh
scenarios, exact cache expiration, overlapping fresh probes, explicit invalidation
and the 15-second startup polling limit. IPC arguments, timeouts, launch flags,
configuration updates and diagnostic messages match. All-exit-8 failures alone
may auto-start; other failures and `autoStart:false` do not launch.

Strict implementation/negative consumers reject malformed process text, invented
timestamps and shutdown without drain. Launch now awaits the process owner's
spawn acknowledgement or failure. Native process
fixtures and the existing authenticated HTTP/search/inventory/maintenance suites
protect the server wiring. The Windows installer stages the new static dependency.
Executable discovery and general ES transport/platform ownership are now separate
strict owners; see [discovery and processes](EVERYTHING_DISCOVERY_PROCESS.md).
This does not certify a live installed Everything session.
