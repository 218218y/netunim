# Expense intake stability follow-up

## Verified defects and retained guarantees

The current queue called `selectNextFile()` on a source change and reset the form. The first PDF attachment also reset an already-entered manual invoice. This was reproduced by native browser tests, independently of provider writes. Work drafts now retain all fields, manual amount overrides, reporting period, canonical selections and local source evidence per queue entry, in account-scoped memory only. Returning to the same unchanged file rechecks its OCR guard and restores the draft without applying recognition over it. Catalog refresh also preserves edits. Removing an edited draft requires confirmation. Refresh/close warns about unsaved work; disposal/account changes release all drafts and source resources.

Local removal is explicitly labeled removal without saving. It creates neither an expense nor a durable follow-up task. The source file and financial recovery journals remain separate concerns.

The existing server already blocks matching supplier, invoice number, document type and source year, including changed dates/amounts inside that identity. This stronger accounting boundary must be retained. Financial operation IDs, unique ledger identities, CAS dispatch, no replay after uncertainty, protected P identities and income-document isolation are unchanged by the work-draft stage.

## Acceptance evidence

`runtime_morning_expense_drafts.py` exercises desktop/mobile round trips with distinct manual invoice numbers, dates, reporting months, net/VAT/gross values, allocation and canonical classifications; attaching a first PDF to manual input; catalog refresh; cancelled/confirmed draft removal; unload warning; no persistent invoice text; and account isolation. It performs zero real provider or financial writes. Existing PDF/OCR/manual regression suites remain required in full CI.

## Remaining stages

The next server stage must durably bind intended source metadata before financial dispatch, list incomplete source operations after recovery, verify reselected and provider source bytes, audit exceptional manual decisions and atomically coordinate exact source hashes with OCR reservations. A separate production acceptance report must distinguish authenticated read-only checks, synthetic provider tests and an explicitly approved real accounting intake.
