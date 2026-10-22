# Remaining physical acceptance, 2026-10-22

Automated CI and the October 22 code corrections do not complete physical/provider
acceptance. The current workspace has no established isolated two-computer/provider
test environment. No destructive interruption, backup restore or live financial
provider experiment was performed on the working installation.

Prepare two disposable browser profiles on two physical Windows computers, an
isolated test cloud account/project, synthetic Main/Shared records, copied test
backups and a separate Bridge installation/account. Verify account identifiers,
data directory, origin and provider environment before any interruption. If a
provider has no safe test account, keep its scenario marked NOT RUN.

For each scenario preserve source revision, app/service versions, computer/profile
labels, time zone, test-account fingerprint, pre/post/restarted content digests,
operation identities, local journal/checkpoint versions, server revisions and ACKs.
Use existing diagnostic/backup exports with secrets and business content removed.
An interface label alone is insufficient. Missing evidence remains NOT RUN;
injected failures in CI remain automated evidence, not physical execution.

Additional isolated native evidence is available in
[the October 22 closeout](UPGRADE_CLOSEOUT_20261022.md): owned historical Windows
Bridge listeners upgrade through 38/39/40, and the actual staged Bank process
rejects its revoked test token after restart while retaining vault/image data.
Those results do not execute the global installer/autostart/task registration,
two-computer workflow or real financial provider scenarios below. Their remaining
physical acceptance status is still NOT RUN.

The [batch follow-up](SEARCH_BATCH_FOLLOWUP_20261022.md) adds native large-content
Everything measurements and isolated Bridge 41→43 replacement evidence. These
also leave every physical/full-install/provider scenario below NOT RUN. The
[quality completion](QUALITY_COMPLETION_20261022.md) adds isolated search parity
evidence and requires v44 for new acceptance; its client explicitly rejects
earlier Bridge runtimes. Physical/full-install/provider status is unchanged.

| Scenario | Required persisted evidence after restart |
| --- | --- |
| Two physical computers; disconnected concurrent edits; reconnect in both orders | Expected content converges; original operation IDs are retained; no duplicated financial action; revisions/ACKs agree on both clients |
| Close browser/terminate a disposable machine during local save, before/after cloud commit and lost ACK | Each accepted durable operation survives or remains explicitly pending; acknowledged work is not replayed as a new operation |
| Keep an old app tab open while a second profile updates | Old/new versions preserve read/write ownership, no incompatible writer silently enters, both ultimately reach the expected revision |
| Update and stop disposable Bridges during preview/provider work | Accepted work drains or has an explicit recoverable outcome; no orphan process, stale lock, leaked preview or false success |
| Restore older and current copied backups while local work is pending | Pending journal identities survive or the restore is explicitly refused; no unconfirmed work disappears; both restarted clients converge to the intended result |
| Bank/Credit test-provider workflow, including partial failure | Provider operation identity and monetary/coverage evidence agree with persisted local and cloud receipts; unknown outcomes remain unknown until reconciled |

Run each interruption at the named local/remote commitment boundary, in both
client orders, and include one clean control. Keep hashes of the evidence files
and the exact passing CI run for the tested revision. A successful branch gate
need not be rerun solely because that same tested change was merged to main.
The next live static rollout still requires its existing production postflight.

For representative performance, run the existing loaded-data and startup probes
on the normal and weak physical computer with matching synthetic sizes and
record disk, memory, browser, CPU throttle, source revision and instrumentation.
Compare repeated median/p95 observations; keep command readiness, synchronous
compute/render, next-paint opportunity, durable local commit and cloud ACK distinct.
The prior 4x CPU, instrumented one-sample figures identify candidates, not proven
production bottlenecks. No framework, cache or storage replacement follows from them.
