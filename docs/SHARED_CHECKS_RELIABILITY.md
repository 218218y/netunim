# Shared Checks and storage boundary reliability

## Owner fences and canonical durability queue

Baseline: clean main/origin/main at `166d878e`; its push verification passed.
The local baseline strict typecheck, ESLint and 73 focused tests passed.

Two reported races were confirmed by failing regressions: a cloud-state response
could publish into a replacement owner, and flush could report success after an
owner change. Additional failures demonstrated stale error diagnostics and
acceptance of an obsolete epoch. Read-only recovery also needed a storage/epoch
fence when an account is revisited.

Cloud-state publication and flush now capture the store and epoch and recheck
primary authority after awaiting. Storage exposes the existing Journal's settled
queue, including its retained failure, rather than deriving durability from the
last append promise. Flush rejects when inactive, stale or blocked; it does not
claim a cloud ACK. Sync and coordinated replacements also wait on that queue.
Old commit completions cannot modify current-context counters or diagnostics;
durability risks are associated with store identities rather than account names.

Ten deterministic held-promise tests cover A-B, A-B-A, epoch replacement, authority
loss, old successful/failed commits, earlier write failure and read-only recovery.
The real file-export consumer is checked to stop before recovery/file IO when
Shared flush rejects. Existing successful export and same-owner tests remain.
No cloud protocol, journal format or financial merge rule changed.

Source graph measurement after the fence changes is approximately 1,879,100 Kupa
and 2,499,300 Orders bytes (310/406 modules). The previous source budgets were
exceeded by less than 300 bytes. Each source allowance increases by 1,000 bytes
for the measured safety logic; timing/module limits remain unchanged. Full
browser, IndexedDB, crash recovery and database gates remain mandatory in CI.

Static implementation checking of Shared Checks and adjacent boundary/bootstrap
modules is the next stage. This safety repair alone does not add strict roots.
