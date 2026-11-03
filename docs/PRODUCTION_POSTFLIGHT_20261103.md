# Production deployment, 2026-11-03

The operator explicitly authorized deployment after static publication correctly
stopped on a missing live migration. Source `cecb4baba526260b676997af0ac30e1ea1ec8697`
passed [all 16 full verification jobs](https://github.com/218218y/netunim/actions/runs/41578981610)
before any upload. No deployment guard was disabled.

## Database and Edge rollout

The live ledger contained 52 migrations. All identities and SQL hashes matched the
exact reviewed prefix. CLI dry-run selected only
`20261103120000_google_oauth_intent_authority.sql`. The existing authenticated
baseline was reproduced in disposable PostgreSQL and the reviewed upgrade candidate
was derived from the actual migration chain, without business data.

Both Google functions temporarily returned HTTP 503 with no-store/Retry-After.
After both endpoints confirmed maintenance, a 420-second drain exceeded the
[documented 400-second maximum worker lifetime](https://supabase.com/docs/guides/functions/limits).
The CLI applied the canonical migration, preserving its reviewed version and
skipping vault/role/seed changes. The three credential-free authority RPCs and
intent metadata table were then verified before normal Google handling resumed.

| Edge function | Previous version | Verified final version |
| --- | ---: | ---: |
| google-calendar-oauth | 40 | 42 |
| google-drive-oauth | 20 | 22 |
| morning-documents | 50 | 51 |
| morning-expenses | 30 | 30, all deployed files already matched |

The intermediate Google versions served maintenance only. Final deployed source
files match reviewed local files, including bounded JSON and Google HTTP helpers.
No Google grant was revoked as part of rollout and no document issuance was
attempted. Existing connection credentials were not migrated or cleared.

Live endpoint checks passed: Google POST without user authentication returns 401,
callback without state returns 400, and CORS OPTIONS returns 200. Morning Documents
also returns 401 for unauthenticated POST and 200 for OPTIONS. Browser roles cannot
execute the new service-role authority RPCs; intent RLS is enabled.

The authenticated `2026-11-03T07:06:03.670813Z` catalog capture verified all 53
migration identities and SQL hashes, application tables/columns/constraints/indexes,
functions/security/grants/policies/triggers, pg_cron settings and exactly the two
reviewed active retention jobs. The capture is retained in
`supabase/audit/production-postflight-20261103T070603670813Z.json`, bound to
`supabase/audit/morning-schema-live.json` and the refreshed deployment receipt.
The offline release gate now confirms that no database release is pending.

## Static publication

The normal fast-deploy orchestrator checked both applications before uploading
either and repeated database verification before each upload. System CA support
resolved the network certificate path for Wrangler; TLS validation stayed enabled.

| App | Permanent URL | Immutable deployment | Verified release |
| --- | --- | --- | --- |
| Orders | [orders.bargig-furniture.com](https://orders.bargig-furniture.com/) | [e83a972f](https://e83a972f.bargig-orders.pages.dev/) | `orders-app-shell-build-bea409d11c6ab138d289c326` |
| Kupa | [kupa.bargig-furniture.com](https://kupa.bargig-furniture.com/) | [fbc12dca](https://fbc12dca.bargig-kupa.pages.dev/) | `kupa-app-shell-build-d80a01fbec95676e29a16e3b` |

The uploaded releases contain 360/340 files and 59/39 offline resources. Existing
identical retained payloads were reused; their original snapshot commit labels
remain unchanged. The present source was independently built/verified against
those same release IDs and file inventories. Upload receipts and exact rollback
payloads remain under `.work/deployments` and `.work/releases`.

On both permanent domains, HTML references the expected application module and
serves the expected release/security headers. Service Worker, application entry JS
and manifest bytes match the verified payload. HTML itself is modified by
Cloudflare analytics and NetFree injection, so no claim of exact served HTML bytes
is made. Immutable-domain worker and entry JS also match; NetFree returns HTTP 418
for the immutable root HTML and manifest. Those probes remain BLOCKED, with no
filter bypass or fabricated PASS. Local logs and individual HTTP observations are
retained under `.work/deploy-20261103`.

Twenty-three focused Supabase release/receipt contracts pass after the evidence
refresh. Application behavior, financial models, Storage V2 and Journal/ACK
protocols are unchanged by this evidence-only follow-up. Full CI is required
before merging this receipt/documentation change.

## Remaining acceptance

Real Google authorization/revocation, Morning financial issuance and Bank/Credit
provider failure exercises remain NOT RUN and require separate safe test accounts.
This release does not decide or change project-wide Google revocation policy.
Installed Windows/physical acceptance remains the explicit test-lab backlog; HTTP
and CI results do not promote those rows to PASS. Further broad refactoring remains
paused pending a demonstrated defect or business need.
