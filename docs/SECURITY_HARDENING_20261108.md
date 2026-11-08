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

## Local origins, installation secrets and bank disconnect

Bank defaults to allowlisting exactly `https://bargig-furniture.com`,
`https://bargig-orders.pages.dev`, and `https://bargig-kupa.pages.dev`.
Local native clients still require a token for private actions. Development and
custom origins must be explicitly listed in `origin-policy.json`; previews and
localhost are not implicitly trusted. An explicitly configured `legacy-reflect`
remains an administrator compatibility escape hatch, never an automatic fallback.
Document Bridge also defaults to these three exact origins, and historical
wildcard entries in persisted configuration no longer grant access. Add only
individual necessary origins locally; do not authorize production credentials
for preview deployments. Existing pairing tokens are preserved by upgrades.

Neither installer copies a token to the clipboard. Document installation reports
no longer include a token. Pairing is an explicit local action using
`bridge-token.txt`; that file must never accompany a support report. Previously
exported installation reports/backups may still contain the old token; remove
them and rotate a potentially exposed token. This is not yet a one-time pairing
protocol or separate per-site scoped credentials.

Bank disconnect now clears the saved session URL, stops only Chrome/Edge
processes launched for the exact private bank profile, waits for exit, removes
the profile with bounded retries and verifies its absence. Cleanup failure is
an error, not a successful disconnect. Credential replacement/import also clears
the old browser identity before installing another identity. This deletes local
session state; it does not revoke a session at the bank's servers.

The Supabase reconnection later succeeded but exposed a different project
(`paqzrxrvowwndevqptdk`), not this application's `bupoidcurcxuypfrjqio`.
The application project still denied access; no unrelated project was changed.

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
