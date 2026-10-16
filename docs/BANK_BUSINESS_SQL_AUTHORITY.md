# Bank nested evidence at the SQL writer boundary

The current v6 writers already validate transaction statuses, but the retained
merge implementation writes `checkDetails` and `creditSettlementDetails` directly
to JSONB columns. Their schemas had no database constraint. A stale client could
therefore store values that the strict current archive/snapshot readers reject.

The additive migration `20261016130000_bank_business_evidence_authority.sql`
extends the two current writer boundaries. The lease/operation fence remains
first. The complete batch then passes both the existing status guard and the
nested business guard before entering any merge, snapshot or absence-reconciliation
implementation. Existing migrations, historical rows, merge algorithms and
monotonic pending-to-completed rules are unchanged.

The nested guard matches the canonical JavaScript schemas: optional/null detail
objects; exact document/fetch booleans; typed identifiers; cheque kind, positive
safe count, bounded distinct numbers/items, positive finite item money and image
hashes; issuer enum, safe activity codes, distinct four-digit cards and explicit
card-identity provenance. Identifier whitespace follows ECMAScript trim. New
helpers are private to `netunim_internal`, with public/anon/authenticated execution
revoked; existing v6 privileges and security-definer operation fences are retained.

One synthetic 112-case corpus drives all four JavaScript entrances and real
PostgreSQL tests for both public writer commands. Positive cases preserve nested
values, including actual `false`. Every malformed batch includes a valid prefix;
the complete archive, snapshot and Finance document are compared before/after
rejection. This proves batch rejection does not leave a prefix write or authorize
absence reconciliation. The existing status and fencing regressions still run.

The migration must be applied through the normal deployment process. A successful
branch workflow and a Git merge do not apply it to Production, repair historical
corruption, certify live providers or replace the physical release matrix.
