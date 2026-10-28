# Reporting history navigation

History now has independent year and bimonth selectors. No selection preserves newest-first infinite browsing. Selecting a year starts at its newest eligible bimonth and stops at January; choosing a bimonth reads only that complete reporting period, including all its API pages before sorting and displaying totals. Empty selections do not cause adjacent years or periods to load. Refresh retains the selected range.

Text search uses the selected reporting range, validates returned reporting dates and labels completion within that range. Clearing the year restores account-wide browsing/search. Intake reporting preferences and invoice source dates remain independent; an older invoice reported in the selected period belongs to that period. Future periods are omitted and invalid or mismatched year/period values are rejected.

Filter changes cancel and fence old requests. Browser coverage verifies actual delegated change events, retained keyboard focus, exact request bounds, refresh and an untouched intake draft. Deterministic tests cover empty periods, year boundaries, stale pages, scoped search and out-of-range provider results. Deploy complete Orders frontend assets; no additional backend change is needed for these filters.
