# Automatic bank reconciliation for shared checks

Both apps still use `shared_checks_documents/main` and the existing revision-checked
writer, backups, durable outboxes and conflict handling. Bank balances continue to
come exclusively from the bank. Check workflow changes do not credit an account again.

## Workflow

* After a **complete bank snapshot** commits its presence/missing reconciliation, a
  database trigger evaluates the shared checks in the same transaction, under a row
  lock. Both applications receive the result through their existing shared-check poll.
* A uniquely matched positive ILS cheque deposit marks its checks `הופקד - במעקב`.
  Pending bank transactions qualify as evidence of a deposit, never of settlement.
* Each check displays the source description, date, deposit total and batch size.
  Orders includes these incidents in its warning center; Kupa has a header warning
  button. Both check pages show the same review cards, including closed-check incidents.
* The user confirms or rejects the proposed association. Confirmation is durable and
  does not itself clear the check. Rejection restores the pre-match status/date and
  switches the check to manual control. Its transaction remains reserved, even if the
  check is subsequently deleted, so the deposit cannot be assigned again.
* Automatic `נפרע` requires an approved association, a completed positive deposit still
  present in a **new complete snapshot** covering the deposit through the snapshot date,
  no matching return or changed evidence, and the waiting period below. The date comes
  from that verification snapshot, not from a browser timer or the check's due date.
* Missing/changed deposits revoke an automatic cleared state to `הופקד - במעקב` and
  generate an incident. Absence alone never asserts `חזר`. Reappearance requires a new
  confirmation. A new incident has a new acknowledgement identity.
* For a reduced aggregate deposit, immutable original members (IDs, names, amounts,
  numbers and role) are compared exhaustively with the remaining bank amount. A unique
  remainder names the missing members and shows original/remaining/missing totals.
  Successive reductions continue to use the original group. Surviving members request
  fresh approval and restart their observation period; missing members cannot clear.
  Separate explicit bank return debits can also establish the reduced net deposit,
  provided each debit is attributable to this group and no other original group fits.
  Multiple debits must each identify a distinct subset; repeated or ambiguous debits
  suspend settlement instead of implicating a different check through their summed amount.
  Equal-value alternatives suspend the whole uncertain group without naming a guessed
  missing check. A replacement bank row requires a unique same-day deposit explanation,
  compatible reference when supplied, and no competing original claim. Disappearance
  alone does not establish which new transaction belongs to the original deposit.
* An explicit completed return can mark `חזר` when its bank-supplied check number,
  account and amount uniquely identify the check. Unresolved amount-only returns within
  30 days block settlement of every potentially affected batch member and produce a warning;
  the existing bank return alerts remain available. Partial returns never mark the
  entire batch returned merely because one member's amount matches.
* A complete snapshot covering a due check's scheduled deposit date creates an
  `overdue` advisory if no association exists, or `unverified` for a manually deposited
  check. These advisories do not change status or disable future matching. Dates outside
  the bank's verified coverage and future checks do not produce absence assertions.

## Matching and duplicate protection

Only bank activity descriptions classify deposits/returns; free-form memo text cannot
manufacture either. `הפק.שיק בסלולר`, `הפק שיק-ע.ישיר`, full Hebrew deposit descriptions
and explicit English deposit labels are recognized. Fees, cancellations, transfers,
negative amounts and foreign currencies cannot become deposits.

The bank transaction must have a valid date within the complete snapshot's coverage,
not be future-dated, and be within the last 30 days. Its role must match the check's
business/home classification, and the check's due date must have arrived by the bank
transaction date. Amounts are compared exactly as numeric currency values.

The matcher enumerates **all subsets** of up to 16 eligible checks. There is no greedy
"first amount wins" path and no hidden prefix truncation. A second solution, competing
bank transaction, more than 16 candidates, or a nearby already-linked/manual-cleared
check makes the result require manual review. Bank-provided check numbers/counts narrow
the candidates when available. No check names are inferred from bank descriptions.

The structured `checkItems` table is the primary evidence. Each row must match its
own amount and check number; bank, branch and drawer account fields must not contradict
known identity. Leading zeroes are normalized. A matching aggregate total and set of
numbers cannot override mismatched individual amounts. The full bank table is validated
against the deposit total/count before any row is used. Malformed tables cause review,
not fallback. A known numbered check takes precedence over unnumbered alternatives.

Each bank item can be claimed independently, including a known check inside a deposit
containing unregistered checks. The original full bank item set and the claimed manual
members are retained immutably, including their names. An unregistered member can be
added later, but deletion/rejection of an existing member never releases its bank item.
If manual check numbers are absent, unique date/amount matches remain available. A whole
unnumbered equal-amount group can match as a group; a later reduction cannot name its
individual missing members unless their identities were established. Numbered bank
items can identify missing members even when their amounts are equal.

Pending references remain references: a single-deposit reference is not automatically
promoted to a proven check number. Pending evidence is displayed as provisional and
cannot clear a check. A unique complete set of check identities, including a previously
claimed numbered manual group, can connect pending and completed rows even when the
aggregate reference changes. Existing same-reference reconciliation remains available,
with contradictory item sets blocked. A pending row still present in the current bank
payload is never deleted. Final/enriched evidence receives a new confirmation identity.

`הצ שיק חוזר-נט` is classified as redeposit. Number/amount/drawer identity must match
and a returned check's new deposit must be later than the previous return date; uncertain
same-day sequencing requires review. Each redeposit has its own observation/confirmation
cycle, so the old return cannot revoke the new deposit. Loss of previously observed item
details suspends clearing with a distinct warning; it does not assert that the bank
movement disappeared. The aggregate withdrawal/available balance is not per-check
settlement evidence and is never used to accelerate clearing.

Claims live in an internal, owner-scoped table unavailable to client writes. The
archive merger transfers a claim at its existing, proven pending-placeholder collapse;
the check matcher never independently assumes that equal amounts prove an identity
change. Conflicting claims suspend automatic settlement. Metadata on check records is
server-owned and protected against older clients omitting it or a client forging it.

Editing status, amount, due date, account or an existing check number after linking switches that
check to manual control. Editing its name/note preserves the link and actual deposit
date. The edit form exposes an automatic-tracking checkbox. An explicitly re-enabled
check can use a new deposit; a rejected old deposit remains reserved.
Filling a previously blank check number preserves tracking when it agrees with captured
bank identity. Contradictory enrichment switches to manual control.

Manual `הופקד - במעקב` is eligible for initial association even if no automatic
deposit detection preceded it. Only an actual owner/document/check claim makes a
material edit stop tracking. Editing an unclaimed ambiguous proposal or absence
advisory discards that outdated proposal without opting out. Unchanged warnings keep
their acknowledgements; explicit opt-out is always preserved. Re-enabling an unclaimed
check starts a fresh search, whereas re-enabling a claimed deposit requires a new
confirmation event. This correction is installed by
`20260914150000_check_manual_deposit_tracking.sql`; previously applied SQL is unchanged.
Manual clearance and status edits preserve an existing actual deposit date within
the same deposit cycle. No migration automatically re-enables historical opt-outs,
whose original user intent cannot be reconstructed reliably.

## Settlement calendar

The policy waits until the midnight after **three additional banking days**, starting no earlier than the first complete
snapshot observing the deposit as completed (and no earlier than the bank's later
transaction/value date). Saturdays and the published clearing holidays are excluded;
Fridays and ordinary holiday eves count. Yom Kippur eve is excluded. There is no fixed
six-calendar-day minimum. Final evidence must be approved, remain present, and be
observed in a new complete snapshot. This is a workflow inference from bank evidence,
not a bank-issued guarantee.

The reviewed calendars cover 2026 and 2027. Unknown calendar coverage suspends automatic
settlement and displays a warning. Update the calendar through a reviewed migration
when BOI publishes a new year or an exceptional closure; do not silently extrapolate.

Sources inspected on 2026-09-14:

* [BOI cheque clearing and annual calendars](https://www.boi.org.il/roles/paymentsystems/ilpaymentsystems/cchmain/)
* [BOI provisional cheque credit rule](https://www.boi.org.il/media/r3pjw5z5/154.pdf)
* [BOI clarification on late cheque returns](https://www.boi.org.il/media/2lpot4ey/201720.pdf)

## Rollout and verification

Apply `supabase/migrations/20260914120000_check_bank_item_reconciliation.sql` after
`20260913120000_check_bank_reconciliation.sql` through the
canonical migration/release workflow before publishing the new app assets. The migration
does not rewrite historical checks on installation. The next complete bank refresh
starts detection; existing bank credentials and refresh schedules are unchanged.
No browser/open application timer is a substitute for fresh bank evidence. When bank
refresh stops, automatic status progression stops too.
Then apply `20260914150000_check_manual_deposit_tracking.sql` for the manual-deposit
metadata correction. The Hebrew deployment guide lists the latest pending file.

The transaction headers in both apps show `targetDate` in parentheses beside the
projected balance. This is the actual account-specific forecast horizon, which may
differ from the configured check inclusion cutoff. Only checks still `בקופה` enter
the projection. Deposited (manual or automatic), cleared, missing-under-review and
returned checks never add their amounts to the authoritative bank balance again.

The saved Production receipt can predate this release. Static deployment now verifies
the live migration SQL and derives the expected upgraded schema automatically through
`tools/supabase_deploy_gate.py`; a stale receipt no longer requires manual adjustment
after each already-applied migration. A local migration file alone is never deployment
evidence. The deployed check migration and live schema were verified on 2026-09-14.

`tests/check_bank_reconciliation.py` and `tests/check_bank_items.py` run against real disposable PostgreSQL as part of
the candidate-schema suite. It covers grouped deposits, overlap, ambiguous subsets,
pending maturation, fresh observations, missing movements, partial returns, account
separation, metadata protection, claim transfer, limits and holidays. UI/model tests
exercise actual buttons, persistence queues, rejection and note editing in both apps.
The item suite also exercises the real fenced snapshot RPC for pending/final continuity,
per-item contradictions, partial known batches, reserved identities, equal-value losses,
drawer-account separation, number enrichment, missing details and redeposit cycles.
Private bank diagnostic exports are ignored by Git and are not test fixtures or assets.
