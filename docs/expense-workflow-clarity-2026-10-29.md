# Expense intake workflow clarity — 2026-10-29

The existing progress indicator was above the submit position, file selection
explicitly moved the chosen item to the queue head, field review text added
unequal heights below controls, and the source icon navigated to Morning's
attachment-download endpoint. These were confirmed in the implementation.

After approval, the first progress stage scrolls into view once. Subsequent
stages do not pull the user away from the document. Verified completion reveals
the next workspace and uses the existing application toast for completion and
the new PDF's recognition result. Failed or uncertain operations still remain
on the current invoice.

Queue order is assigned once per validated selection and retained in memory.
Choosing another item changes the selection and restores its working draft.
Rendering preserves the page, view and queue scroll offsets and restores focus
without scrolling. Automatic missing-field focus also avoids scrolling; explicit
field-review navigation continues to focus the requested field.

Recognition uses compact, accessible status/source icons at the label edge and
colored field borders. Detailed warnings above submission remain available.
Controls align at their lower edges even when a narrow label wraps. The saved
reporting period remains unchanged across calendar boundaries. A yellow
“previous period” badge appears whenever it precedes today's bimonthly period;
this is a reminder, not a change to accounting or validation rules.

The expense source icon now opens an in-site native dialog. The authenticated
`source_file` read action obtains the canonical expense, validates its provider
URL, reads at most 20 MiB with a timeout and no redirects/cookies, and accepts
only PDF/JPEG/PNG signatures. It returns private bytes with `no-store`, `inline`
and `nosniff`; it never sends provider URLs to the viewer. The existing PDF.js
raster preview provides pages and zoom. Download is an explicit blob link.
Closing, switching accounts or disposing aborts requests and releases resources.
No expense creation, upload or ledger mutation is involved in this read action.

Focused Node tests cover source permissions/environment, original bytes,
response headers, unsafe URLs, malformed/oversized/stalled streams and queue
ordering. Native desktop/mobile tests cover stable queue and scrolling, retained
edits, visible progress and next invoice, aligned fields, reporting reminders,
real PDF rendering/navigation/download availability and account-change cleanup.
Existing expense, OCR, recovery, local recognition and reporting suites remain
in the full CI gate. Provider simulations are not evidence of a financial write.

Deployment requires the matching server function before the new static client.
There is no database migration. If rollback is needed, restore the prior static
release; the added read action is backwards compatible with older clients.
