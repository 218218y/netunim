# Bank transaction authority

Current Bridge transactions, direct snapshots, SQL archive reads and outgoing archive batches share `shared/bank-transaction-evidence.js`. A status must be exactly `pending` or `completed`; missing/unknown/coercible values reject the complete result before archive writes. Money, currency, identity and supplied timestamps are decoded at that boundary. Historical persisted feed readers remain compatibility readers and cannot grant current network authority.

The readback verifier independently refuses invalid source/readback statuses. An incoming pending row may still read back as completed: the established monotonic completion rule is preserved.

Migration `20261016120000_bank_transaction_status_authority.sql` validates the entire batch in both current public bank writers after their existing lease fence and before entering a write scope. No previously deployed migration was edited. The isolated PostgreSQL candidate suite checks malformed/missing statuses and unchanged archive/snapshot state after rejection. This migration is committed for deployment; a Git merge does not apply it to Production.

Regression coverage includes missing, null, boolean, numeric, unknown and case/whitespace variants, malformed nested rows, sparse arrays, both account roles, both app transports and source/readback verification.

## Nested business evidence and Credit

Supplied cheque and settlement fields are validated before any current Bank balance result, archive batch/read, or direct snapshot is accepted. Booleans remain booleans; cheque amounts/identities, document keys, provider/card identities and numeric activity codes cannot be silently repaired into evidence. Optional omitted details carry no evidence. Accepted Bank transactions and coverage are detached and frozen, including nested values. Both historical feed readers now treat only literal `true` as a document-reference flag.

Credit's current network contract is exactly version 2. It requires valid transaction statuses in flat, monthly, pending and unassigned representations before normalization/deduplication. The Bridge producer also rejects unknown statuses as `CREDIT_PROVIDER_SCHEMA_ERROR` before producing a v2 response. Both production publication paths already require a v2 handshake. Omitting the response envelope version therefore cannot select legacy transaction rules: status remains required, and an advertised v1 response is rejected. Persisted older credit feeds remain supported only by their existing historical compatibility reader. New optional authority decoder modules raise the module-count allowance by two; byte and timing ceilings stay unchanged.

The native Bank balance evidence suite also exercises malformed status/cheque/settlement data through both actual publication callers and verifies retained IndexedDB state. No live provider login is part of those tests.
