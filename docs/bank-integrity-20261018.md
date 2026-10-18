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
