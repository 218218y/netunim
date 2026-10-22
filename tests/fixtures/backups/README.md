These are synthetic earlier-schema inputs accepted by the current portable
backup validators: Orders schema 3 and Kupa schema 5/state 3. They contain no
customer data and are not represented as exports collected from old installed
applications. Optional later fields are absent; the Kupa card intentionally has
no ID to exercise the retained stable legacy-position migration. Both inputs
include a genuine zero check and an earlier note without timestamp defaults.

The native file acceptance suite checks import, Main/Shared persistence, hard
process restart, stable card identity and rejection of future/cross-app formats
without changing either journal. This sample set is not a claim about every
historical format or every retained user backup.
