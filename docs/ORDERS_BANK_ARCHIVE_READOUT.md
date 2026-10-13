# Orders Bank archive readout ownership

This stage starts at tested main `f572797161bc9fa01bdee5172908a0f1f94a54e6`.
Three regressions failed against that controller: a failed rows request completed
hydration while its accepted snapshot sibling was pending; Bank verification
released its Finance lease under the same interleaving; a rejected archive read
reported private former-account error details after an account handoff. These
prove local ownership/reporting defects, not a production data-loss incident.

## Boundary

`bank-archive-readout.js` owns the two-role read cache, hydration flights,
projection revision and accepted requests. Its six required ports supply live
read authority, current targets/inline rows, rows/snapshot reads, access,
revision notification and scoped reporting. Construction starts no work.
Commands publish confirmed candidates or patch archive IDs; queries expose
matching projections and verification reads; runtime owns ensure/pause/resume,
idempotent disposal and draining all accepted work, including superseded work.

`bank-archive-model.js` supplies pure target/source-row selection and display
projection. Finance composition supplies the actual current authority and cloud
transport, and disposes its private archive owner. Controller collaborators
decrease from 23 to 20; Main imports remain 56.

Accepted row and direct-snapshot requests start in their existing order. A
synchronous failure prevents later starts; every already accepted request is
joined before success or failure. The original first failure is retained unless
authority changed. Hydration suppresses errors after handoff or invalidation.
Bank pauses reject new hydration and later-role starts while retaining accepted
reads. Verification reads remain available to the active Bank workflow.

The all-years display window remains `days:null`; verification stays `days:370`.
Bank write receipts, independent document heads, archive coverage/audit, provider
retry/fallback, SQL, persisted formats and historical readers retain their
existing policy. Candidates publish only after confirmed document readout.
Unchanged home projections and exact `archiveId` row matching are preserved.

## Evidence and limits

Focused controller regressions reproduce the three original failures and now
pass. Owner tests cover synchronous and asynchronous failures, four accepted
role reads, partial home failure, same-account re-login, superseded flights,
pause/dispose/drain and row identity. A failed automatic-attempt preference
write cannot strand archive hydration in a paused state.

Native browser tests exercise the actual Finance capability, live account epoch
and real Main/Shared IndexedDB checkpoints for hydration failure, handoff and
verification failure. They assert exact journal retention and no Bank
publication; verification retains its lease until the accepted sibling settles.
Provider and cloud replies are injected; live bank sessions are not certified.

The actual owner body compiles with strict `checkJs`. Negative consumers reject
invalid roles/account keys/windows, asynchronous authority or row mutation,
fabricated ACKs and private authority access. A body mutation to numeric rows
fails compilation. Import/effect and collaborator budgets protect the boundary.
Full branch CI remains the required deployment gate. Broader controller, lease,
RPC and complete business-payload typing remain in
[the major work inventory](ARCHITECTURE_REMAINING_WORK.md).
