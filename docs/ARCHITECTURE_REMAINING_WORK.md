# Current architecture backlog

This is the single current backlog, updated against the 2026-10-18 continuation.
[Completion stages](COMPLETION_STAGES_20261015.md) and the focused design notes
are historical implementation/evidence records, not competing remaining-work lists.
A passed synthetic gate is not evidence of live providers or physical machines.
On 2026-10-18 the operator confirmed there is no separate Bridge/test-account
environment, only the working-data connection. Installed interruption, destructive
restore and live-provider release exercises therefore remain explicitly unverified.

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

- Global search presentation now loads on first use behind a checked cancellation/account lifetime; repeated startup samples and tighter eager budgets accompany native offline first-use evidence. See [deferred search](LAZY_SEARCH_LOADING.md).

- Durable owner-binding authority now has a checked implementation with decoded binding/handoff pairs, cache-before-publication and failure revocation. Invalid completed records stay locked; verified refresh permits recovery. See [binding authority](STORAGE_OWNER_BINDING_AUTHORITY.md).

- Owner-store reads and writes now have a checked transaction body: atomic binding/handoff snapshots, captured generation comparisons against ABA and receipts only after transaction completion. See [owner transactions](STORAGE_OWNER_TRANSACTIONS.md).

- All checkpoint writers now capture decoded commands before awaiting IDB. Journal retirement proves sealed row/physical-key agreement and retains mismatched evidence. See [checkpoint retirement](CHECKPOINT_RETIREMENT_AUTHORITY.md).

## Prioritized remaining work

### Final quality continuation after PR #244, 2026-10-18

The Bank UI range/boundary filters now use the canonical calendar predicate.
The application action packs return delegated completion, and both event roots
observe escaped Promise rejections without duplicating domain-owned notices or
changing persistence receipts. See [UI completion evidence](UI_ACTION_COMPLETION.md).
The focused orchestration audit also reproduced mutable runtime command inputs
while earlier commits drain. These entrances now capture before waiting and
recheck cloud boundary admission; see [runtime command evidence](STORAGE_RUNTIME_COMMAND_ADMISSION.md).
Further work follows the review's order: demonstrated authority gaps, loaded-data
measurement, deterministic feature-entry enforcement and a dated release evidence
report. Physical machines, installed Bridge and live providers remain unverified;
the sections below are completed evidence, not another active plan.

Workbook connection lifecycle now uses the existing factory with bounded
reopening, explicit upgrade blocking and atomic abort handling. Its reentrant
browser bindings release every listener on disposal while retaining accepted
sync work and drafts. See [workbook lifecycle](SPREADSHEET_LIFECYCLE.md).

Main/Shared journal, workbook and boundary/bootstrap/birth transactions now share
a strict completion body. Transition evidence reads also wait for transaction
complete; native abort after request success grants no receipt and preserves
prior state. See [durable receipts](IDB_DURABLE_RECEIPTS.md). Full journal/runtime
strict conversion remains selective rather than implied by this boundary.

Mixed-release module responses were reproduced in both worker bodies. Generated
release response headers now fence network/cache adoption; updates wait for old
tabs to close. Every site upload is followed by critical-asset smoke before the
pair continues. See [paired rollout and recovery](DEPLOYMENT_COMPATIBILITY.md),
including the first protected-release adoption limit and per-project recovery.

The actual workbook store is strict checked and captures commit/draft inputs
before IDB awaits. Emergency writes cannot ACK absent storage. Raw historical
reads remain unknown until model/sync validation. See
[workbook store contracts](WORKBOOK_STORE_CONTRACTS.md).

### Four-stage review continuation, 2026-10-18

1. **Bank calendar and monetary integrity:** reproduced impossible Morning dates
   and zero coercion in both historical feed readers. Feed dates now use the
   existing exact calendar/timestamp predicates. Morning retains processing-date
   precedence and local timestamp days. Unknown money remains `null`, distinct
   from numeric zero; missing balances cannot create a feed. No stored history is
   rewritten. Date helpers extend the existing time module, adding no startup
   request. Kupa eager source measures 1,757,880 bytes; its source-only allowance
   increases by 2 KB (0.12%) for the validation code, with the 302-module and
   browser timing limits retained. Focused regression cases cover leap years, three time zones,
   malformed inputs and snapshot coverage. Full branch CI is required to merge.
2. **Domain ownership:** the unchanged Morning bank catalogue now belongs to
   Orders core. Finance no longer imports Customers. Kupa search receives Credit,
   Bank and Cash read capabilities from composition; it imports no sibling domain.
   Module graph rules enforce both boundaries. Existing search, incremental-index
   and Morning regressions plus a read-capability isolation case pass locally.
   The single new composition costs one eager module (303 total) and 1,090 bytes;
   the existing 1,759,000-byte and browser timing limits remain in force.
3. **Authority contracts:** reproduced impossible snapshot timestamps rolling
   forward and impossible/reversed full coverage reaching both archive RPCs.
   Both transports now capture one checked immutable command in the existing
   transaction-evidence owner before I/O. Existing merge keys and partial-warning
   semantics are unchanged. Invalid money/status/scope/calendar data sends no
   request; stale accounts and malformed receipts cannot publish success. Strict
   negative consumers and a real-guard mutation prove the boundary. Morning's
   direct prefill/eligibility entrance also uses the existing monetary reader:
   boolean/array/object coercion cannot invent a positive receipt amount. Kupa
   eager source measures 1,760,222 bytes: a 2 KB source-only allowance covers the added
   command guard, with 303 modules and browser timing limits unchanged.
4. **Readability:** expanded both transports, Kupa search/Credit presentation and
   Orders Inventory/Checks editors. Their 70 lines above 500 characters and 19
   above 1,000 are now zero; canonical totals decrease from 483/113 to 413/94.
   Parsed program equivalence preserves every cooked string, interpolation and
   evaluation order; source/AST hashes and per-file metrics are recorded in
   [readability evidence](evidence/readability-20261018.json). The six per-file
   ratchets now reject new long lines. No runtime module was added. Formatting
   costs 4,852 eager Kupa bytes (1,765,074 total); the source-only allowance rises
   by 5 KB while all module-count and browser timing limits remain intact.
   Orders remains inside its existing 2,379,000-byte eager source allowance.

The 2026-10-18 continuation also closes Kupa credential resurrection after a failed
IndexedDB logout delete, orders credential mirror writes and scopes refresh flights
to their login. See [credential authority](KUPA_AUTH_SESSION_AUTHORITY.md).

Directory/file/remembered-source opening and backup-target replacement now prepare
detached candidates before committing active references. See
[local source transitions](KUPA_LOCAL_SOURCE_TRANSITIONS.md).

All public filenames, including root files outside the generated shell and the
captured Git index, now share [distribution hygiene gates](PUBLIC_ASSET_HYGIENE.md).
The previously reported duplicate worker is already absent from this checkout.
The [feature entry contract](FEATURE_ENTRY_CONTRACT.md) records how new commands
enter existing owners/capabilities without introducing parallel business writers.

All three Bank authority migrations (`20261016120000`, `20261016130000` and
`20261016140000`) are installed. The complete authenticated read-only
[2026-10-18 Production postflight](PRODUCTION_POSTFLIGHT_20261018.md) verified all
41 migration identities/SQL hashes, active application schema/functions/security
and operational settings. The hash-bound receipt was refreshed; no migration was
reapplied. This dated observation does not replace fresh rollout verification.

Current journal append/bootstrap/import writers now enforce captured operation
schemas at IDB authority; see JOURNAL_BUSINESS_AUTHORITY.md. Main/Shared/Finance
REST revisions and backup candidates now have explicit read decoders; see
CLOUD_READ_AUTHORITY.md. CPU startup profiles and the presentation ratchet are
documented in STARTUP_CPU_MEASUREMENT.md and READABILITY_RATCHET.md.

| Priority | Scope | Required evidence |
| --- | --- | --- |
| 1 | Physical release validation and loaded startup measurements | Use the operator matrix for weak Windows hardware, installed Bridge update/shutdown, controlled interruption, old backups, A-B-A, two physical clients and live Bank/Credit providers after Credit schema hardening. CI covers isolated PostgreSQL/native browser/Windows contracts |
| 2 | Fresh verification before each static rollout | All three Bank migration identities, complete SQL hashes and live schema checks remain required. The full 2026-10-18 postflight and Git CI do not replace the next rollout gate |
| 3 | Further authority work only on demonstrated gaps | Current Credit replacement coverage and normalized/raw monetary admissions are checked; Journal has eleven checked durable decisions and native rejection/mutation evidence. Extend remaining orchestration only when code or runtime evidence justifies it |
| 4 | Compatibility inventory and readability | Keep the count/max ratchet and improve touched code; retire only newly proven Dead paths |

Current continuation evidence: [Credit coverage and producer](CREDIT_COVERAGE_AUTHORITY.md),
[Bank observation admission](BANK_OBSERVATION_AUTHORITY_20261018.md),
[Retained Bank cashflow clocks](BANK_HISTORICAL_CASHFLOW_20261018.md),
[Full Production postflight](PRODUCTION_POSTFLIGHT_20261018.md),
[Staged asset verification and measured Git reads](STAGED_ASSET_VERIFICATION_20261018.md),
[Temporal observation, cooldown and scheduler closure](TEMPORAL_AUTHORITY_20261016.md),
[Credit account identity and mutation closure](CREDIT_ACCOUNT_AUTHORITY_20261016.md),
[Journal replacement decisions](JOURNAL_REPLACEMENT_DECISIONS.md),
[nested Bank SQL authority](BANK_BUSINESS_SQL_AUTHORITY.md). Architectural
decomposition and additional lazy loading remain paused pending a concrete defect
or comparable physical measurement. Broad role wiring is intentional.

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
