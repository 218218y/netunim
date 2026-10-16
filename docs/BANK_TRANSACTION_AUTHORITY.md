# Bank transaction authority

Current Bridge transactions, direct snapshots, SQL archive reads and outgoing archive batches share `shared/bank-transaction-evidence.js`. A status must be exactly `pending` or `completed`; missing/unknown/coercible values reject the complete result before archive writes. Money, currency, identity and supplied timestamps are decoded at that boundary. Historical persisted feed readers remain compatibility readers and cannot grant current network authority.

The readback verifier independently refuses invalid source/readback statuses. An incoming pending row may still read back as completed: the established monotonic completion rule is preserved.

Migration `20261016120000_bank_transaction_status_authority.sql` validates the entire batch in both current public bank writers after their existing lease fence and before entering a write scope. No previously deployed migration was edited. The isolated PostgreSQL candidate suite checks malformed/missing statuses and unchanged archive/snapshot state after rejection. This migration is committed for deployment; a Git merge does not apply it to Production.

Regression coverage includes missing, null, boolean, numeric, unknown and case/whitespace variants, malformed nested rows, sparse arrays, both account roles, both app transports and source/readback verification.
