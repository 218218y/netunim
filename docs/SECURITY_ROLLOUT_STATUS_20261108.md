# Verified rollout status — November 8, 2026

This supplements the implementation report. It records live changes separately
from Git changes and supersedes the earlier notes about unavailable Supabase
access. It is not a certificate that every item in the original program is done.

## Production changes actually applied

The connector and CLI both reached `bupoidcurcxuypfrjqio` (`netunim`). Public
signup is disabled and the minimum length for new passwords is 12. The public
Auth settings endpoint independently confirmed signup denial. No existing
password was changed and no sessions were revoked. The existing single business
owner received the server-managed Morning issuer claim, and the checked/merged
Morning handler was deployed with its explicit production environment retained.
An unauthenticated live create request was rejected with 401.

Calendar and Drive handlers were deployed with AES-GCM credential protection,
S256 PKCE and exact Origin checks. The one existing refresh token in each table
was encrypted using compare-and-set updates and read back/decrypted to verify
unchanged credential contents. Pending old OAuth intents were invalidated (the
pending-state count was zero before maintenance). Plaintext compatibility was
then disabled, and both functions were deployed again to start with that strict
configuration. Live requests verified 401 without authentication, 403 for a
foreign Origin, and 200 preflight with only the exact approved Origin reflected.

The Edge keyring is separate from the database. An ACL-restricted CurrentUser
DPAPI recovery copy is at `%LOCALAPPDATA%\NetunimSecurity\google-oauth-bupoidcurcxuypfrjqio.dpapi`
on the current computer. It contains no plaintext key file. Arrange an additional
encrypted operator recovery copy separately; losing all key copies requires
reconnecting Google. Neither tokens nor key material appear in this report.

Live catalog inspection confirmed RLS on every public table, no anonymous
EXECUTE access to privileged public/internal functions, explicit search paths on
the 27 authenticated public SECURITY DEFINER entrypoints, and no browser SELECT
grants on the Google credential/state tables or Morning operation ledger.
Identity checks are direct or delegated through writer/incident authorities.
The internal schema cannot simply lose USAGE: two existing public invoker RPCs
still reference its metadata/tables. No blanket privilege revocation was applied.

## Isolated staging actually provisioned

`netunim-staging` (`nckszremdktftbhimgxc`) was quoted at $0/month in the same Free
organization. All 55 application migrations were applied using the documented
fresh-project platform-ACL adapter. Production migration files were unchanged.
Public signup is disabled. Two synthetic users and two clearly marked synthetic
bank rows were created, with no production data or provider secrets copied.
Test-login credentials are locally protected by DPAPI in
`%LOCALAPPDATA%\NetunimSecurity\staging-test-logins.dpapi`.

Real password grants and PostgREST checks confirmed both owners can read their
own row and use its narrow handled-state RPC; neither can read the other's row,
mutate it through that privileged RPC, or SELECT Google credential tables.
Anonymous RPC calls were denied. The foreign handled-state call raises the
expected `P0002` / `bank_transaction_not_found` (mapped to HTTP 500 by PostgREST),
and the row stays unchanged; this was checked alongside successful owner calls.

New Preview builds select staging automatically, with separate config/CSP and
artifact verification. Production config disables its backend on unknown public
hosts. This protects new builds; it does not retroactively replace old immutable
Cloudflare deployments. Access policies for those URLs still need Cloudflare
account configuration. Staging Google clients and Morning sandbox credentials
remain intentionally unconfigured.

## Remaining work and computer rollout

The owner chose to retain Free. Supabase rejected leaked-password protection
with HTTP 402 because it requires Pro or higher; it remains disabled. The live
account still has zero verified MFA factors. MFA enrollment, the application's
challenge/recovery flow and enforcement of elevated assurance must be completed
and tested before claiming MFA protection. They were not enabled silently.

Other open boundaries are scoped per-site pairing/one-time pairing UX, complete
internal-grant reduction, Cloudflare Access for existing previews, and the tested
HttpOnly/server-session architecture discussed in the original review. Pairing
rotation by replacing the local token and restarting is covered by native tests,
but it is not a per-site credential protocol. Known moderate dependency findings
remain tracked; high/critical audit gates are enabled. Do not describe this state
as zero vulnerabilities or a completed penetration test.

After the final main updates, pull the repository on all three computers and
reinstall both Bridges. The final Bank release is v77 (diagnostic schema v5) and
Document is v46. Choose only business folders in the local Document configurator.
Git pull alone does not replace installed runtime directories or Startup entries.
Preserve pairing files locally; do not include them in support reports. Previously
exported diagnostics and installation reports need separate cleanup/rotation if
they may have exposed old tokens or personal data.

Check disk encryption, Windows account protection, automatic screen locking,
Defender and backup encryption on every computer. The earlier local checks found
Defender enabled and no broad-user Allow ACL on the two Bridge data roots;
BitLocker status was not verified. The new recovery directory has explicit
owner/SYSTEM/Administrators ACLs. No operating-system security policy was changed.
