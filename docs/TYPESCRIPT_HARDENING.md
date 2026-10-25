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
