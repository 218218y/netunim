# Kupa finance automation: ownership and live preparation fences

## Evidence and scope

Baseline main `70d85aa6` passed full verification `37798771468`. Five controlled
regressions failed before this change: credit opt-out while Bridge status was
pending, and bank/credit opt-out or owner change while cloud preflight was pending.
The old controllers continued into lease acquisition after the authorization
for that automatic attempt changed. This proves unsafe preparation, not a proved
business-data overwrite. Existing post-provider publication/SQL fences remain.

This slice owns Kupa's bank and credit wakeups, adds live preparation receipts,
and extends the shared recurring owner with immediate wakeup coalescing. Main
cloud polling continues to use that same owner. Orders finance-specific jobs,
Kupa credit preference/diagnostic I/O and other runtime resources are separate
remaining work. No SQL, persisted schema, ACK, scraper or retry budget changes.

## Owners and access

| Owner | Responsibility |
| --- | --- |
| Composition root | Supplies a required automatic scope: primary recovered runtime, ready backend, online, compatible protocol/startup state, and current local/cloud owner |
| Finance capability | Exposes `automation.start/stop` for both controllers; construction performs no I/O |
| Bank/Credit controller | Owns one recurring task, existing due/cooldown/user-preference policy, and the captured scope during automatic preparation |
| Shared recurring task | Serializes timer and immediate wakeups, publishes timer ownership, invalidates old receipts on stop, and drains started operations before scheduling a restarted cycle |
| Connectivity and Cloud UI composition | Stop automation on offline/dispose/logout; explicitly resume on reconnect or cloud login |

`autoScope` is mandatory. Missing ports reject construction; null, missing or
empty scope blocks automatic work. Cloud scope uses the authenticated account
ID, so an access-token refresh for the same account does not change ownership.
Each activated automatic owner keeps that identity between wakeups as well. A
later page render cannot adopt a different account; explicit start/reconnect/login
binds the newly eligible scope after any old operation has drained.
Protocol/recovery/hydration fences remain independent of Main conflict status:
an eligible Finance domain is not blocked merely because Main needs review.

## Preparation sequence

1. Capture the current scope and automatic eligibility.
2. Revalidate after Bridge status (credit), cloud freshness, lease acquisition,
   second cloud freshness and bank snapshot preparation.
3. Immediately before provider entry, require the same scope, live access,
   opt-in, pairing and current recurring-task receipt.
4. If stopped/denied before entry, open no provider session, change no business
   state and append no journal operation. Release only a lease actually acquired.
5. Once a provider operation is started, stop cancels future work and never
   aborts its existing publication/durable-save path. Existing captured lease,
   account/owner, cloud and journal safety contracts still govern publication.

Manual refresh remains independent of the automatic opt-out. The four-hour bank
and daily credit intervals, one-hour bank and daily credit failure cooldowns,
cross-computer freshness checks and provider failure classification are retained.
Bank automation now schedules its next eligible wakeup after the current cycle
finishes instead of relying on a subsequent page render to schedule it.
An unsupported Bank Bridge stops the recurring owner instead of repeatedly
scheduling a blocked 300 ms cycle. A refreshed eligible Bridge status allows
the next normal page wakeup to resume. Explicit automatic opt-in also resumes
an owner previously stopped by connectivity or logout.

## Recurring owner contract

- `start` schedules one cycle and is idempotent while enabled.
- `wake` joins the active promise, or consumes the queued timer and starts one
  immediate cycle. A timer delivered after stop cannot enter the old operation.
- `stop` invalidates receipts and clears the queued timer. Stop/restart during a
  held operation waits for that operation to finish before scheduling a new cycle.
- A failed live gate or delay calculation is reported and stops that owner;
  it cannot escape from an unobserved timer/finally promise. An explicit later
  wakeup/start may resume after the cause is resolved.
- Operation failures are reported through the existing synchronous `onError`
  port. The reporter must not throw. Existing operation-specific recovery and
  cooldown policies govern subsequent attempts; no new network retry loop exists.

## Verification

Node controlled promises cover opt-out, owner/auth/leadership/offline changes,
held leases, stale timers, joined foreground wakeups, stop/restart, manual refresh
and completing an already-started credit result through its durable path.
Existing cross-app freshness, lease fences, bank/check reconciliation, credit
merge/settings and Main poll ownership tests remain required.

`runtime_finance_automation.py` runs the real Kupa composition in disposable
Chromium profiles with a held local Bridge response. Offline/reconnect, account
switch, secondary tab and actual UI logout must open no provider session, retain
the same model and leave the real IndexedDB journal sequence unchanged.
The suite is part of the canonical browser-lifecycle verification inventory.

Full branch browser, PostgreSQL, recovery, two-computer, Morning and Windows
verification must pass before merge. A focused local pass is not that gate.
