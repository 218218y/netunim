# Credit refresh operation ownership

Orders `domains/finance/credit-refresh.js` and Kupa `domains/credit/refresh.js`
own the complete accepted refresh: account/device capture, cloud freshness,
lease acquisition/recheck, provider planning, result/diagnostic publication,
status refresh and joined cleanup. Their strict checkJs factories require seven
role APIs: authority, cloud, device, leases, Credit policy, publication and
automation. Controllers retain admission, busy state, preferences and messages.

Orders no longer calls either Bank/Credit provider or holds a lease session.
Kupa Credit replaces four flat save/read/checkpoint/lease inputs with publication
and refresh, decreasing from 15 to 13 inputs. The existing publication owner is
composed once and also serves settings/reset/retry; no new writer is introduced.
Each operation uses a dedicated lease owner, tracks preflight before acquisition,
stops renewal on disposal and joins accepted provider, diagnostic and cleanup
work. Pairing replacement/disposal retain same-account cleanup; account/login
or leadership replacement leaves the old grant to server TTL. Drain is no ACK.

## Preserved policies

Both full refresh functions were captured from main
`fd94882b718ca05f0ff0c7348a2f5016ef016733` before editing. Tests recompose the
actual owner and actual controller callbacks into the immutable AST, reversing
only reviewed role substitutions, the added lifetime fence and the separately
tested network envelope. Older lease/issuer/publication fixtures remain fixed.
Mutation checks reject changed provider scope, lost diagnostics, denied-lease
entry and unawaited cleanup.

Orders still preflights manual/automatic commands, rechecks shared freshness
after acquisition and checks freshness inside its automatic Finance mutator.
Kupa uses its verified cloud snapshot for freshness, smart mode and excluded-card
selection. Its retained publication guard remains independent of lease renewal,
preserving post-ACK read/checkpoint recovery. Daily retries, server cooldown,
quick/forecast/recovery modes, last-known-good merge, warning semantics and
existing return values are unchanged.

## Network evidence and verification

`shared/credit-refresh-result.js` starts from unknown replies. Successful sync
requires an object and profiles with nonempty string IDs. Optional error arrays
contain objects; optional attempted/deferred counters are nonnegative safe
integers. Supported older replies can omit counters/errors. Nested issuer money
and month data still uses the existing Credit model normalization; the envelope
does not confer financial confirmation.

This rejects reproduced coercible-count cooldowns, empty/invalid profile
publication and malformed diagnostic persistence. Invalid HTTP failure
diagnostics retain the transport error and previous data, and confer neither
diagnostic publication nor cooldown success. Kupa now reads unavailable-Bridge
detail from the real connection owner instead of an absent controller field.

Strict negative consumers and body mutations cover unknown evidence, numeric
counters, synchronous guards/observation and joined drain. Controller tests
exercise invalid status/result/failure envelopes through the real compositions.
Native lifecycle tests cover pairing/account/disposal during acquisition,
provider and renewal. Malformed replies preserve exact Main/Shared IndexedDB
journals and fresh-runtime note recovery. Full PostgreSQL/browser/Windows/model
CI remains required.

Kupa Bank provider orchestration, remaining financial edit contracts, complete
nested issuer contracts, Calendar/Customers, Document Bridge and measured startup
remain open. No persisted schema, migration, RPC, provider fallback/retry or
Bridge version changes are included.
