# Kupa Main cloud save confirmation

## Proven failure

Baseline main `ca25f856` followed full green branch verification runs
`37805042788` and `37805051613`. New controlled regressions reproduced false
success after no-flight materialization while local work, access or scope changed.

The real Chromium/IndexedDB regression held the completed readonly snapshot
used by the browser adapter's post-materialization refresh. A real note append
committed before that snapshot was delivered. The original request returned
`true` and published `synced`, while the durable head had `seq=1`, `ackSeq=0`
and `pending=true`. A fresh runtime recovered the same note ID/content and
saved it with one cloud effect. This proves premature confirmation; it does not
prove data loss. The post-ACK backup boundary had the same stale-receipt risk.

## Confirmation contract

`true` from `requestStorageV2CloudSave` confirms a clean Main head at its final
observation. It is not just an acknowledgement that one Flight was transferred.
The save and poll paths use the same confirmation decision:

- A fresh, validated scoped journal read is required after no-flight
  materialization and after ACK/publication/optional backup.
- Primary leadership, account authorization, runtime readiness and online
  access must still be eligible. A different durable owner/epoch cannot reuse
  old evidence or publish the old operation's success.
- The generation and observed sequence must remain unchanged across the
  confirming read. Base revision must equal the current cloud revision;
  `base.ackSeq === seq`, `pending === false`, no Flight and no Control are required.
- The visible Main cloud projection must match the durable base. Finance and
  Shared Checks remain independent owners of their projections and status.
- Read errors fail confirmation and remain visible through existing error
  classification. They do not fabricate ACKs, change journal records or imply
  the already committed local write was lost.

Existing journal validation and writer guards own the persisted record/epoch
contract; no redundant writer field or persisted format is introduced here.
The existing force option cannot bypass account, protocol, primary or scope
guards. Offline transport failures retain the original retry-control policy.

## New work during save

The existing drain continues for pending work represented in the committed ACK
receipt. Work arriving later, such as during optional backup or no-flight
materialization, prevents the old request from confirming completion. A newer
generation wakes the already enabled Main polling owner after clearing the
joined save promise. This avoids joining the old request again and consumes one
owned wakeup; stopped or denied owners are not restarted. Existing periodic
polling/reconnect and durable flights remain the recovery mechanism.

No SQL, schema, merge, RPC, ACK semantics or retry budget changes are included.
The pending poll path revalidates Main after independent Finance/Shared reads
before returning its final success.

## Verification

- Controlled Node cases cover no-flight edits, logout, leadership, owner/epoch,
  control and offline changes; final-read failure; edits during the confirming
  read; post-ACK backup changes; clean no-op/ACK; and a new generation waking
  the existing owner without an extra timer or premature success.
- `runtime_kupa_save_confirmation.py` holds real IndexedDB read delivery and
  post-ACK backup, commits a note edit, verifies pending versus ACK sequence,
  starts a fresh runtime, and verifies the same ID/content in local and cloud
  heads with one effect per Flight.
- Existing ACK lost-response/abort/restart, immutable replay, cloud adoption,
  Shared status, two-profile and PostgreSQL suites remain required full gates.

Document Bridge deadline/cancellation is a separate change. Owner-transfer UI
confirmation and the remaining resource/I/O/type/Bridge/SQL tracks remain
review work, not additional bugs inferred from this finding.
