# Incremental JavaScript contracts

## Scope and evidence

The pre-change baseline is `f0a0f874bd118a73ccb1496c7b57686263cadcec`.
Its [full verification run](https://github.com/218218y/netunim/actions/runs/37838418480)
passed. The first strict check of the eight modules below failed on untyped
inputs, unresolved nullable state and contracts that were never compiled.
A separate consumer probe accepted a string login epoch, invalid cursor fields
and async publication. Those same calls are now rejected.

This is compile-time evidence of a contract gap, not a claim of a newly
reproduced data-loss bug. Existing Browser/IndexedDB/PostgreSQL and behavioral
gates continue to own runtime and recovery evidence.

## Checked implementations

`tsconfig.contracts.json` checks these canonical JavaScript implementations and
their compile-only consumer fixture. There are no handwritten declaration
facades, emitted files, application runtime dependencies or blanket `any` types.

| Canonical module | Contract checked |
| --- | --- |
| `authenticated-account-scope.js` | Nullable session/owner, numeric login epoch, refresh flag and captured identity |
| `cloud-checkpoint-publication.js` | Generic committed receipt, synchronous publication and distinct success/stale/publication-error results |
| `storage-cloud-status.js` | Minimal validated cursor evidence, numeric seq/ackSeq/revision, journal owner/epoch and pending/control/flight presence |
| `storage-v2-server-protocol.js` | Startup inputs, untrusted protocol field values, allowed vs blocked decisions |
| `storage-startup-protocol.js` | Marker/account/ownership ports, primary/online context and fenced recovery result |
| `storage-startup-recovery.js` | One-time Main/Shared binding, primary vs read-only requests, recovery phase and immutable readiness snapshot |
| `startup-task.js` | Retained task/result type across joined startup calls |
| `runtime-polling.js` | Live ownership receipt, browser timer ports, numeric delays, mandatory error observation and scheduling state |

The login epoch is numeric; the journal epoch is a string. They are different
identities. Status evidence is a narrow read contract, not a new persisted
format. Business results from startup recovery remain `unknown` because this
coordinator grants readiness, not a typed business checkpoint.

`publish` returns `undefined`, rather than `void`: TypeScript allows an async
callback to satisfy a void-returning function, although this implementation
does not await it. The stricter signature reflects its existing synchronous
publication boundary. Kupa's expression callback now explicitly discards the
view helper's return value, which was already ignored at runtime.

The recovery implementation captures its verified bound ports before entering
the retained asynchronous task. Its internal request distinguishes primary
recovery with context from read-only recovery without it. Public signatures,
ordering, retries, activation and failure retention are unchanged.

## Gates and commands

```text
npm run typecheck
node --test tests/typecheck_contracts.test.mjs
```

The checker uses TypeScript 6.0.3, pinned in `package-lock.json` and the offline
vendor. This portable JavaScript compiler avoids adding a native compiler's
per-platform package closure to the Linux offline toolchain. It is a development
dependency; the sites continue to deploy native JavaScript ESM.

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `allowJs`,
`checkJs` and `noEmit` are explicit. Browser library types are selected; ambient
Node type packages cannot silently change timer or browser contracts.
`npm run typecheck` reads `NETUNIM_OFFLINE_NODE_MODULES` when present, so the
normal and offline gates use the same locked compiler and configuration.
Missing compiler files fail the command and invalidate offline install readiness.

`tests/module_contracts.py` invokes the check in the full local and GitHub
`models` gate. The compile-only fixture includes valid calls and 32 intentional
invalid consumers using `@ts-expect-error`. A newly accepted invalid call makes
its directive unused and fails compilation. Never execute this fixture.
The Node gate tests additionally prove that an implementation mismatch is
detected, an unused expectation fails, and a missing compiler cannot pass.

Contracts live next to the actual implementation, following TypeScript's
[JavaScript checking](https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html)
and [JSDoc](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
support. Extend the explicit file list in reviewable slices; do not suppress a
failure with `@ts-ignore`, `@ts-nocheck` or broad assertions.

## Remaining coverage

This gate does **not** yet check all application consumers, full persisted
checkpoint/journal/Flight codecs, IDB transactions, RPC ACK parsing, Finance
leases or capability APIs. Their existing runtime validation and historical
readers remain intact. Add static coverage at those owners with behavior and
negative consumer fixtures, rather than assuming the status-head contract is
a substitute for persisted-data validation.

No persisted schema, SQL, ACK, merge, RPC, retry or installed-user data changes
are part of this slice. Full Browser/PostgreSQL/recovery/Windows verification
is required before merging; a static pass alone is insufficient for deployment.
