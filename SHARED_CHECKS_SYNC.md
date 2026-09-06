# Shared Checks synchronization contract

`public.shared_checks_documents` remains canonical. The refactor changes coordination,
not business merges, delete intents, operation IDs, revision checks, durable outboxes,
or server ownership of `bankEvents`.

`shared/shared-checks-flight.js` owns one pull slot and one save slot per app instance.
Both apps use it through their existing `createSyncChecks` composition. Slots are
reserved synchronously, before callbacks run. Same-kind callers await the same work,
including a flight queued behind the opposite kind. A pull during a save starts a
fresh read after its ACK; a save during a pull re-reads network/session/outbox when
its turn starts. Predecessor rejection releases ordering, and does not imply success
for either operation. No sleeps, timeout races or retry count implement this contract.

Operations must not await a nested flight from inside their own callback. The
existing outbox retry-after scheduler and UI save debounce are separate policies;
they do not supply synchronization or bank verification evidence. A queued failed
save does not prevent a fresh pull from discovering a genuine conflict/deferred state.

`checksCloudBusy` / `sharedChecksBusy` are getter-only compatibility UI properties.
They derive from the coordinator's active operation. They cannot become true without
an awaitable slot. `sharedChecksSyncStatus()` exposes one derived phase:

| Phase | Evidence / precedence |
|---|---|
| pulling | Pull callback is active |
| saving | Save callback is active, including durable outbox work |
| offline | No active callback and network/session is unavailable |
| conflict | Durable cached outbox has an unresolved conflict |
| deferred | A flight is queued or unsaved local/outbox work remains, including retry-after |
| idle | No active, queued or local work |

Active work takes precedence over connection status; losing connectivity does not
erase its Promise. Idle is an activity status, not proof of a successful remote read.
Existing `required`/quiet caller error presentation remains unchanged: a failed joined
pull either returns false or rejects according to the initiating operation; it never
returns true because another caller asked for verification.

Both bank controllers verify checks and drain local work immediately before obtaining
the watermark. Bank Bridge refresh verifies again after external fetch/archive awaits,
so edits made during those awaits cannot bypass the guard. Server-returned bankEvents
from the save ACK contribute to the final watermark. A conflict or retry-after blocks
publication. This adds a required verification read to the refresh path.
The caller checks local work synchronously again after the verification helper returns,
closing the final Promise-continuation gap before reading the watermark. A mutation
in that gap blocks the snapshot instead of publishing stale verification evidence.

Pull merge staging now precedes asynchronous local mirroring. Previously an edit
during a folder/backup mirror could be overwritten by staging the earlier merged
snapshot after that await. The generation-protected durable ACK logic remains intact.

Validation:

```text
python tools/sync-assets.py
python tools/repeat_shared_checks_races.py --runs 100
python tests/module_contracts.py
python tests/run_all.py
```

The race suite uses explicit deferred read/ACK/mirror/Bridge gates, not sleeps. It
exercises real sync implementations in both apps, the Kupa manual bank commit, and
both real Bridge refresh controllers. Public copies and worker hashes are generated
by the existing sync-assets tool. Greenfield document creation remains the existing
explicit onboarding path; it is not a polling or bank verification operation.
