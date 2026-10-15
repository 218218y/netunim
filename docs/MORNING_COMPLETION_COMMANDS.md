# Morning completion commands

The controller composes two focused commands in addition to its existing
issuance, status, recovery, media and debt application capabilities:

- `morning-issue-command.js` admits one create, captures the operation and modal,
  confirms the exact form, joins the existing issuance owner, applies verified
  evidence, settles durable recovery and publishes only to its active display.
  Explicit rejection, ambiguous response and verified duplicate retain their
  distinct retry policies. Connectivity is a port.
- `morning-recovery-decision.js` owns the displayed choice. A saved choice alone
  does not authorize allocation: confirmation refreshes cloud data, compares the
  financial snapshot, rechecks the exact persisted choice, durably saves its
  approval and only then resumes reconciliation. It cannot issue documents.

The controller retains modal opening, source selection and the operation state
used by the existing status/recovery owners. Accepted work still belongs to
`morning-lifetime` and its application drain. No new timer or transport exists.

The four extracted decision bodies are characterized against commit
`9151cfbc2f2bee3efce6aff35db269beb93cf12e` in the immutable
`morning-completion-policies.json` fixture. The test normalizes only explicit
port substitutions. The command scenarios cover cancellation, account/modal
replacement, lost replies, duplicate identity, failed durable settlement,
changed debt and replaced persisted choice. Two implementation mutants prove
that cancellation and financial comparison scenarios catch removed guards.
Existing native decision-race and disconnected-create scenarios exercise the
real composition. Module guards prohibit browser/storage/network implementations
inside either command.
