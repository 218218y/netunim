# Bank Bridge command authority decision, 2026-10-25

Decision: retain the existing single pairing-token authority for supported
full-trust local application clients in this release. No secondary token store,
server-side confirmation UI or partial-scope credential is introduced. This is
an explicit residual-risk choice, not a claim that the token is read-only or
that an application confirmation limits another client holding the key.

## Route inventory

The complete machine-readable inventory is
`docs/evidence/bank-command-authority.json`. A contract compares it against every
actual fixed route registration and resolves each route/credit alias into its
existing inert capability. New or removed routes require an inventory review;
effect labels are review metadata and grant no runtime permission.

| Effect | Private routes | Consequence with a leaked pairing key |
| --- | --- | --- |
| Read | status, Credit status, Credit diagnostics/data-diagnostics, Bank diagnostics, opaque cheque image | Sensitive metadata, retained financial exports or images can be read |
| Write | save Credit profile, save Bank credentials, account selection | Local secrets, profiles and account selection can be replaced |
| Provider | balance and Credit sync | A provider login/request and local metadata/artifact writes can be triggered; these are not pure reads |
| Destructive | delete Credit profile, reset Credit, delete Bank credentials, settings import | Local connections, browser identities and associated artifacts may be removed or replaced |
| Administrative | shutdown | New work stops while accepted work drains; availability is affected |

Public OPTIONS/health remain separate. The private route ordering still requires
Origin admission, timing-safe Bearer comparison, admission/body/route validation
and the existing owner. `/v2/credit` aliases do not grant a second authority.
These routes do not directly write a Supabase financial journal; their local
credential/provider impact is still significant.

## Why no partial permission system now

Both first-party applications pair to the computer and use the same token for
connection maintenance, provider refresh, diagnostics and shutdown/replacement.
The existing clients have no separate read-only pairing enrollment/revocation
contract. Adding a second shared static secret or a browser checkbox would not
prove local user presence and could break installer shutdown/rollback or create
an uncoordinated authentication path. No limited third-party/read-only client has
been established and no disposable installed-provider environment is available.

Origin allowlisting adds a browser-origin barrier after token exposure but is
not protection against native clients that omit/spoof Origin, malicious code in
an allowed origin or same-user process access. DPAPI protects supported stored
secrets; it does not establish token-file ACLs or resistance to the same user.
UI confirmations express intent inside the legitimate application only.

Reconsider scopes when a concrete limited-client or server-side user-presence
requirement exists. Specify enrollment, route grants, revocation, replacement,
accepted-work drain, key rotation, installer upgrade and rollback together at
the existing HTTP admission boundary. Require tests where a read-only client
cannot mutate, revoked grants fail, and a previous full-trust client has an
explicit compatible transition. Until then no partial-permission claim is made.

## Origin/default and physical acceptance

Keep v75 allowlisting opt-in. The user confirmed on 2026-10-25 that no separate
test environment is available. Staged HTTP/runtime successes cannot justify
changing the default for installed/custom-domain/PWA clients. The full original
installer in a fresh Windows account, browser private-network permissions,
upgrade/rollback, other-account ACL access, two physical clients and official
financial Sandbox scenarios remain **NOT RUN**. Their exact acceptance protocol
is [operational acceptance](OPERATIONAL_ACCEPTANCE_20261022.md), with the policy
configuration/rollback details in [Bank Origin rollout](BANK_ORIGIN_POLICY.md).
