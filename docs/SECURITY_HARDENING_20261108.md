# Financial system security hardening — 2026-11-08

## Latest live verification and Google credential phase

The connection was re-established later on November 8. Both the Supabase connector
and the authenticated CLI now reach the correct project `bupoidcurcxuypfrjqio`
(`netunim`, ACTIVE_HEALTHY). Earlier connection-limit notes below describe the
initial work, not the current access state. Live inspection found one user, no
verified MFA factor, one Calendar connection and one Drive connection, and RLS on
every public table. The live Advisor confirms the exported 16 INFO / 27 RPC WARN
findings and disabled leaked-password protection. No credential values are
included in this report.

Both Google OAuth handlers now encrypt refresh credentials using AES-256-GCM,
fresh 96-bit IVs and authenticated project/service/owner/key-ID binding. Key
material is held only in Edge secrets. HKDF separates the encryption and PKCE
keys. New authorization requests use S256; the server derives the unpredictable
verifier from a fresh 256-bit random state using HMAC, bound to the owner, service,
project and exact redirect URI. Only the challenge goes to the browser. The
existing single-use state consumption, current-intent publication and connection
compare-and-set fencing remain authoritative. There is no extra plaintext
verifier column or schema migration.

Configure `GOOGLE_OAUTH_TOKEN_KEYS` as a JSON object mapping a short key ID to a
base64-encoded, cryptographically random 32-byte key, and
`GOOGLE_OAUTH_TOKEN_ACTIVE_KEY` to that ID. Retain old keys while credentials or
in-flight states still depend on them. Changing the active key re-encrypts an old
credential after a successful refresh, with compare-and-set confirmation before
returning an access token. Back up keys separately in the operator's secret
manager; losing them requires reconnecting Google.

Plaintext credentials are rejected by default. For a controlled migration only,
`GOOGLE_OAUTH_ALLOW_LEGACY_TOKENS=true` permits existing plaintext and upgrades it
on the next successful refresh; remove this temporary permission after verifying
both tables contain only `ngc1` envelopes. Corrupted envelopes never fall back to
plaintext. Alternatively migrate credentials with trusted operator tooling or
reconnect each integration. Old, pre-PKCE pending authorization attempts must be
restarted after deployment. Disconnect still commits local unlink if key recovery
or remote revocation fails and reports revocation as unconfirmed.

Google handlers admit only the three exact production origins listed below.
Additional exact origins require explicit `GOOGLE_OAUTH_ALLOWED_ORIGINS`; public
preview and localhost origins receive no implicit access. Native calls still
require user authentication. Errors expose fixed diagnostics, never database
error messages or credential contents. Scope requirements remain Calendar event
editing/list discovery and read-only Drive; narrowing Drive to `drive.file` would
change the existing whole-drive document search feature.

Acceptance tests exercise real WebCrypto and production handlers, ciphertext
tampering, cross-owner/service/project substitution, absent keys, plaintext
rejection, key rotation, controlled migration, PKCE exchange/replay and foreign
origin denial, alongside the existing concurrent disconnect/replacement tests.
Deployment and live ciphertext conversion must be recorded separately; a Git
merge does not update Edge functions.

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

Document Bridge v47 requires a local `roots` list in `config.json`; the installer
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

Bank Bridge v78 writes schema-v5 structural diagnostics: reviewed field names, bounded
sample structures, activity type codes and boolean presence indicators. Arbitrary
text, account/branch/check/reference numbers, amounts and URLs are redacted;
unreviewed dictionary keys become anonymous field positions, and source/cheque
labels come only from explicit internal enums. This also removes personal data
placed in property names. Schema v4 files are purged on startup after upgrading.
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
checksum-verified private Node 24.22.2 installer; the Bank startup launcher selects
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

The initial full-history Gitleaks run reported 65 generic-key matches. Each was
checked against its exact committed source: 48 policy/integrity SHA-256 digests,
four generated vendor digests, six synthetic fixtures/storage labels, three
storage-key source expressions, two public Supabase publishable keys, one
ciphertext-variable source expression and one public storage-key label. These
are recorded as exact commit-bound fingerprints in `.gitleaksignore`; there is
no blanket exclusion for test files, hash-shaped tokens or config files. A new
secret in a later commit remains detectable. The subsequent local redacted scan
covered 1,383 commits / 70 MB and found no additional matches. This is scanner
evidence, not a guarantee that no secret has ever appeared in repository history.

All authorized Morning write routes now reject invalid environment settings,
including reservation abandonment, before reading or mutating any operation.

## Live configuration and remaining work

The connected Supabase tool refused the security-advisor read with a permission
error on this run. Live Auth settings, users, MFA and deployment state are **not
verified or changed**. The review's previous snapshot is not current evidence.
MFA enrollment needs the account owner and an authenticator/recovery plan. Enable
leaked-password protection and disable public signup in the live project after
checking its supported plan/settings. Do not revoke all sessions without an
account recovery path.

Remaining boundaries: MFA and live Auth configuration, per-site scoped pairing
keys and one-time pairing/rotation UX, Google token encryption/PKCE, complete
private SQL grant/function review, isolated staging, preview access controls and
release branch protection for the new security jobs. HttpOnly auth requires
a separately tested server/session architecture; browser encryption with a key
stored beside the ciphertext does not solve XSS.

Every computer running a Bridge needs its own runtime update after these changes.
Windows encryption, Defender, account privileges, lock timeout and installed ACLs
must be checked on each computer; code or CI cannot certify those settings.


## Additional CodeQL review and rollout actions

A genuine PDF stat/read growth gap was replaced with the existing bounded
single-handle preview reader, including a one-byte overflow check, cancellation
and guaranteed handle closure. The AcroForm/worker suite passed against the
checksum-verified private Node 24.22.2 executable; the Windows native runtime test also verifies the archive and executable hashes.

CodeQL's reviewed constraints are stored by rule, exact repository path and
normalized source SHA-256. The record explains static contract assertions,
intentional file-growth attack tests, local calendar connection preferences
(which grant no Google/backend authority), and lock-owner observation inside the
private application directory. The last remains a local filesystem race
constraint against an attacker already able to modify that Windows account's
private application files; it is not represented as hostile same-user isolation.
There is no global rule exclusion or blanket test-directory exception. Source
changes invalidate the review record and unreviewed high/critical results fail.

On the current computer, read-only checks found Defender antivirus and real-time
protection enabled, signatures updated 2026-11-07T22:48:46Z, and no Allow ACL rows
for Everyone, Authenticated Users or BUILTIN Users on either Bridge data root.
BitLocker could not be verified without supported tools/administrator access.
No machine settings or installed runtime were changed by these checks.

After the merged code is pulled on each of the three computers, reinstall Bank
and Document Bridges, select only business folders in the local configurator,
and pair explicitly using that computer's local token file. Do not send token
files in support exports. Verify local disk encryption, screen lock, Windows
account protection and Defender on every computer. A Git pull alone does not
update the stable installed runtime folders or Startup launchers.

Cloud release separately requires the authorized issuer grant and explicit
production environment before deploying Morning, plus MFA enrollment and Auth
configuration on project bupoidcurcxuypfrjqio. These live steps were not performed
through the unavailable/mismatched Supabase connection.


The pinned Node runtime was advanced to 24.22.2 on Windows and in the offline
Linux bundle. This includes the high-severity TLS/DNS/Brotli fixes in the
[official 24.22.1 security release](https://nodejs.org/en/blog/release/v24.22.1)
and the later fixes in [24.22.2](https://nodejs.org/en/blog/release/v24.22.2).
Archive and executable hashes were checked against the official Node SHASUMS;
old 24.21.0 distribution archives were removed from the current tree. Existing
installed runtimes are updated only when the operator reinstalls the Bridges.

The additional scanner review distinguishes retry jitter from credential
randomness, read-only file handles from temporary-file creation, and Windows
password-age timestamps from actual passwords. Inventory modal escaping is
covered by expanded real Chromium injection tests. Each reviewed rule/path is
bound to the complete source digest; these are not directory-wide exclusions.
