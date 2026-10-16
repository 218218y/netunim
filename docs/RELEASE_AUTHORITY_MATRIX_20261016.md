# Authority release verification matrix, 2026-10-16

Each authority stage runs the full repository workflow on its branch before merge.
Local checks are focused; PostgreSQL, complete browser coverage and Windows run in
GitHub Actions. The same checks are not required to finish a second time on Main
after an unchanged, verified branch is merged.

| Boundary / scenario | Automated release evidence |
| --- | --- |
| Bank status and nested-business deployment | `postflight-target.json` requires `20261016120000_bank_transaction_status_authority` and `20261016130000_bank_business_evidence_authority` exactly once, before schema replay/upload. Complete migration SQL hashes and schema verification remain mandatory. Both deployed migrations and eight active function bodies matched on 2026-10-16; [scoped authenticated observation](evidence/bank-authority-production-20261016.json) |
| Credit account status and merge/routing identity | `credit_business_evidence.test.mjs`, `credit_identity_evidence.test.mjs` and both actual refresh owners: malformed enums/keys cause zero merge/write with unchanged retained state; omitted supported issuer/role metadata preserves known identity |
| Actual Credit guard mutations and focused follow-up audit | `credit_account_authority_mutations.test.mjs`: eleven removed production checks reproduce financial replacement, issuer/routing loss, ghost/empty/duplicate keys, monthly empty replacement and cross-profile collapse. Monthly enums and owner identity are validated before normalization |
| Malformed Bank acknowledgement/archive/snapshot/link success | `bank_response_evidence.test.mjs`, archive and Morning transport suites |
| Bank reconciliation with an empty source | `business_response_evidence.test.mjs`; malformed counters/flags cannot authorize publication |
| Provider claims complete coverage without transaction rows | `bank_balance_result.test.mjs`; malformed/missing arrays cannot authorize absence reconciliation |
| Restore list and stage/apply response evidence | `restore_response_evidence.test.mjs`; malformed success is an error, never empty recovery |
| Server-only incomplete restore, post-commit failure, fresh client | `runtime_restore_server_recovery.py`; real IndexedDB pending identity and paired Main/Shared adoption |
| Startup edits during or after failed restore | `startup_recovery_readiness.test.mjs`; both app lifecycle gates remain closed until adoption |
| Legacy unscoped/foreign-account/wrong-app restore | `backup_restore_scope.test.mjs`; zero remote writes, record retained |
| Caller mutation before IDB work | `runtime_journal_input_capture.py`; 30 cloud-record/precondition cases and four transition cases |
| Request succeeds then transaction aborts | `runtime_journal_authority.py`; no commit receipt, prior durable state retained |
| Lost ACK, write/rebase interruption and real database protocol | existing storage/browser fault suites, `runtime_sync_postgres.py`, database group with PostgreSQL 18 |
| Offline/reconnect, two tabs/computers, account handoff | existing sync, connectivity, owner-transfer and scope suites; isolated simulated accounts |
| Cold/cached/offline startup and CPU slowdown | existing `runtime_startup.py`; repeated browser measurements, no new lazy split |
| Bridge runtime packaging/shutdown, Windows entrypoints and native vault | models plus Windows deployment contracts; staged runtimes, isolated files, no provider login |
| Main/Shared ACK ambiguity, revision coercion, lease/Morning invalid clocks | `business_response_evidence.test.mjs`, existing write-ACK, lease and Morning evidence suites |
| Billing confidence and readability preservation | Credit billing regressions, token/AST evidence, lowered readability fixture, exact module/byte budgets |
| Credit successful month/pending replacement lacks rows; malformed issuer amounts/parts | `credit_business_evidence.test.mjs`, `credit_producer_evidence.test.mjs`, both production refresh-owner regressions; zero merge/publication and normal lease cleanup |
| Checkpoint/local replacement, flight admission/rejection and local reset | Eleven checked decisions, implementation mutations and 36 native rejected transitions with unchanged durable state |
| Malformed nested Bank evidence sent by an older client | Shared 112-case corpus at JavaScript entrances and both v6 SQL writers; valid nested values preserved, malformed batch leaves archive/snapshot/Finance unchanged |

## Operator checks still required for a production release decision

These require physical hardware, live accounts or deliberate interruption of an
installed runtime. Automated fixtures cannot substitute for them:

1. Run cold/cached/offline on a genuinely weak physical machine and record median
   and p95 with device, disk and network details. Keep the current architecture
   unless a measured presentation bottleneck justifies a split.
2. Exercise installed Windows Bridge update and shutdown under active work, then
   a controlled process termination during write/ACK and restart. Preserve a
   recoverable test backup; do not interrupt the user's working Bridge as a test.
3. Use non-production test data for an older backup/import, restore, offline to
   online transition, A to B to A switching, and two physical clients on one test
   account. Confirm both authoritative heads before editing after restore.
   For a legacy pending restore without owner evidence, review the preserved
   record against the original account and server ledger before resuming it.
4. Validate real Bank/Credit provider responses and complete/partial coverage
   against the approved account. Keep provider credentials and customer data out
   of test logs and repository artifacts.

The Bank SQL observation above was read-only; no Production migration was applied
during this continuation. No live provider scan, site deployment, customer-data
restore or physical-device performance result is claimed by the code stages.
