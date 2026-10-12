# Bank Bridge configuration and provider ownership

The Bank Bridge previously allowed independent HTTP handlers to read, modify
and overwrite the same encrypted profile list. Its `scrapeBusy` flag covered
browser scraping alone: profile/credential changes were not excluded, provider
reads happened before acquisition, and metadata publication followed release.

Before-change native HTTP regressions failed for two accepted profile saves
(only one profile survived), reset following a held save (reset ran first and
the older save could restore connections), and profile mutation during an
active provider session (HTTP 200 instead of `SCRAPE_BUSY`, with vault I/O).

## Boundary and ordering

| Owner/boundary | Responsibility |
| --- | --- |
| `operation-owner.mjs` | Private FIFO configuration reservations and fail-fast provider exclusivity; commands retain their result type |
| `connection-commands.mjs` | Seven explicit mutations: save/delete profile, reset profiles, save/delete bank credentials, select account, replace connections |
| `connection-settings.mjs` | Historical credential normalization and versioned import validation; no platform effects |
| `connection-vault.mjs` | Existing encrypted JSON filenames/readers/writers and exact-byte import rollback; inert factory with protection ports |
| `windows-platform.mjs` | Existing hidden process/PowerShell behavior and DPAPI CurrentUser encoding; importing it starts no process |
| HTTP composition | Authentication, request limits, response envelopes, complete status query snapshots, and provider claims from before vault reads through diagnostics/status publication |

Configuration reserves before its first read. Accepted commands execute FIFO,
including cleanup; rejection does not poison later commands. A provider fails
with the existing HTTP 400 / `SCRAPE_BUSY` taxonomy while configuration work is
reserved, and every mutation fails before validation or persistence during a
provider session. Bank and credit sessions remain mutually exclusive. Status
queries queue behind accepted configuration, while remaining available during
provider work. Read-only queries do not claim provider exclusivity; mutations
queued behind a read still reserve it immediately.

Parallel cleanup uses an all-settled barrier before propagating the first
failure. A failed metadata deletion therefore cannot release the owner while
an outstanding vault deletion can still erase a later save. Import retains its
existing per-cleanup warning labels and exact-byte rollback behavior.

## Compatibility and evidence

Bridge version 73, credit contract 2, route aliases, public projections, deployed
vault names, DPAPI scope/encoding, placeholder/provider/identity validation,
password whitespace and leading-zero selectors remain compatible. Provider
retry/fallback, engine-scoped cooldown, identity recovery, error projection and
browser termination algorithms match frozen AST fixtures captured from
`9ea7b6b2215815bb1de8c5837c0c27d9bfc5f8de`, excluding only former flag acquisition
and release. Existing provider response/error model fixtures also remain gates.

Focused tests exercise actual HTTP handlers, native filesystem reads/writes,
injected second-write/protection failure, exact prior ciphertext/absence
rollback, failed reset drainage, concurrent identity/role updates, and public
status projection. Windows runs actual CurrentUser DPAPI on synthetic inputs in
checked disposable directories, locally and in the required Windows CI job.
No installed vault or live provider is used by these fixtures. Installer graph
coverage requires all transitive runtime modules before doctor/activation.
Strict checking covers the actual owner implementation, invalid consumers and
an implementation mutation; ESLint covers the touched Bridge boundaries.

## Remaining work

This is the configuration/vault slice of Bridge decomposition. HTTP routing,
bank-session orchestration, provider adapters and diagnostics still need
separate responsibility reviews. It does not introduce a new persisted format
or a crash-atomic two-vault transaction: the existing replacement rollback is
preserved and fault-tested. Cross-process vault ownership and an installer
replacing a running process are separate boundaries. Synthetic CI does not
prove live issuer behavior or physical two-computer rollout.
