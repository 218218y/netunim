# Document Bridge runtime boundaries

Six responsibilities now have explicit owners outside `server.mjs`:

- `bridge-runtime-files.mjs`: application data paths, local configuration,
  token identity, JSON/log files and the pinned private Node executable check.
  Construction allocates no file or process work; native I/O is substitutable.
- `pdf-maintenance-task-diagnostics.mjs`: Task Scheduler inspection, action/path
  validation and diagnostic labels. Expected paths remain environment values,
  with hidden, bounded PowerShell execution.
- `bridge-installation-diagnostics.mjs`: strict doctor and installation report.
  Pre-activation task tolerance never suppresses failed Everything diagnostics.
- `pdf-inventory-reconciliation.mjs`: full/incremental reconciliation, retry
  candidates and the derived-index removal guard. Only a verified full inventory
  can remove entries. Accepted append completes before late cancellation can
  prevent successful backlog publication.
- `windows-process-control.mjs`: the shared Windows PID/exit/process-tree
  platform consumed by both native preview and installer replacement.
- `bridge-replacement-command.mjs`: installer health/stop client and Windows
  process exit/escalation policy. Its four capability roles carry the token,
  loopback client, process commands and clock/timer/log operations. A foreign
  service, missing token or refused shutdown cannot authorize forced termination.
  Accepted listener shutdown retains the existing 120-second caller deadline.

All 25 extracted decision bodies are characterized against the immutable
`document-runtime-policies.json` baseline. Only reconciliation's clock and
metadata publication port substitutions are normalized. Runtime/token/config,
Task Scheduler, process replacement, doctor, shrink protection, failed retry and
cancellation scenarios exercise the actual owners. Three implementation mutants
prove detection of missing executable identity, task readiness and shrink guards.
The native HTTP test now consumes the real replacement owner and waits for a
held search to drain before port replacement. Existing file/index fault tests
continue to check unchanged bytes and complete replay.

The transactional Windows installer stages all six new modules. Its packaging
test traverses the full static dependency graph, requires these owners and
rejects cycles or missing staged files. ESLint now covers the actual listener
and all new owners, including undefined names and unused bindings.

Normalized UTF-8 listener source decreased from 60,879 to 40,380 bytes (34%),
and top-level function declarations from 81 to 56. A 45,000-byte responsibility
budget and factory capability limits protect this boundary. Remaining listener
code includes composition/start/stop, document/native preview commands and PDF
index projection/encoding. This stage does not claim those remaining policies
were retired or that live provider/physical-machine release checks were run.
