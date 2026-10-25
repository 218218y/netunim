# Supplier search DOM lifetime, 2026-10-25

The existing scoped probe reproduced 10,000-row Orders search at a median
730.5 ms on native CI CPU and 3,652.1 ms at CPU x4 (three unprofiled samples).
Attribution samples spent most time in style/prepaint/layout rather than the
search predicate. Source: run 40212617355, e46f60aaa70b65ad8d7837be63e258e7d0bbdc46.
These Linux CI figures are synthetic, not normal/weak Windows acceptance.

The Supplier view now detaches unmatched rendered rows from its own table body
and reattaches the same nodes in their original order when a query changes.
Hidden flags remain accurate for retained references. This avoids keeping all
10,000 descendants connected after narrowing to one transaction. The table,
scroll host, search input, row inputs and unsaved values are not recreated.
All-matching and equivalent-result searches do not replace the body again.

A view-private weak map belongs to the exact rendered tbody. A full render
creates another tbody and invalidates its DOM index by identity; the old entry
can be collected. It is not a financial/model/search cache and has no revision,
storage or write authority. The existing model-backed financial summary,
predicate, query scheduling, bulk command owner and move-mode bypass remain.
Detachment does not reduce total JS-retained row memory while this table lives;
the purpose is reducing connected DOM work, not a claim of heap reduction.

Native event tests cover case/Hebrew/summary parity, filter/year rerender, inline
edit invalidation, empty-query restoration, stable row/input identity, uncommitted
drafts, bulk selection and the same scroll host. Existing move/edit/scroll and
performance gates remain required. Source budgets are unchanged. This edited
module adopts two-space code indentation without changing any literal/template
content; parsed structure was compared before/after that whitespace-only pass.

The same existing probe now supports a baseline Supplier view from Git, installed
only in each disposable site before lexical instrumentation. The two variants
run on the same runner with identical seeded counts, CPU rates and sampling.
Reports retain view source hashes, connected-row count, heap/DOM counters and
separate trace/profile attribution. Three samples report median/range, not p95
or a physical-machine SLA. The bounded campaign must demonstrate a useful
improvement before this change is merged; all valid user rows remain reachable.
