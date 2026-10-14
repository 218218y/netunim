# Morning accepted commands and debt application

## Reproduced ownership gaps

Baseline main `eb8fb33269fa32820eadbdad397afb8040510b99` already fenced
account/login authority, recovery and PDF publication. It did not expose an
accepted-work drain for issuance/recovery. The current-flight map forgot an
older login's accepted request when a replacement flight occupied the same key.
A disposed lifetime also accepted a raw join with a caller-supplied assertion.

Three new lifetime regressions failed on that baseline: retain the superseded
flight after its replacement finishes, reject new joins after disposal, and join
a delivered recovery wake while cancelling future wakes. A production-controller
regression additionally held a status JSON body and required disposal/drain to
retain exact recovery. These failures establish an ownership gap; they do not
establish production data loss.

## Accepted work and authority

The strict Morning lifetime now separates current-flight coalescing from an
accepted-task owner. Superseded requests remain drainable until completion.
Queued recovery wakes retain operation/login identity; delivered async work
enters the same accepted owner. Disposal closes acceptance, revokes lifetime
assertions and removes queued timers/listeners. Already submitted durable effects
may finish under their original authority.

The issuance controller accepts complete public async commands before preflight
and confirmation, including reservation, provider creation, reconciliation and
bank notification. Its bank-picker refresh is tracked too. Post-disposal public
commands cannot start new provider work or mutate the disposed form. Recovery
retains its existing structured failure result and persisted operation identity.

Customers exposes `runtime.cancelPending/drain/dispose/isPending` and joins both
issuance and document-browser work. Disposal before UI binding is final. This
runtime owns Morning operations; unrelated customer CRUD, application teardown
and source-transfer orchestration remain separate concerns. A completed drain is
a completion boundary, not a certificate of successful provider issuance.

## Debt application capability

`morning-debt-application.js` receives five explicit ports: lifetime, recovery,
debts, policy and feedback. It owns allocation preconditions and the accepted
application flight. It has no raw model, DOM, timers, provider transport or
persistence API. Construction adapters supply the existing debt and recovery
policies; no alternate write path is introduced.

The algorithm still requires the exact operation/type/amount binding, completed
cloud refresh where required, current write authority and recovery identity. It
compares the current financial snapshot excluding only this operation's stable
event IDs. Changed state requires an explicit current decision. Missing debts,
blocked writes and failed local persistence keep their existing outcomes.

The extracted actual function reconstructs the immutable pre-media policy AST
from main `4d97e2a007ba5eed3db636ce3a900a57439392c5`; all other frozen
issuance/recovery/browser functions remain unchanged. Strict checkJs covers the
actual lifetime/application bodies, negative consumers and mutations of drain
and durable result evidence. The historical recovery readers, issuance retry
rules, provider payload, journal/ACK protocol, SQL and backup format are retained.

## Verification and remaining scope

Focused lifetime/controller tests, Morning models, immutable policy checks,
module graph, lint and strict checkJs accompany the change. The native
`runtime_morning_operation_drain.py` fixture invokes real customer actions and
confirmation, holds an official create JSON body, disposes the capability and
checks that drain waits, recovery stays exact, Main/Shared journals are unchanged
and no new create/reservation is sent. Its transport is synthetic; no live
provider is contacted. Full Git CI remains required before merge.

Broader issuance/recovery coordination, form presentation, complete provider
decoding and customer editing orchestration remain open. Live-provider and
physical two-computer drills still require their own evidence.
