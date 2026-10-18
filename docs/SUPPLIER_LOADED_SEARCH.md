# Loaded Supplier search evidence

This is implementation evidence for the
[single current backlog](ARCHITECTURE_REMAINING_WORK.md).

The clean-source [CI baseline](evidence/loaded-data-ci-before-supplier-search-20261018.json)
from run `39122964398` passed all four loaded-data scenarios. At 10,000 Orders
transactions, 4x CPU throttling and the standard Linux CI runner, Supplier search
took **18,618 ms**; the 1,000-row case took **1,929 ms**. The before snapshot binds
source revision, fixture bytes/counts, environment, durable editor outcomes and
fenced secondary tabs. This establishes a loaded presentation bottleneck without
inferring a problem from module counts or introducing a new business writer.

The existing presentation searched the model for totals and also normalized each
DOM row's search string and wrote `hidden` across the entire table. A native
1,000-row regression reproduced retained unmatched DOM rows before the change.

The table and totals now consume the same filtered model rows. Initial renders
create only matching rows; later search replaces only the table body when result
IDs change. Equivalent queries retain their surviving DOM rows. The toolbar,
search editor/focus, surrounding table and header remain mounted. No new cache,
pagination, saved format, asynchronous lifetime or runtime module was added.
One private matching wrapper with no other consumers was removed; the query is
normalized once before matching rows, retaining NFC/case/whitespace semantics.

Balances still come from the complete Supplier render model. Search totals cover
all matching transactions. Clearing restores every row, and empty results retain
the existing message. Move-target mode still renders every insertion target and
ignores search, as before. Bulk selection consumes exactly the displayed matching
IDs. Inline editing keeps the existing owner/journal path and reapplies the same
read filter after a text change. No model records are modified by searching.

Validation: the native regression checks 1,000 source rows reduced to one actual
result row, zero per-row `hidden` mutations, stable search/table/header identity,
equivalent-query row identity, full clear/empty behavior, filtered bulk selection
and unchanged business JSON. Existing Hebrew/case, year/filter, edited-note,
summary, modal/event, drag/drop and desktop/mobile cases pass locally. Module,
readability and eager startup limits remain in force, including the existing
2,396,000-byte / 402-module Orders source ceiling. Full CI repeats the same 1k/10k
measurement and retains the new report for direct before/after comparison.

This closes the demonstrated per-row search presentation work. Large unfiltered
tables, Bank history rendering, editor snapshot cost and physical weak-machine
behavior remain separate measured costs; the change makes no claim about their
timings or live providers.
