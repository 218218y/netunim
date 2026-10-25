# Storage runtime reliability follow-up — 2026-10-25

Baseline verified at `32e075f9` (PR #301): 321 strict roots, comprising 199
product implementations and 122 fixtures; TypeScript remains locked to 6.0.3.
There are 23 excluded Bank Bridge modules. This is not whole-program coverage.

## Persisted corruption and asynchronous ownership

The runtime's recovery classifier omitted invalid collection rows, IDB journal
metadata, journal-array decoding and emergency payload shape. These failures
describe retained data, so repeated open cannot repair them. They now block that
journal identity. Fencing, epoch changes, abort/quota errors and optimistic
command preconditions remain retryable; unknown storage errors are not fatal by
prefix. Existing cloud-record errors retain their typed fatal classification.

Idle compaction now captures the journal and epoch, rechecks them after awaiting
commits and before updating maintenance state, and releases only its own scheduling
token. Owner replacement resets maintenance counters and invalidates old tokens.
Checkpoint completions only update their current journal/epoch and count writes
after the actual checkpoint sequence. Recovery cannot publish success or poison
the replacement identity after an A-B-A switch; flush cannot confirm a different
owner after settling. Local initialization rechecks ownership before proceeding
through asynchronous stages.

The change affects runtime safety behavior, not storage formats, cloud protocols
or business calculations. Nineteen new controlled Node scenarios cover queued,
commit-wait and epoch compaction, seven asynchronous command completions, retained
new writes, replacement recovery and flush. The focused 97-test Node selection
passes. Real Chromium/IndexedDB coverage extends `runtime_cloud_record_recovery.py`
with malformed metadata and replay collection rows for both applications, checking
blocked authority, exactly one open and byte-equivalent retained owned stores.
An invalid `getAll()` result is tested at the runtime seam: native IDB returns an
array, so it cannot be manufactured by merely corrupting a stored row.

The original Service Worker report remains unresolved. Broader strict runtime,
transport/sync, cashflow and selected provider contracts are subsequent stages.
No TypeScript 7 acceptance or complete CI result is claimed by these local tests.
