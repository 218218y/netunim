# Financial system security hardening — 2026-11-08

## Issuance authority and browser headers

`morning-documents` now denies reserve, preview, create and reservation abandonment
unless the authenticated user has the server-managed boolean claim
`app_metadata.morning_documents_write = true` or their exact user ID appears in
the Edge secret `MORNING_DOCUMENT_WRITE_USER_IDS` (comma-separated).
Document readers and report readers do not inherit issuance authority.
User-editable metadata and request-body grants are ignored. The existing owner
checks, operation ledger, reconciliation and duplicate-issuance fencing remain.
Status/reconciliation and access to one's verified documents remain available to
avoid stranding an already issued financial document after revocation.

Deployment: grant the existing authorized issuer the server claim or secret before
deploying this function; an unset grant intentionally denies issuance. Set
`MORNING_ENV=production` explicitly for the production deployment. An omitted
environment now selects sandbox; misspellings continue to fail closed. Do not put
these grants or credentials in browser configuration. Deploy the function through
the existing Supabase release process; a Git merge alone does not deploy it.

Both sites send HSTS for one year without includeSubDomains/preload. The opener
policy is `same-origin-allow-popups` to retain OAuth popup compatibility.

Tests exercise the actual Edge handler with denied users, forged grants, readers,
reporters and exact issuer IDs, proving denial before database or Morning access.
Existing issuance/recovery and read-scope tests remain mandatory.

## Live configuration and remaining work

The connected Supabase tool refused the security-advisor read with a permission
error on this run. Live Auth settings, users, MFA and deployment state are **not
verified or changed**. The review's previous snapshot is not current evidence.
MFA enrollment needs the account owner and an authenticator/recovery plan. Enable
leaked-password protection and disable public signup in the live project after
checking its supported plan/settings. Do not revoke all sessions without an
account recovery path.

Further boundaries to implement/verify: production-only Bridge origins, document
filesystem scope, complete local session deletion, diagnostics minimization and
retention, key rotation/scopes, Google token encryption/PKCE, internal SQL grants,
isolated staging, and automated secret/dependency scanning. HttpOnly auth requires
a separately tested server/session architecture; browser encryption with a key
stored beside the ciphertext does not solve XSS.

Every computer running a Bridge needs its own runtime update after these changes.
Windows encryption, Defender, account privileges, lock timeout and installed ACLs
must be checked on each computer; code or CI cannot certify those settings.
