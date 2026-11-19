# Open work and acceptance

Record the commit, environment, test account, app and connector versions, and relevant artifact hashes for each acceptance run. Keep business content and credentials out of evidence. A missing run is pending. An interrupted or unexplained result remains unresolved.

| Area | Evidence still needed |
| --- | --- |
| Backup continuity | Review scheduled external capture and independent key custody. Rehearse restoration to an isolated service, including roles, Edge configuration, Auth/MFA and provider credentials. Follow [Recovery](../operations/recovery.md). |
| Installed clients | Exercise full Windows connector installation, upgrade, shutdown and rollback on the target machines. Check origin and pairing settings, owned listener identity, pending work, helpers and local artifacts. Use isolated browser profiles and test data. |
| Cloud and devices | On two physical machines, confirm concurrent offline edits in both reconnect orders, a lost acknowledgement, updates with an old tab open, and restore of old and current backups. Record original operation IDs, revisions, ACKs and restarted content digests. |
| Live providers | Use separate Google/Morning test accounts and authorized Bank/Credit test workflows. Check partial failure and reconciliation against persisted evidence. Keep unsupported or unavailable scenarios pending. |
| Performance | On the target low-spec and normal devices, compare repeated cold/warm startup, document viewing, loaded search and save/ACK latency with the same corpus. Record P50/P95 and memory together with the run configuration. |
| Retained formats and provider interfaces | Keep historical readers until installed-browser and old-backup recovery are accepted. Remaining Bank Bridge refactoring is localized to the CAL and Isracard/Amex session ports and provider adapter composition. Review each change with its own behavior and recovery evidence. |

Use the [test lab](test-lab.md) for repeatable synthetic cases. Browser process termination helps verify IndexedDB transaction recovery. Physical interruption, cloud provider acceptance and release verification on installed machines each require their own evidence.
