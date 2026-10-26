# Expense intake release gates

The deployed configuration remains authorized Sandbox only. The code now has a separate, disabled-by-default Production pilot path: dedicated credentials distinct from income keys, one explicit pilot identity, canonical Production supplier protection, ordinary read/write grants and separate create/upload switches. Changing the environment alone cannot enable it. Automatic P and OCR approval remain blocked independently.

| Path | Evidence obtained | Remaining acceptance |
| --- | --- | --- |
| Regular invoice and credit | Real POST/GET through deployed Edge with persistent Supabase ledger, explicit VAT, positive credit amounts; signed report reversal once | Dedicated Production credentials/profiles, read acceptance, then an actual business expense for the one-user pilot |
| VAT reporting periods | Both September and October monthly dates, late allocation confirmation, combined bimonthly report | Business review of real workflow |
| Protected P suppliers | Two canonical identities; P POST/GET retained classification, tax identity and manual VAT; user saw P in Morning | Official PCN874 export, including both intended supplier identities and correct invoice numbers/amounts |
| Existing expense file | Real signed S3 form, 204 acceptance, later canonical file URL | Operational rollout; URL presence does not prove byte identity or accountant approval |
| OCR draft | Real asynchronous draft with source file and amounts | Supported approval API and exact readback; OCR number was incorrect in the probe |
| Interrupted creation | Durable reservation, state CAS, exact canonical reconciliation; native database constraints and desktop/mobile tests; persistent Supabase fixtures | Production pilot acceptance; cloud fixtures do not claim a live network fault during financial POST |
| Interrupted upload | Generation CAS, one ticket winner, no replay after uncertain delivery; legacy tickets stay blocked; real PDF linked through deployed Edge | Production file acceptance before enabling the separate upload switch |

Read and write cloud evidence is recorded in `morning-cloud-read-2026-10-26.json` and `morning-cloud-write-2026-10-26.json`. Synthetic Production tests exercise the exact writer/upload state machines and environment rejection; they are not proof of financial writes to the live Morning account. The intake guide lists activation and rollback steps, including keeping recovery available while new writes are disabled.

Sandbox credentials and business identities are private configuration. They must not be committed or substituted for income credentials. Source-file bytes are sent directly to Morning's S3 form, without Supabase invoice storage.

For a Production-only limitation, begin with a read-only comparison of an existing P expense and the existing PCN874 export. Do not generate a real invoice or close/report an expense just to prove the integration. Capture a sanitized receipt and keep the dedicated expense permissions separate from reports and income issuance.

The OCR path deliberately stops at draft creation. An expense `close` endpoint is not an approval endpoint. If Morning does not publish a supported approval contract, draft approval stays in Morning; manual invoice entry with an attached source file remains the complete supported site workflow.
