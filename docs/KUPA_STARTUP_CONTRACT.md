# Kupa startup phase contract

This slice changes orchestration and the timing of the first recovered account
display. It does not change journal schemas, Main/Shared ownership, RPCs, SQL,
ACK/revision rules, credentials or restore reconciliation policy.

## Construction and ownership

The composition root constructs and binds Main/Shared recovery before lifecycle.
Three additional owners receive validated ports, without importing domain, UI,
storage, cloud or browser adapters:

| Owner | Collaborators | Public methods | Responsibility |
| --- | ---: | --- | --- |
| Cloud startup | 6 | prepare, hydrate | Initial hydration gate, capability verification, restore reconciliation and automatic cloud opening |
| Local services | 3 | start | Optional browser persistence and remembered backup target preparation; independent error reporting |
| Connection startup | 4 | bind, openLocal, dispose | Four connection-screen bindings and the automatic local-folder entry path |

Each task retains its execution promise, including failure. Repeated boot or
phase calls join that task; they cannot replay partially completed bindings or
remote work. Cloud preparation publishes a frozen mode only after installing
the initial gate/status. A runtime cannot switch its prepared storage mode.

Connection listeners use the shared runtime resource owner. They live for the
page runtime, are registered once, and can be disposed once. Disposal removes
listeners and suppresses future dispatch; it never aborts an action already
performing a durability commit. This is not a general shutdown mechanism for
other shell listeners or capability timers/pollers.

## Required order

1. Acquire primary-tab lock, establish durable storage owner, restore auth and
   hydrate local-birth/owner-transfer state.
2. Verify storage protocol. Complete required birth/transfer boundaries using
   their existing fenced implementations. A secondary tab takes the existing
   read-only recovery path and starts none of the primary phase tasks below.
3. Bind connection actions and install the initial cloud hydration gate.
4. Recover Main, then Shared; activate only the complete recovered pair.
5. For account mode, mark the backend ready and display the recovered data.
   Existing protocol, tab, capability and cloud hydration guards still control
   mutations. Local-folder mode retains its connection-screen path.
6. Start optional browser persistence and backup-target preparation together;
   await both. These services no longer delay the first recovered account view.
   They still finish before remote hydration or automatic folder opening to
   preserve backup-target selection and ownership.
7. Recheck live access, online state and authentication. Account mode verifies
   cloud capabilities, resumes restore reconciliation, and opens cloud data in
   order, checking access again between effects. Local mode opens the remembered
   folder or shows first-run UI if access remains valid.

Cloud startup enables the hydration gate before its first remote effect even
when connectivity was regained after initial preparation. It releases that gate
on completion, deferral or failure. Lower-level auth, owner/epoch, checkpoint
publication and journal fences remain authoritative for in-flight operations.
These phase ports do not cancel a running restore/save or implement retries.

## Failure and deferral policy

| Condition | Outcome |
| --- | --- |
| Missing port | Fail construction before effects |
| Failed lock/protocol/birth/transfer | Preserve existing blocked/read-only policy |
| Missing/failed Main or Shared recovery | No activation, business display, optional services or cloud phase; retain the recovery failure |
| Failed cloud-plan installation | No published plan or recovery activation; retain failed task |
| Optional persistence or backup-target error | Report its original cause once; continue the independently eligible phase |
| Capability mismatch | Record the error, show the DB upgrade guard, skip restore/cloud opening |
| Offline account startup | Skip remote reads; retain existing polling/reconnect ownership |
| Signed-out startup | Skip remote reads and show login-required cloud status |
| Leadership, protocol, auth or connectivity lost between phases | Skip the next remote effect; existing connectivity owners handle future wakeups |
| Restore reconciliation error | Retain the existing report-and-continue policy; no new blanket retry or error classification |
| Unexpected cloud-opening failure | Reject and retain the same failed task; release hydration gate without replay |
| Partial listener registration failure | Retain failed binding; no repeated registrations; owner remains explicitly disposable |

The startup auth check tests current authentication rather than a preflight
snapshot. It does not replace account-identity checks in the concrete adapters.
Pending journal operations, conflict evidence and backups are not cleared by
these orchestrators.

## Verification

`kupa_startup_lifecycle.test.mjs` covers first display during delayed optional
preparation and loss of auth, leadership, protocol access or connectivity there.
`kupa_startup_phases.test.mjs` covers remote ordering, partial failure, retained
tasks, regained connectivity, independent optional services and listener disposal
while an action is running. Existing recovery, local-birth, mutation-guard and
offline tests protect the mandatory Main/Shared safety boundaries.

Module graph caps Kupa lifecycle at 23 collaborators and startup factories at
eight. Startup modules cannot access browser I/O directly or import concrete
adapters/business/UI helpers; lifecycle cannot bind DOM directly. Full branch
CI remains the deployment gate, including real browser, PostgreSQL and Windows
deployment contracts.
