# Runtime command admission evidence

Implementation evidence for the [single current backlog](ARCHITECTURE_REMAINING_WORK.md).

The remaining orchestration audit reproduced a capture-before-await gap in
`storage-v2-runtime.js`. The journal and IDB owners capture their own commands,
but some runtime entrances waited for earlier commits before reaching those
owners. A caller could change a replacement, cloud base, flight snapshot,
control or metadata/precondition object during that wait. Existing ACK tests
covered the local checkpoint image but did not cover the remote image or nested
options. The new matrix failed all 22 cases (11 entrances in each application)
before the fix. The existing owner-change rejection was a passing control.

The runtime now detaches state and data-bearing options before its first commit
wait. The small option capture body lives in the existing strict checked journal
authority module. It preserves callback identity and inferred option types;
policy callbacks remain explicit capabilities. Existing validators, checkpoint
projection, physical writer/epoch/sequence checks and transaction-complete
receipts remain with their existing owners. Normal `persist` admission is unchanged.

Cloud base, cursor and flight preparation also recheck the coordinated boundary
after waiting, matching the existing ACK/rebase/recovery entrances. A newly
acquired boundary lock rejects those commands before journal invocation. This
does not block commands intentionally owned by the coordinated replacement path.

Validation includes the mutable-input matrix, negative compiler consumers,
callback identity, owner changes, three late boundary-lock cases and existing
cloud adoption/control/durability/recovery regressions. Native IndexedDB evidence
holds an actual append in each namespace, submits a replacement, mutates caller
state/metadata/sequence and verifies the accepted checkpoint after recovery.
The same suite retains the request-success/transaction-abort rejection tests.

The measured eager source is 1,782,757 bytes in Kupa and 2,395,559 in Orders.
The source allowances increase by 1 KB each. No runtime module or timing ceiling
is added. The larger runtime/IDB orchestration bodies remain selectively checked;
this focused closure does not claim whole-program type coverage or live-provider
validation. Full branch CI is required before merge.
