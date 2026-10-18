# Bank integrity follow-up — 18 October 2026

## Source and coverage boundary

The new `bank_source_integrity.test.mjs` reproduced four failures on the original
source: impossible Hapoalim dates rolled forward, missing money became zero,
impossible coverage could invalidate recurring history, and an actual account
read declared complete history despite invalid raw rows. The local-noon positive
control already passed before the fix.

Hapoalim now uses the existing calendar validator before local-noon conversion
and the canonical money reader at the raw transaction boundary. A malformed
amount or date rejects the transaction batch; the account reader retains its
established partial-balance behavior with a diagnostic warning and incomplete
coverage. Numeric zero and numeric strings remain accepted. Per-row missing
balances remain unknown.

Archive coverage and recurring-history absence reconciliation use the same
calendar policy, including warning propagation. Only ordered, real calendar
endpoints with explicit complete coverage may invalidate retained history.

Validation: focused source, account-reader, feed, transaction-evidence, recurring,
Bridge-model and packaging tests passed locally, as did the contract compiler and
focused ESLint. Timezone controls cover UTC, Jerusalem and New York. Only the two
deliberately changed Hapoalim function digests were updated; unrelated reviewed
policies remain pinned.

No live bank or production data was used. Physical two-computer operation,
live provider testing and deployment verification require separate measured
operator evidence.
The archive preservation fixtures now pin the deliberately corrected coverage
algorithm; all other helpers and orchestration snapshots remain unchanged. The
Bridge model import budgets allow only the existing pure calendar/money codecs.

## Identity, projection and multiplicity

`bank_identity_integrity.test.mjs` reproduced four more failures before changes:
both app feeds lost a distinct serial, search IDs collided, and recurring history
collapsed repeated source movements. The archive-key/document-link control
already passed and its key format is retained byte for byte.

The shared identity policy now names source, archive-command, archive-record,
navigation and recurring-history responsibilities separately. The archive still
owns reconciliation and collision rejection. Neither feed reader removes source
rows, including identical occurrences, and stored history is never truncated by
the transport page budget. A count-aware one-to-one history overlay replaces the
former `Map` collapse. Distinct archive IDs remain separate; unknown raw-reference
identity cannot overwrite different financial content. Forecast ambiguity uses
the existing warning policy.

Canonical feed normalization now serves both apps. Kupa re-exports the reader;
Orders keeps Morning handling/document decoration in its adapter. Search uses
archive IDs or source occurrences and the bank table retains original occurrence
positions after display filtering/sorting. Details are in
`shared/bank-transaction-identity.md`.

Local regressions include repeated JSON reloads, source permutation, raw-to-archive
transition, stable document IDs, archive corrections, one-to-one multiplicity and
20,001 retained rows. The unchanged archive key-format test, existing recurring
policies, strict source/evidence, archive-readout and Bridge tests pass locally.

The two canonical policy files add two eager modules per app. Measured working
graphs contain 305 Kupa / 402 Orders eager modules and about 1.774 MB / 2.383 MB
of source. The deterministic budgets permit exactly those two modules and 8 KB
additional source per app (under 0.5%); browser timing ceilings are unchanged.
Bridge structural checks now follow the real canonical feed/identity imports.

## Strict source contracts and integration evidence

The shared feed reader, identity policy and actual Hapoalim transaction producer
are checked by the strict contract compiler. Four deliberate mutations prove
that money cannot become display text, archive keys cannot become booleans and
history evidence cannot become a textual confirmation. The checked consumers
also require explicit handling of nullable historical financial values.

Further source inspection found missing direction/serial fields and missing
transaction arrays could manufacture completed credits or complete empty
history. Hapoalim now rejects these inputs, including sparse batches. Raw date
syntax accepts only numeric/compact or dashed bank calendar dates, with the
existing local-noon conversion. Expanded cheque amounts and document flags also
reject coercible arrays/booleans. Historical optional balances, archive IDs and
Morning document amounts use the canonical scalar boundary. Direct snapshot
coverage must be ordered and its declared count must match an actual array.

The new `bank_identity_pipeline.py` runs inside the existing disposable candidate
database suite. Its input comes from the real Hapoalim normalizer, balance
decoder and archive command. It executes the installed snapshot RPC, replays a
reversed source, checks stable archive IDs, rejects a conflicting batch and
checks unchanged durable archive/snapshot state. The actual Orders/Kupa cloud
transports then decode the SQL output; both feeds undergo repeated JSON reload,
recurring-history overlay, search and cashflow ambiguity checks.

The existing native IndexedDB Bank command test now uses the same generated
two-serial source, checks durable amounts and isolation from Shared Checks,
reloads the browser and verifies search/forecast multiplicity. The initial local
and hosted browser attempts exposed a real file-publication guard: equivalent
`...00Z` / `...00.000Z` observation representations differed after normalization.
Synthetic state comparison located the sole mismatch at `bank.bankSyncAt`.
The validated balance-result boundary now captures canonical UTC before the
journal operation. The unchanged file authority guard remains enforced. The
actual Windows browser refresh/save/reload/search/forecast scenario now passes
locally, alongside 89 related publication/archive tests.

Long archive keys also receive an explicit regression: two keys with the same
first 100 characters retain separate direct-snapshot Morning metadata. Opaque
archive keys are preserved in full rather than normalized as display labels.
The native provider fixture now supplies the actual `{transactions:[]}` response
shape; bare arrays remain invalid external pages with incomplete coverage.

Formatting in the touched canonical policy files was checked with Acorn AST
comparisons separately from the behavioral changes. The readability ratchet and
startup module/byte budgets remain enforced; timing thresholds were unchanged.

## Scope of completion

| Plan area | Evidence / remaining requirement |
| --- | --- |
| Regression reproduction | Original source and identity failures reproduced before fixes; timezone/key-format positive controls retained. |
| Identity and source integrity | Canonical identities, count-preserving readers, strict raw money/date/direction/status and calendar coverage implemented. |
| Shared ownership and types | One feed policy, small app adapters, strict producer/identity/feed contracts and negative compiler mutations. |
| Failure and integration tests | Actual RPC/SQL/readback pipeline and native IDB refresh/reload added to full CI; existing ownership/network/recovery suites retained. |
| Compatibility and cleanup | Persisted v5 format and archive keys retained; compatibility readers preserved; touched policies made readable. |
| Operational release | Physical two-computer/live-provider tests and real staggered production deployment remain unperformed. Existing automated mixed-release tests are included in CI. |

Merged stages with full branch verification:

- Source/coverage: PR #242, head `5b4466da`, successful run `39112825138`.
- Identity/shared feed: PR #243, head `4289c420`, successful run `39114116219`.

No schema migration, production data mutation or live bank call is part of these
changes. Completing automated gates does not stand in for the physical/live
operator experiments in the original plan.
