# Current architecture backlog

This is the single current backlog, verified against main on 2026-10-15.
[Completion stages](COMPLETION_STAGES_20261015.md) and the focused design notes
are historical implementation/evidence records, not competing remaining-work lists.
A passed synthetic gate is not evidence of live providers or physical machines.

## Completed foundations

- Main/Shared V2 is the only business writer. Historical readers remain intentional.
- Kupa persistence separates local commit, publication, file mirror and adoption.
- Both Main sync coordinators separate save/adoption, flights, ACK, polling and recovery.
- Calendar connection/session, persisted records, transactions, projection and editor payloads have owners.
- Finance refresh, manual edit commands, lease RPC authority and paired archive reads have owners.
- Morning completion, recovery, catalog, command form and media/modal lifetime have dedicated boundaries.
- Backup browser resources and account-scoped publication have owners.
- Spreadsheet RPC replies are decoded and fenced by login epoch before durable ACK.
- Document Bridge document/preview commands and status/HTTP/CLI/shutdown have owners.
  Accepted file operations and preview siblings drain before shutdown settles.
  See [document lifecycle](DOCUMENT_OPERATIONS_LIFECYCLE.md).
- A [compatibility inventory](COMPATIBILITY_INVENTORY.md) distinguishes current APIs,
  historical readers, immutable migrations, generated sources and proven dead code.
- Document Bridge PDF index and Everything search now have composition owners.
  See [index coordinators](DOCUMENT_INDEX_COORDINATORS.md).
- Document Bridge search/registry, Everything sessions/processes, PDF maintenance,
  extraction, runtime files, inventory reconciliation and diagnostics have owners.
- Startup has native timing/graph budgets; document viewers load lazily into private mounts.
- Restore/import now validate source ACKs, revisions and paired persisted
  boundary phases/transitions before authority; malformed durable work remains locked.
  See [transaction evidence](STORAGE_BOUNDARY_EVIDENCE.md).
- Orders persistence now composes local admission/commit and debounced publication.
  Each save captures its own IDB receipt; local drain survives publication cancellation.
  Offline/reload access is supplied by a platform port. See [Orders persistence](ORDERS_PERSISTENCE_OWNERS.md).

- Owner transfer now decodes persisted handoffs and transition replies, retains frozen source/target proofs across restart and projects detached replies before view installation. Its actual body is strict checked; see [owner transfer evidence](OWNER_TRANSFER_EVIDENCE.md).

- Both lifecycle shells now use a checked startup-admission owner for transfer/birth policy and fence late journal/display activation by owner and leadership. Browser connectivity is explicit. See [shell admission](SHELL_STARTUP_ADMISSION.md).

## Prioritized remaining work

| Priority | Scope | Required evidence |
| --- | --- | --- |
| 1 | Critical persisted/journal transaction consumers: remaining IDB/runtime callers and durable owner binding; full strict bodies beyond the checked restore/import/owner-transfer consumers | Decode unknown values before action/ACK; preserve invalid durable records; checked implementation, negative consumer and implementation mutation |
| 2 | Continue shell composition audit only where new policy is proved | Startup transfer/birth admission and owner/leadership fences are now owned; broad role wiring is intentional. Preserve these boundaries when adding features |
| 3 | Measured startup improvements | Repeated cold/cached/offline measurements; presentation-only lazy candidates; account/cancellation/PWA gates; preserve eager runtime ownership |
| 4 | Compatibility inventory and readability | Maintain the completed compatibility inventory; retire only newly proven Dead paths; format remaining application presentation boundaries in reviewable slices |
| 5 | Release validation | Full PostgreSQL/native browser/Windows gates plus controlled backup/restore, physical two-computer and live Bank/Credit drills |

The six unchecked storage modules called out by the V7 review are a work queue,
not a demand to annotate all application code. Prioritize where runtime evidence
permits a transaction, local replacement, ACK or publication. Strict checking of
isolated declarations without checking their implementation does not close a boundary.

Composition roots may remain broad where they only wire focused capabilities.
Do not reopen completed Kupa persistence, Main sync decomposition, Finance refresh,
Calendar decoding or Backup ownership solely to reduce file or argument counts.

Generated copies under the sites are intentional. REST/function API versions,
immutable deployed SQL and historical backup readers are not obsolete V1 writers.
No compatibility path is deleted without consumer and retained-data evidence.
