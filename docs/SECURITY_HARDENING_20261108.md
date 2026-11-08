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

## Document file authority and diagnostic privacy

Document Bridge v46 requires a local `roots` list in `config.json`; the installer
opens the existing local folder configurator when it is missing. The installed
configuration launcher now supports current versioned runtimes. No website API
can enlarge this list. Configuration saves preserve the roots list.

Native Everything searches/counts/PDF inventory receive a root path expression
before pagination. This is an efficiency layer, not the security decision: rows
are independently checked against both the selected path and its current
`realpath` before publishing an opaque ID. Every file command rechecks current
permission and resolves its filesystem target again. Sibling-prefix paths,
traversal, device paths, alternate streams, revoked roots and escaping Windows
junctions are rejected. PDF maintenance only extracts admitted rows. Root target
changes during the process lifetime fail closed. The filesystem tests run on
Windows and Linux with real files/junctions or symlinks. This does not claim
protection from arbitrary malware running as the same Windows account or a
complete Windows filesystem race-proof sandbox.

Bank Bridge v76 writes schema-v4 structural diagnostics: field names, bounded
sample structures, activity type codes and boolean presence indicators. Arbitrary
text, account/branch/check/reference numbers, amounts and URLs are redacted;
existing card masking retains at most the final four digits. Samples are capped
at 64 per account role. Previous detailed schema versions are purged at startup.
The latest file expires after 24 hours, with physical deletion on startup/read
and an hourly sweep while the Bridge is running. When the service is stopped,
deletion occurs on its next start. `node server.mjs --clear-diagnostics` explicitly
removes bank and credit-data diagnostic snapshots. Stop the service before using
the maintenance command. These controls do not retroactively remove exported
copies or operator backups.

The two supplied Supabase CSV exports both record `2026-11-08T14:00:05.222Z`:
16 `rls_enabled_no_policy` INFO rows; 27
`authenticated_security_definer_function_executable` WARN rows; one
`auth_leaked_password_protection` WARN row. They are a current exported snapshot,
not proof of exposed data or a live audit of function bodies/Auth settings.
Do not add permissive policies or revoke application RPCs just to clear lints.

## Locked runtimes and automated scans

All Bank runtime packages now belong to the ordinary dependency list and one
integrity-protected lockfile. The second unlocked `npm install --no-save
--package-lock=false` step is removed. Installation uses `npm ci --ignore-scripts`
and explicit browser provisioning/doctor checks. Both Bridges use the same
checksum-verified private Node 24.21.0 installer; the Bank startup launcher selects
that private runtime rather than relying on the global Windows Node installation.
The shared-asset generator keeps the two installer copies synchronized.

The registry audit initially reported 11 high and five moderate Bank package
findings. A locked Puppeteer 25.16.0 upgrade, including the scraper's transitive
Puppeteer resolution, removed all high/critical findings. Compatibility is tested
with the actual `israeli-bank-scrapers` package initializing, using and closing a
real Chromium in a disposable profile. External provider navigation is blocked.
This is package/browser compatibility evidence, not a successful live bank login
or issuer WAF canary. The existing production bank/session/provider tests remain.
Four moderate Bank findings and three moderate build-tool findings remain in the
registry snapshot and must be tracked; no claim of zero known vulnerabilities is
made. Avoid `npm audit fix --force` downgrades of the financial scraper.

Security CI scans redacted Git history with checksum-verified Gitleaks, runs
extended CodeQL for JavaScript/TypeScript and Python, audits both lockfiles, and
exercises the real installed package/browser contract. High/critical npm and
CodeQL findings block their jobs. The scanners run on PRs, main and weekly, with
read-only repository access except the CodeQL result upload permission. Dependabot
now includes both npm manifests and limits concurrent update PRs. Branch rules
still need to require these named checks for future merges; adding a workflow by
itself does not change GitHub branch protection.

See [the exported RPC inventory](SUPABASE_EXPORTED_SECURITY_INVENTORY_20261108.md)
for all 27 function locations from the supplied Supabase CSV. Live definitions
and grants still require access to the correct project.

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
