# Morning recovery and operations center

The Morning ledger records verified issuance separately from check registration and bank linking. The Orders Storage V2 journal owns debt changes. Orders retains the pending recovery context, including the operator’s allocation choices, until the journal confirms its commit and server follow-up is complete.

## Automatic execution paths reviewed

| Path | Authority and write path | Recovery evidence |
| --- | --- | --- |
| Morning check trigger and `morning-check-registration` Cron | Private continuation accepts an operation ID, locks the ledger row and imports only verified, frozen payment intent. The registered V2 writer is scoped to shared checks. | The shared-check write and payment-index registrations commit together. Failure kind, timestamps, attempt count and next retry are recorded in the ledger. |
| Check matching after a bank snapshot and `check-bank-refresh` Cron | Both reach the private owner-scoped bank reconciliation implementation. The public matching RPC keeps financial MFA. | The refresh queue and its error field track unfinished matching. |
| Backup and sync-ledger retention | The database owner runs the private prune functions from the two scheduled retention jobs. | Cron records the execution outcome. These jobs delete expired operational history through their existing retention rules. |
| Morning income and expense Edge requests | User sessions are validated and checked for enrolled MFA. Issuance has additional feature permissions. Server operations use a scoped ledger and the write authority of the corresponding Edge function. | Income reservations, lookup and payment evidence survive ambiguous provider responses. Expense upload, OCR, vendor and reconciliation flows keep their own ledgers. |
| Verified bank links | The Morning Edge invokes the service-role RPC after document verification. The RPC checks operation ownership, transaction ownership, transaction eligibility and document type. | The owner and operation uniquely identify the link. Status can read a saved link and recovery can create a missing eligible link. |
| Orders and Kupa background saves, startup and bank feed | Browser workers retain the current authenticated account, local writer leadership and the Storage V2 write scope. Their financial RPCs enforce the applicable MFA boundary. | The journals, cloud revision and outbox identify incomplete work. Sync incidents report stalled or blocked writers across the account. |
| Google Calendar, Contacts and Drive | User actions pass through the MFA-assured Edge handlers. OAuth callbacks authenticate the provider flow using the saved authorization state. Calendar outbox work resumes under the current user session. | The Calendar outbox and sync incident report pending writes. The OAuth state and connection status track the integration separately. |

The Morning background import was the confirmed mismatch between server authority and a user MFA gate. The production operation for document 3972 was checked with a read-only query. Its ten immutable intents, ten registration rows and ten distinct check entries total ₪9,300.

## Recovery behavior

- **Check issuance status** reconciles an uncertain issuance with Morning using reads. The operation attempt claim is owner- and environment-scoped. A stale provider response cannot publish after a newer attempt has claimed the operation.
- A verified check import can retry immediately under the service-only RPC with a 30-second per-operation cooldown. Cron uses the same writer and skips locked records. Contention is retried after a minute. Transient and unexpected failures back off and stop after five failed attempts. Authorization and validation failures stop automatic attempts on the first classified failure. An older `mfa_required` failure from before classification becomes eligible for the corrected writer while retaining its attempt count.
- In either site, Settings shows delayed verification, check evidence, check registration and bank linking from the owner’s cloud ledger. The fixed incident control stays visible while work is active. Acknowledgement is scoped to the current tab session. Recent check registrations are available for fourteen days, capped at twenty records. The active list is capped at fifty rows.
- Both sites share the incident monitor’s foreground refresh cadence. The list uses low-priority requests and the existing account-epoch fence. Reconnection refreshes the list. A failed refresh leaves previously reported operations visible in that tab.
- The Orders center can resume the locally bound debt workflow when the operation IDs match. A debt reference is available on the originating device before sync and on another Orders device after a stored document link reaches it. The Morning ledger does not hold debt allocation choices or serve as a cross-device debt authority.

## Verification

The PostgreSQL fixture covers AAL1 denial, AAL2 access, service-only RPC grants, atomic rollback, historical retry with 64 failures and eligibility before its original schedule, exact ten-check registration, and owner/environment isolation. The browser fixture uses independent Orders and Kupa profiles to exercise discovery, acknowledgement, one retry and convergence. The staging project uses synthetic data and its own provider configuration.
