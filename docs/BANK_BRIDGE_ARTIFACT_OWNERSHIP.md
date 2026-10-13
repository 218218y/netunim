# Bank Bridge status and diagnostic artifact ownership

This stage starts at `864cf82f7634596cc7303fe245e77cc1fe827af6`. It completes
the four status/diagnostic namespaces that remained in the server composition,
and joins rotating credit-log reads with its existing append obligations.

## Reproduced failures

Tests first exercised the actual starting server functions against native
temporary files. Four regressions failed before changes:

- A failed Bank status write had already truncated the previous complete
  `status.json`; a later read silently fell back to empty status.
- Bank diagnostic promotion failure left its attempted temporary document.
- Credit data diagnostic promotion failure left its attempted temporary document.
- An accepted credit-log summary read remained active after `drain()` returned.

After extraction, fixtures call the actual capabilities directly. The temporary
source/VM baseline harness is removed. These regressions now pass, along with
held publication, clear ordering, detached inputs, failure recovery, native
shutdown and historical-reader checks.

## Responsibilities

| Module | Responsibility | Public API |
| --- | --- | --- |
| `json-artifact-owner.mjs` | Strictly checked JSON command capture, FIFO read/update/write/clear completion | `read`, `write`, `update`, `clear`, `drain` |
| `bridge-artifacts.mjs` | Native filesystem publication for four fixed namespaces; historical defaults/readers | `bankMeta`, `creditMeta`, `bankDiagnostic`, `creditData`, `drain` |
| `credit-diagnostic-model.mjs` | Canonical safe event/response projection, fingerprints and log policy constants | Existing policy exports |
| `credit-diagnostic-log.mjs` | Native append/prune/rotate/summary resource ownership | Existing `record`, `summary`, `drain`, `logPath` |
| `credit-diagnostics.mjs` | Stable public export facade | Existing exports |

Metadata facades expose reads and patches; Credit metadata also supports reset.
Diagnostic facades expose reads, replacement and clear. File paths, token/vault
authority and provider identities are not exposed. Constructors start no I/O.
Each fixed namespace has its own serial owner, so a held diagnostic operation
does not block unrelated status files or images.

Patches are detached at acceptance, then merged with the latest queued file
state. Undefined fields still disappear during final JSON serialization. Existing
unknown fields and special own JSON keys such as `__proto__` remain data. Document
replacement captures its serialized bytes before entering the file queue.

## Publication and shutdown

Publication writes a unique temporary file beside the destination, then renames
it over the final file. A rejected write or promotion retains the previous final
bytes. The writer attempts to remove its own temporary file in `finally`, joining
cleanup while preserving the original error. Temporary names include a random
UUID rather than relying on millisecond timestamps.

Status and diagnostic reads share their namespace's queue. They cannot observe
partial status bytes or race an older publication against an accepted clear.
Clearing the current and historical Bank diagnostic joins both removals before
reporting failure. Queue failures do not poison later commands.

Credit append, rotation, pruning and summary reads now share one file owner.
An accepted summary owns its snapshot before a later record may rotate the log.
Its limit is captured at acceptance, preserving the original async query semantics
even when a caller changes its options while an earlier read holds the queue.
The existing record-error swallowing policy and summary error classification are
preserved. Shutdown closes admission and drains accepted provider/configuration
commands, then joins metadata/diagnostic owners, images and credit-log work before
closing the listener and exiting. Disconnected readers retain their file job.

Renaming provides per-file publication, not fsync-backed power-loss durability
or a multi-file transaction. Ownership is scoped to one Bridge process; it is not
a cross-process file lock. Cleanup is best effort if the filesystem refuses
deletion. Crash recovery of abandoned old temporary files is outside this stage.

## Compatibility and evidence

Final filenames, JSON schemas, indentation, mode requests, defaults, unknown
fields, falsey diagnostic no-op writes and current-before-historical Bank reader
priority are preserved. Metadata still uses its historical fallback for all
read/parse errors; diagnostic readers fall back only on ENOENT, and malformed or
inaccessible current diagnostics remain errors. The deployed historical reader
is retained.

Frozen function AST fixtures protect the starting diagnostic sanitization,
fingerprints, retention, rotation and append policies. Mutation tests reject
changes to safe raw-key bounds and log pruning. Existing provider/session/read
and HTTP fixtures remain unchanged. The schema/privacy projection has one
canonical implementation; provider policy consumers import that model directly.

Strict `checkJs` checks the actual JSON owner, invalid consumers and a deliberate
implementation mistake that substitutes presentation text for publication
completion. Persisted reads remain `unknown` until a consumer validates them;
this stage does not claim full typing of all metadata/provider payloads.

Native staged-server tests hold Bank artifact reads and Credit log summaries,
disconnect the HTTP client and request shutdown. The listener must remain visible,
new work must be refused, and accepted reads must complete before normal process
exit. The required Windows gate runs these cases alongside DPAPI, provider/image
shutdown, file publication faults and installer rollback. Packaging validation
now follows both imports and re-exports before staged startup.

Remaining work includes larger issuer adapters, token/CLI process boundaries,
Document search/scheduled maintenance and the broader controller/compatibility
roadmap. Live provider and physical two-device checks remain separate validation.
