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
