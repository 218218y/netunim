# Aggregate cheque placeholder reconciliation

The November 17 incident was verified by a read-only Production query as well as
the user's diagnostic. One pending direct deposit had reference/serial `0`, no
cheque items and balance 11101.98. Its completed machine deposit had reference
`-1`, serial `2`, two items of 570 each and balance 11141.98. Both had the same
1140 total and November 16 transaction/value day. Private cheque/account/image
identities are deliberately omitted from this report and regression fixtures.

The existing merger could identify a transition by a stable reference, equal
balance or already-known cheque items/claims. None existed here. Its per-cheque
batch completion rule covers several individually numbered pending rows, not
one aggregate placeholder with reference zero. Consequently the snapshot marked
the old representation missing even while the itemized deposit was present.

Migration `20261117070000_bank_aggregate_cheque_transition.sql` resolves this
specific bank representation at the complete-snapshot boundary, under the same
financial transaction lock and v6 lease/evidence validation. It requires the
strict zero-reference empty direct-deposit shape, a numbered machine-deposit
table with valid amounts totaling the credit, matching currency/amount and exact
Jerusalem transaction/value days. Both archive and full source must offer one
candidate. Competing deposits, source overlap, partial scans, invalid details,
contradictory claims and linked legacy placeholders fail closed.

The normal merger enriches the original archive ID when possible. For a pair
already persisted by an earlier version or a partial scan, the completed ID
survives; compatible cheque claims transfer with their previous ID recorded.
No UI alert is suppressed and no settlement rule is relaxed. A subsequently
missing completed deposit still raises the ordinary disappearance incident.

The disposable PostgreSQL regression reproduced the original false warning
before the migration. It exercises the real fenced snapshot RPC, replay,
preexisting missing-row healing, partial scans, source order, ambiguity,
contradictory evidence, role/account isolation, claims, helper permissions and
transaction rollback. The full candidate suite also runs this regression.

Deploy the versioned migration before relying on the behavior. The next complete
bank sync reconciles the old incident; the migration itself does not edit bank
transactions or mark an alert reviewed.
