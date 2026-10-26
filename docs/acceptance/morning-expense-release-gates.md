# Expense intake release gates

The code merged to main remains restricted to authorized Sandbox writes. These gates describe the evidence needed to open a new path; toggling an environment flag alone cannot enable Production or automatic P creation.

| Path | Evidence obtained | Remaining acceptance |
| --- | --- | --- |
| Regular invoice and credit | Real POST/GET, explicit VAT, positive credit amounts; signed report reversal once | Deployment in a persistent Supabase test environment, then controlled rollout |
| VAT reporting periods | Both September and October monthly dates, late allocation confirmation, combined bimonthly report | Business review of real workflow |
| Protected P suppliers | Two canonical identities; P POST/GET retained classification, tax identity and manual VAT; user saw P in Morning | Official PCN874 export, including both intended supplier identities and correct invoice numbers/amounts |
| Existing expense file | Real signed S3 form, 204 acceptance, later canonical file URL | Operational rollout; URL presence does not prove byte identity or accountant approval |
| OCR draft | Real asynchronous draft with source file and amounts | Supported approval API and exact readback; OCR number was incorrect in the probe |
| Interrupted creation | Durable reservation, state CAS, exact canonical reconciliation; native database constraints and desktop/mobile tests | Persistent test deployment acceptance |
| Interrupted upload | Generation CAS, one ticket winner, no replay after uncertain delivery; legacy tickets stay blocked | Persistent test deployment acceptance |

Sandbox credentials and business identities are private configuration. They must not be committed or substituted for income credentials. Source-file bytes are sent directly to Morning's S3 form, without Supabase invoice storage.

For a Production-only limitation, begin with a read-only comparison of an existing P expense and the existing PCN874 export. Do not generate a real invoice or close/report an expense just to prove the integration. Capture a sanitized receipt and keep the dedicated expense permissions separate from reports and income issuance.

The OCR path deliberately stops at draft creation. An expense `close` endpoint is not an approval endpoint. If Morning does not publish a supported approval contract, draft approval stays in Morning; manual invoice entry with an attached source file remains the complete supported site workflow.
