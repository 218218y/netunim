# Session architecture decision proposal

Status: retain the existing session architecture for this release. Orders cloud/auth.js and Kupa
cloud/auth.js/session-store.js persist Supabase credentials accessible to
JavaScript. Kupa's local authority/tombstone and ordered IndexedDB mirror are
documented in KUPA_AUTH_SESSION_AUTHORITY.md. Existing MFA/RLS/owner fences help
but do not make a stolen bearer token harmless. An HttpOnly cookie alone does
not stop injected same-origin code making authorized requests.

The current clients preserve the stored login during transient Auth refresh
failures and reject a late refresh response after the credential has changed.
The Orders refresh lock is scoped to the login that requested it. Confirmed
credential rejection still requires reauthentication. This addresses the
reproduced recovery and account-scope failures within the existing design.

| Option | Security effect | Offline/multi-computer behavior | Cost and rollout |
| --- | --- | --- | --- |
| Current static clients + MFA/CSP/RLS | Existing server ownership/assurance; JS credential theft remains | Current offline queue, refresh fencing and per-computer sessions preserved | No additional server; maintenance and owner MFA enrollment |
| Harden current session handling | Reduce token copies/lifetime and verify logout/refresh fences; memory-only mode sacrifices persistent cloud reconnect | Explicit reconnect after restart for memory-only mode; preserve local business data and queued writes | Estimate 2–5 engineering days plus two-site browser/DB regression; no new server |
| BFF + opaque HttpOnly session | Server holds refresh/access tokens; browser gets opaque per-device session cookie | Local saves continue offline; queued writes need server reauth on reconnect; no cloud-dependent local preview | Estimate 15–25 engineering days plus load/security tests; server, secret store, monitoring and operations required |

Estimates are design estimates, not measured costs or provider quotes. Calculate
BFF spend from measured requests/day, peak concurrency, session-store operations,
compute duration, egress and retention. Reuse a compatible same-origin Worker or
server only after confirming its secret/session storage, atomicity, pricing and
domain/deployment limits. No paid service or quota change is authorized by this
document. First measure ordinary sync RPC latency and peak usage to price the
design; no invented monthly dollar figure is a release requirement.

## Deployment feasibility

`tools/deploy_site_core.bat` intentionally rejects server code and deployment
configuration in the static upload. The production rollout therefore needs a
separate reviewed deployable and explicit route ownership. A Pages Function
can bind a Durable Object, but the Durable Object requires its own Worker
deployment. Prototype only with disposable Supabase and non-production routes.
Before approval, exercise a session refresh racing logout across two tabs and
two computers, a queued Storage V2 write across an offline restart, provider
OAuth callback and retry, and a rollout/rollback with the offline journal
intact. Collect request counts and read/write P50/P95 before comparing compute
and strongly consistent session storage costs. [Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects)

## Proposed BFF boundary if approved

Use separate same-origin `/api` routes on the two custom HTTPS domains. An opaque
`__Host-` cookie is Secure, HttpOnly, Path=/ with no Domain attribute and an
appropriate SameSite policy. Keep refresh credentials in an encrypted server
store indexed by a hashed session ID, never returned to browser JS. Create new
session IDs at login/assurance elevation; retain distinct per-device records so
one-computer logout/revocation is possible. Do not use a service-role credential
for ordinary application data: proxy the user's token so RLS/MFA still enforce
the existing ownership. Never trust browser-supplied identity or AAL.

Every mutation checks exact Origin and a session-bound CSRF token; reject simple
cross-origin form content types, use Fetch Metadata as defense in depth and
no-store on authenticated responses. Cookie-only SameSite is insufficient for
all same-site/custom-domain cases. Refresh is single-flight per server session;
atomic versioning prevents stale refresh responses or a logout race from
reviving sessions. Authenticate server requests rather than trusting unverified
client session payloads. Honor expiration, revocation and MFA recovery rules.

Preserve existing Storage V2 writer IDs, revisions, idempotency and durable ACKs.
An expired cloud cookie suspends upload, not local saves, and reconnect never
discards queued changes. Keep cloud service workers from caching authenticated
responses or login callbacks. Test two computers independently, two tabs racing
refresh, offline/reconnect, factor changes, blocked cookies, OAuth PKCE callbacks,
replay, CSRF and account replacement. Proxy Storage/bank/cloud RPCs as needed;
Everything, local file search, native preview and file bytes stay on loopback.

Before rollout, measure BFF median/tail latency, refresh bursts, memory/CPU,
timeouts, retries, session-store failure and concurrent document upload. Define
numeric latency/cost budgets from measured staging data. Canary one computer,
then both sites and other computers. Rollback uses an explicit version/feature
switch and reauthentication; it never copies server refresh tokens back into
localStorage or wipes the offline journal. Keep MFA/RLS active throughout.

## Production Advisor review

Read-only catalog checks on November 9, 2026 found zero public tables with RLS
disabled and 23 policies using the MFA guard across public, internal and
storage schemas. All 27 public SECURITY DEFINER functions callable by
authenticated users directly call that guard. The anonymous role has execute
on none of the public definers. The 11 public RLS tables with no policies had
neither anonymous nor authenticated read/write grants. Keep these grants and
policies and review after migrations that change a definer or a grant.

Supabase also reports that leaked-password protection is disabled. This
feature is available on Pro and higher plans. The owner still needs to enroll
and verify MFA and maintain account recovery. Review the password protection
setting at the next Auth configuration or subscription review.
[Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

Proceed with the current session model and the operator's MFA and endpoint
rollout. Reassess memory-only sessions or a BFF when the isolated tests and
cost/latency measurements are available for approval.

References checked November 9, 2026: [Supabase SSR advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide),
[Supabase session lifecycle](https://supabase.com/docs/guides/auth/sessions),
[Supabase Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes),
[OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
