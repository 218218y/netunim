# Morning Main refresh authority — 2026-10-25

Code inspection and nine held-promise regressions reproduced an Orders Main
refresh crossing account, login or journal-epoch replacement. The old
`available()` checked only current cloud availability/primary state. With equal
local generation and business content, an old HTTP reply could enter adoption
under the replacement identity. The old `finally` also cleared its busy flag.
This is a real coordinator gap, separate from TypeScript coverage.

Refresh now captures the canonical write scope before draining any earlier work,
checks the recovered head against it before starting HTTP, and carries its
current-authority predicate through checkpoint adoption and publication. A stale
completion cannot render, advance the visible revision or create a conflict for
the new identity. Busy cleanup requires the original identity. The existing
adoption helper accepts that explicit predicate and checks it before commit,
before visible publication and before conflict-control writes.

All nine account/login/epoch regressions failed against the previous source;
all pass with the fix. An unchanged-scope positive case still adopts normally.
The combined 81-test selection includes existing hydration, local-edit,
leadership, ACK, recovery and poll-lifetime behavior. Existing Morning fixtures
now provide explicit valid account/journal scopes, so they still reach the
adoption boundaries they claim to test.

Runtime safety behavior changes; storage/RPC formats and financial calculations
do not. This closes the verified Morning path only. It does not claim strict
implementation coverage of both large transports or sync coordinators, nor
completion of the cashflow/Bridge/TS 7 stages.
