# Bank transaction identities

All identities below are scoped to the selected owner, bank account and role by
their caller. None is an account identity or permission to write.

| Purpose | Identity and authority |
| --- | --- |
| Proven Hapoalim source | Real event day, nonzero bank serial and signed amount, matching the existing archive rule. A bank reference or raw `id` alone is insufficient. |
| Archive record | Positive `archiveId`, retained across the archive's own reconciliation. Document and handled links remain attached to this ID. |
| Archive command | Existing serial, reference or occurrence fallback `mergeKey`. Persisted formats are unchanged. Conflicting serial/reference keys still fail atomically in SQL. |
| Display/search | Role plus archive ID, or source identity plus original occurrence position. This key cannot authorize a financial match or delete a row. |
| Recurring history | One-to-one overlay of retained and fresh representations. Prefer archive ID, then proven source identity. Raw references without serial proof require the same financial content. Historical id/day fallback supports old persisted records without bank-reference metadata. |

No feed normalization deduplicates rows. Equal references, text, dates or amounts
do not prove a duplicate. Historical readers also do not truncate stored rows to
the transport's request budget. Count caps and incomplete reads remain transport
responsibilities.

History overlay consumes each fresh occurrence at most once and retains excess
old occurrences. Only canonical complete calendar coverage can mark an unmatched
old occurrence missing. Within each input, all occurrences survive, including
indistinguishable rows. Several posted movements for one obligation/month produce
the existing ambiguous forecast warning rather than one inferred movement.

Kupa directly exposes the canonical feed reader. Orders decorates its normalized
rows with Morning handled state and verified document links. Neither adapter owns
storage or cloud writes. Historical normalization remains a compatibility reader;
live financial authority still requires the strict transaction boundary.
