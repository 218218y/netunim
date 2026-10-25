# Credit detail read models, 2026-10-25

Orders Finance and Kupa Credit now select detail rows in separate pure read
models. Each receives retained months/upcoming rows, a small captured display
query, a calendar reference and a synchronous matcher. Neither receives the
application model, controllers, storage, browser globals or write commands.
The view applies the returned focus and retains HTML, paging and DOM lifetime.

The canonical `shared/credit-detail-policy.js` owns the existing date, nominal
cycle, period, section and future-month predicates. `credit-detail-controls.js`
keeps its established exports while owning controls and DOM replacement. The
sync-assets tool remains the sole producer of both deployed Shared copies.
There is one policy implementation, with no new cache or financial writer.

Orders previously derived detail months in the section, again in the detail
table, and a third time for period modes; upcoming rows were also derived twice.
The section now captures each collection once and passes one report to its
table renderer. This removes reproduced redundant selection work. It is not a
claim to have resolved the separately measured layout/paint bottleneck.

Kupa continues to use its existing revision selector and 150-row result pager.
Its monthly totals/partial flags are recalculated after account/provider/card
filtering, before text search. Upcoming totals still cover the entire filtered
upcoming set. Orders still consumes its existing reporting filters and prefers
the current month key, whereas Kupa prefers a month containing a future actual
debit. Orders clears period focus; Kupa retains its prior UI focus outside month
mode. These policies remain separate and are tested explicitly.

Strict checkJs now covers both actual read-model bodies and the canonical
policy, including generated policy consumers. Negative fixtures reject async
matchers, textual money, numeric calendar references and malformed card focus.
Compiler mutations replace actual numeric result counts with text. Frozen-input
behavior cases exercise periods, history, filters, focus recovery, partial
amounts and complete counts independently of search results. Existing native
Credit/Finance, scroll, focus and financial cases remain mandatory in full CI.

The extraction adds two eager modules to each site (Kupa 312, Orders 408).
The graph source ceilings increase by 5 KB and 4 KB respectively to account for
explicit contracts/adapters and readable policy source. All browser timing
limits and other module-size/readability gates remain in force.
