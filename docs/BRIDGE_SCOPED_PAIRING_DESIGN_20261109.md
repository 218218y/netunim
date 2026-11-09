# Scoped Bridge pairing — implementation proposal

Status: design only. The current deployed protocol still uses one bearer key per
Bridge. This document is not evidence that site separation or local user presence
is already enforced. Implement in its own release after measurement/Windows
acceptance of Document Bridge 48, with a compatible browser and both installers.

## Current authority and target

Bank `http-handler.mjs` captures its token at startup; Document reloads it through
`ensureToken`. Both gates already require an approved Origin for browser callers.
Browser `bridge-pairing-scope.js` fences changed local credentials but is not a
server permission boundary. Neither HTTP gate currently distinguishes the two
websites or read access from destructive commands. UI confirmation is not local
user presence. The new gate must precede body reads and capability execution.

| Credential | Origin binding | Allowed capabilities |
| --- | --- | --- |
| Orders document reader | Exact locally approved Orders origin | search/recent, matches, preview/binary/native preview, open/reveal |
| Kupa document reader | Exact locally approved Kupa origin | Same reader capabilities, separate key/revocation |
| Document deletion grant | Same origin as its reader | Optional delete, explicitly approved locally; default absent |
| Orders/Kupa bank client | Separate record for each exact origin | status/images, refresh and the existing explicitly approved connection commands |
| Native administration | No browser Origin; separate local credential | shutdown, pairing administration, vault import/reset and credential removal |

The local operator chooses each capability; the website cannot promote itself.
Refresh/provider login and connection edits must be separately named capabilities,
not grouped as harmless reads. Unknown route/capability is denied by default.
Pages and custom-domain aliases require their own exact-origin records/approval;
there is no wildcard or common parent-domain credential. No cookie credentials
are introduced on the loopback listener. Origin checks remain independent of keys.

## Local approval and enrollment protocol

The configurator opens a local Windows UI through the existing native host, with
an ACL-restricted local transport. A web-originated pairing request can only create
a bounded pending request; it cannot approve it or open an unlimited sequence of
prompts. Show the exact Origin, application, capabilities and expiration locally.
Limit pending requests (three), attempts and request rate. Bind them to the exact
origin and a 32-byte cryptographic nonce, expiring after two minutes by monotonic
clock. A six-digit display code alone is insufficient authentication.

After explicit local approval, generate a one-use 32-byte pairing secret. Deliver
it through the local UI to the operator (explicit paste into the chosen site),
never URL/query, command-line arguments, support logs or public health. The site
POSTs it with its exact Origin; atomically consume the nonce before returning one
new 32-byte random site key. Parallel/replayed, expired, foreign-origin and
unapproved requests fail. Rejection/expiry cancels pending material. Keep only a
key digest, random record ID, origin, capabilities and revocation generation in an
ACL-restricted local registry; comparison is constant-time. Never list key values.

Record replacement uses atomic writes under the existing PID/token lock. Corrupt
or unavailable registry fails closed. Refresh the registry/generation at every
request and fence accepted operations before irreversible commands. Revoking one
site cancels its pending work/opaque grants without changing the other site's
key, provider profiles, vault, sync data, roots or Everything configuration. Check
authority again when opening old result IDs, in addition to filesystem authority.

## Compatibility and rollback

First ship both servers and clients understanding scoped records, with migration
explicitly inactive. A local migration command preserves the existing key and
configuration as an ACL-protected recovery artifact, pairs one computer/site,
then starts a visible seven-day legacy overlap for that computer. No unattended
switch or deletion of old browser data. Show which site still uses legacy mode
using record IDs only. At the end disable browser use of the shared key; retain
separate native administration. An installation that has not begun migration keeps
its old protocol and is clearly reported as unscoped, not silently secured.

Rollback is an explicit local action restoring protocol compatibility and the
previous installer without touching provider/sync data. It never resurrects a
revoked key automatically: either keep scoped authorization on the server or issue
a new legacy credential with local consent and a deadline. Back up configuration
and registry outside public diagnostics. Reinstallation must preserve records.

## Release tests and approval gates

Test both site origins/custom aliases against both servers with real loopback
HTTP and browser PNA prompts; deny foreign/missing browser origins, wrong key,
correct key from the other site, unknown capabilities, bodies before auth and
every destructive route. Native administration has a separate matrix. Test nonce
expiry/replay/concurrent consume, prompt rejection/rate limiting, corrupted files,
write interruption, restart, upgrade, rollback and revocation during queued work.
Test old result IDs after site revocation, root removal, hidden changes and drive
remapping. Prove vault/profile/index bytes unchanged and demonstrate one-site
revocation with the other still syncing. Do not change search/sync engines here.

Stage on one synthetic computer, then one real computer with both sites; roll out
the other two only after normal bank/credit/search/preview acceptance. Planning
estimate: 5–10 engineering days plus operator acceptance, with no new cloud
service. This is a scope estimate, not a delivery commitment. Local-user malware
and malicious code already executing within an approved site remain residual
risks; per-site grants limit their reach but do not isolate the Windows account.
