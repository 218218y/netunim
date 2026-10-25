# Focused JavaScript contract hardening

The canonical product remains JavaScript ESM. The strict project checks real
implementations with JSDoc, `checkJs`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. A passing compiler is not business acceptance.

## Baseline — 2026-10-25, `5a5c7c2e`

The TS 6.0.3 compiler program, not only its root list, was inspected using
`parseJsonConfigFileContent`, `createProgram` and `getSourceFiles`.

| Coverage | Count |
| --- | ---: |
| Explicit roots | 295 |
| Product roots | 182 |
| Consumer fixtures | 113 |
| Loaded JS/MJS sources including generated copies and fixtures | 384 |
| Bridge files carrying `@ts-nocheck`, including unloaded files | 27 |

The existing typecheck and offline inventory check passed. One local Windows
`npm run typecheck` took 9.24 seconds; this is a single sample, not a CI estimate.
The existing Compiler API mutation suites are retained.

| Critical boundary | Baseline status |
| --- | --- |
| Storage operation/checkpoint/base/flight/control readers and writers | Explicit |
| Journal authority, cloud ACK and recovery decisions | Explicit |
| Storage V2 restore, local import and owner transfer | Explicit |
| Journal model, IDB implementation, journal coordinator and V2 runtime | Unchecked |
| Both cloud transports, sync document coordinators and `cloud-sync.js` | Unchecked |
| Credit/profile/provider models and the four financial calculation modules | Unchecked; some Bridge dependencies explicitly excluded |

The shared schema and some Bridge codecs were already checked indirectly.
Generated app copies are not additional canonical modules.

## Journal transactions and replay

The actual `storage-journal-idb.js`, `storage-journal-model.js` and
`storage-metrics.js` join the explicit strict roots. The IDB transaction callbacks
carry the completed result type through to the asynchronous receipt. Checkpoints,
operations, bases, flights and controls reuse their existing record contracts.
Raw envelopes retain unknown payloads until their record reader validates them.
Account adoption requires both Main and Shared Checks and their revisions.

Runtime changes are limited to rejecting corrupt persisted metadata/object/row
shapes before granting authority. In particular, a boolean persisted sequence
could previously participate in numeric coercion (`true + 1 === 2`) in append.
A real IndexedDB regression corrupts that value and proves load/append reject it
without adding a journal row. Invalid collection rows now fail with an explicit
corruption error. No valid journal format, schema version or calculation changes.

Negative consumers cover nonnumeric sequences, wrong owner/epoch types, missing
Shared Checks, a checkpoint or local commit used as an ACK, and premature
synchronous success. Implementation mutations replace transaction results with
text or unfinished promises and replay sequences with strings.

The named IDB function contracts live in a type-only declaration file and annotate
the actual JavaScript function bodies with `@type`. The same implementation
mutations remain required: declarations do not substitute for body checking.
This avoids transferring repeated long signatures in the eager browser graph.
Measured source sizes are 1,822,619 bytes (Kupa) and 2,446,242 bytes (Orders).
The source budgets increase by 4,000/8,000 bytes respectively to account for
the remaining annotations and corruption decoders; module counts and all timing
budgets are unchanged. A native regression also completes all boundary phases
and verifies the compact completion marker.

Remaining priority: the journal/V2 coordinators, cloud transport implementations,
canonical financial models, then selected financial calculations. Existing
authority/read/ACK contracts should be extended, not duplicated. TypeScript 7
compatibility is evaluated independently of these changes.

## Shared cloud request policy

The actual `cloud-sync.js` implementation is now checked. Outbox generation,
mutation sequence, retry metadata and normalized error kinds have explicit
contracts. Migrating or cloning a snapshot retains `unknown` provenance; it does
not turn persisted or remote content into a validated application document.

The coalescing scheduler carries one result type across its queue and cache, so
tasks sharing a scheduler cannot return incompatible response types. Busy retries
preserve the asynchronous result type. Existing classification and retry behavior
are retained; a malformed non-callable `headers.get` is treated as absent metadata.
Mutation tests exercise the real counters, classification and queue completion.
The long signatures are kept in `cloud-policy.d.ts` while the actual generic
scheduler functions retain checked JSDoc parameters and callback bodies. The
eager graph adds 2,741 source bytes with no additional module. Measured totals
are 1,825,360/2,448,983 bytes; each source budget increases by 2,000 bytes. Timing
budgets and all behavioral acceptance suites are retained.

The two large cloud transports and document coordinators remain outside the strict
roots. An initial combined probe produced 454 diagnostics, including broad
validation/restore dependencies and old generated shared copies. This is a scope
boundary, not a claim of 454 business bugs. Their existing runtime and response
reader tests remain mandatory in CI.

## Canonical Bridge financial models

Four actual models now use `@ts-check` and join the strict roots: credit
transactions, credit profiles, Hapoalim cheque normalization and Hapoalim credit
settlements. Bridge exclusions decrease from 27 to 23. The canonical shared
transaction guard supplies its existing validated pending/completed and issuer
amount-status evidence to both browser and Bridge copies.

Normalized amounts remain `number | null`; missing money cannot silently become
zero at a checked consumer. Installments, provider identities, account identities,
coverage states, cheque records and card suffix lists have checked result types.
Unvalidated date/observation metadata deliberately remains unknown. Provider login,
scheduler, cooldown and anti-blocking policy are unchanged.

The small equivalent normalization rewrites were compared against `5b2598ba` in
288 input/output/error cases. Existing runtime producer-guard mutations remain
active. Historical AST policy fixtures are preserved; a separate explicit
before/after allowlist covers only reviewed changed declarations and new guards.
Policy mutation tests compare against the current implementation digest, so an
old baseline difference cannot make a mutant pass trivially. Compiler mutations
independently check returned amounts, statuses, installment counts and cheque
amounts. Startup/module/time budgets do not change in this stage.

## Credit billing and historical account calculations

The actual `credit-billing-cycles.js` and `credit-card-account.js` implementations
join the strict roots. A discriminated amount result separates included issuer
money, an ILS pending estimate, unconverted foreign money and an unknown amount.
Excluded/unknown amounts cannot acquire an included success flag in a checked
implementation. Cycle status, horizon totals, incomplete coverage, historical
account transitions and issuer-balance fallback results also have contracts.

Historical application records remain distinct from raw Bridge/network evidence.
The calculations retain their existing runtime normalization and admission rules.
Typed nonempty groups and explicit selections replace unchecked indexed access;
they do not invent transactions, billing dates, amounts or coverage. Long function
signatures stay in a type-only file and contextualize the actual JS bodies.

The changes matched the previous implementation in 854 input/output/error cases,
including missing/zero/signed amounts, currencies, billing horizons, invalid dates
and account-history transitions. The 67 focused billing/sign/temporal tests pass.
Compiler mutations exercise unknown-to-included promotion, a pending estimate
presented as final, string amounts and invalid account roles.

This stage adds 4,582 eager source bytes and no runtime modules. Measured totals
are 1,830,357/2,453,980 bytes. Source budgets increase by 6,000 bytes each; all
module and timing limits remain. The wider `kupa-cashflow.js` and recurring-bank
calculations remain outside the strict roots; their existing business tests stay
in full verification. See `TYPESCRIPT7_COMPATIBILITY.md` for the separate compiler
assessment and its explicit untested platform gates.

## Journal coordinator and cloud publication receipts

The actual `storage-journal.js` coordinator now joins the strict roots, after an
isolated probe found 227 diagnostics within that module. The type-only method
contracts contextualize every real function body; generic queue helpers retain
their own checked parameters and result inference. An append admission includes
`committed: Promise<boolean>`, while a cloud ACK carries its operation ID,
revision and acknowledged sequence. Neither receipt substitutes for the other.
Validation, projection and scope callbacks must complete synchronously.

Recovery explicitly distinguishes an absent checkpoint from an owned durable
snapshot. Internal write paths require a recovered checkpoint rather than
dereferencing a nullable recovery result. A missing checkpoint fails before any
write. Collection identities must be nonempty strings before a replacement can
derive deletion authority. Native IDB authority, transaction completion, detached
commands and recovery tests pass; two new behavioral regressions verify these
failure paths leave durable data unchanged. The focused coordinator/recovery/
authority suites contain 231 passing tests.

Emergency envelopes remain JSON-decoded and checksum-checked at runtime. Only
current-epoch operations undergo the current operation-schema validation; stale
epochs remain available for diagnostics without being replayed across a restore.
Existing immutable flights remain readable without allocating a new operation ID.
The four compiler tests include mutations of actual append completion, ACK
sequence and admission sequence, plus positive and negative public consumers.

The eager graphs add 5,175 source bytes and no modules. Measured totals are
1,835,532/2,459,155 bytes; source budgets increase by 6,000 bytes each. Module and
timing limits remain unchanged. The V2 runtime coordinator, application cloud
transports and document coordinators still require further focused work; adding
them as roots is not implied by checking this Journal implementation.

## Durable IndexedDB completion

Native Windows crash tests exposed intermittent disappearance of the isolated
paired-restore database after an intentional hard process kill. Journal and
owner write transactions previously used the browser's default durability hint.
All journal, boundary, owner binding, cutover, local-birth and fenced-adoption
read/write transactions now explicitly request `durability: 'strict'`. Read-only
transactions and the existing transaction-complete/abort receipt rules remain.
No database version, persisted record or business calculation changes.

The [IndexedDB specification](https://w3c.github.io/IndexedDB/#transaction-durability-hint)
distinguishes persistent-medium verification from the default browser policy.
Strict durability is a browser hint, not a guarantee against every storage or
hardware failure. The observed database corruption does not by itself prove the
cause; the missing durability request is a concrete gap in the intended crash
contract. Stronger commits can cost I/O time, so existing performance acceptance
remains mandatory without increasing limits.

The native authority test inspects actual transaction durability across more than
100 journal/boundary/owner writes, retaining request-success/abort regressions.
The existing real hard-process-kill tests remain unchanged and mandatory in CI.
The focused connection/owner/startup suites pass 24 tests. This change adds 154
eager source bytes per app, no modules and no budget changes.

## Bank recurring debit and credit forecasts

The actual `bank-recurring-debits.js` implementation now joins the strict roots;
the isolated baseline probe reported 31 diagnostics without expanding into new
unchecked dependencies. Forecast rows have numeric amounts, a literal estimated
flag and a distinct `bank_recurring` source. An obligation without a bank seed
retains nullable money. Retained source rows reuse `BankIdentityRow`; their
unvalidated identity and description fields remain unknown. These declarations
do not turn arbitrary historical rows into validated bank transactions.

Existing runtime date, amount, status, currency, presence and coverage checks
continue to gate admission. The existing month advancement calculation is reused
directly for the next due month rather than indexing a generated calendar. The
changes matched the prior implementation in 2,616 input/output/error cases,
including missing/zero/coercible amounts, credits/debits, ambiguous sources,
coverage corrections and year rollover. Forty behavior/identity/source tests and
three startup tests pass. Five compiler tests include real implementation
mutations that attempt to finalize an estimate, change its source, remove its
numeric amount or replace absent obligation money with text.

This stage adds 1,510 eager source bytes and no modules. Measured totals are
1,837,196/2,460,819 bytes and fit the current source budgets; no budget changes
are needed. The larger cashflow reconciler and V2/application transport
coordinators remain outside the strict roots. All prior negative consumers,
mutation checks and browser/database acceptance suites are retained.

At this stage the strict configuration has 313 explicit roots: 194 product
modules and 119 consumer fixtures. The compiler loads 402 JS/MJS sources in total
(including dependencies and fixtures); 23 Bridge files still use `@ts-nocheck`.
These categories are distinct and do not imply full application coverage.

## Orders document admission and debt progress

The actual shared entity-invariant and customer-debt implementations, together
with Orders document validation, now join the strict roots. External document
input remains unknown until the existing runtime guards accept its required
arrays, canonical unique IDs, workbook parents and debt-progress evidence.
The admitted document type specifies only proven shape and identities; arbitrary
debt amounts and other row metadata remain unknown. Retained debt calculations
have numeric balances, boolean completion flags and explicit payment/invoice
domains. Existing legacy rounding and coercion behavior is preserved.

Raw array elements remain unknown while runtime object/field guards inspect
them. Record assertions occur after the corresponding object/collection checks;
they do not replace validation with a declaration or certify raw JSON as storage
data. The actual validator and calculation bodies remain compiler-checked.

The changes matched the previous code in 1,704 input/output/error cases, including
canonical/duplicate IDs, missing and signed money, reset events and malformed
document shapes. Sixty-three focused behavior/startup tests and five compiler
tests pass. Runtime mutations independently remove document, duplicate-ID and
debt-kind guards and demonstrate the invalid data those guards prevent.

The eager graph adds 2,079 bytes in Kupa and 2,923 in Orders, without additional
modules. Totals are 1,839,275/2,463,742 source bytes; each source budget increases
by 4,000 bytes. Timing and module budgets are unchanged. Current strict coverage
is 317 roots: 197 product modules and 120 fixtures, with 408 loaded JS/MJS files.
The large transport implementations are still outside these roots; this stage
hardens their document-admission dependencies without claiming full transport
coverage.

## Restore group storage and remote completion

The actual restore-group constructor, durable store and executor now join the
strict roots. Created groups have numeric revisions/sequences, while historical
records retain unknown-valued fields where the old runtime guard accepts
coercible evidence. Validation does not silently normalize those records or
declare their raw values numeric. Stored identities additionally pass the
existing string key boundary before they are exposed as durable groups.

Raw store reads remain unknown, are reconciled with the local copy, then pass the
existing group/phase/target validation. Server-pending identities continue through
their canonical response reader and account scope. The generic executor carries
the actual remote result through its awaited apply/adoption/completion stages.
No record version, key, hash algorithm, phase ordering or RPC protocol changes.

The changes matched the previous implementation in 181 validation, constructor,
storage and executor comparisons. Forty-one focused behavior/startup tests and
five compiler tests pass. Actual-body mutations remove an awaited remote result,
fabricate a durable receipt or replace decoded data. New asynchronous regressions
hold both remote completion and local adoption, proving the group cannot complete
early; malformed retained records remain available instead of being overwritten.

The eager graph adds 3,244 source bytes per app and no modules. Totals including the
separate strict-durability repair are 1,842,519/2,466,986 bytes. Each source budget
increases by 4,000 bytes, retaining timing and module limits. Large application
transports and sync coordinators still need their own focused implementation
checking; these dependencies no longer require an unchecked restore store.
