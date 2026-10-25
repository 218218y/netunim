# Bank Bridge v75 origin rollout

The v75 server accepts an optional persisted `origin-policy.json` in
`%LOCALAPPDATA%\NetunimKupaBankBridge`, beside the pairing token. The installer
stages the policy module with the runtime; configuration remains outside the
runtime/rollback directories. No HTTP configuration writer is introduced.

An absent file retains the deployed `legacy-reflect` mode. An explicit invalid
version, mode, origin list or JSON document stops the v75 server before it opens
the listener. Invalid configuration never silently restores reflection.
The policy is captured once at startup; editing the file requires a normal
authenticated shutdown/drain and restart before permissions change.

For a disposable installation, enable the additional barrier with:

```json
{"version":1,"mode":"allowlist","allowedOrigins":["https://custom.example"]}
```

Allowlist mode accepts the two Bargig Pages sites and their preview subdomains,
the furniture domain and its subdomains, HTTP localhost/127.0.0.1 origins at
any port, native clients without an Origin, and explicitly configured exact
HTTP(S) origins. Custom origins are additive. They must be canonical origins
without a trailing slash, path, credentials, query, fragment or wildcard; custom
ports are exact. A foreign/null/spoofed origin is rejected with 403 before health,
preflight, token inspection, body parsing or private capability entry. Rejected
responses advertise neither CORS access nor private-network permission. Accepted
private requests still require the same timing-safe Bearer token.
This is a browser-origin barrier. A native client can omit Origin, so it cannot
replace pairing authentication or protect a secret from arbitrary native clients.

An explicit policy rollback is:

```json
{"version":1,"mode":"legacy-reflect"}
```

Restart normally after changing it. This intentionally restores the previous
origin behavior; it never disables token authentication. A binary rollback to
v74 or older also restores that runtime's original origin behavior because it
does not read the new file. Pairing, vaults, financial records and provider
profiles are not modified by a policy change. Native health/shutdown remain
usable for installation/replacement in allowlist mode.

## Evidence and default-policy decision

Real ephemeral HTTP tests reject foreign origins with a synthetic valid token
on health, preflight, destructive and binary route shapes, without entering the
private command. Accepted-origin matrices retain Bearer checks. A staged child
uses the installer's actual module list and persisted file, proves restart
revocation of a removed custom origin, captures permissions until restart,
rolls back explicitly, preserves pairing bytes and refuses a malformed file.
The actual decoder/admission body is strict checked with negative consumers and
a compiler mutation. These exercises use disposable files and no provider login.

Keep the default at legacy reflection until an isolated installed-service
acceptance run records all deployed/custom origins, actual browser private-network
preflight/permission/requests, normal restart, upgrade and rollback with disposable
accounts. This is a documented residual risk after key compromise, not a completed
production-origin rollout. Do not infer Windows ACL protection from a Node mode
argument. The installed-directory ACL audit remains an operator acceptance item.

Destructive commands still use the shared pairing authority. UI confirmation is
not server-side user presence. Separate read/write/destructive scopes and browser
re-pairing UX require explicit product decisions; this change adds no substitute
token store or second authentication mechanism. Existing token revocation and
vault-retention tests remain required.

The [October 25 command-authority decision](BRIDGE_COMMAND_AUTHORITY.md) now
explicitly retains that full-trust pairing policy and inventories every sensitive
route. The user confirmed that no separate installation/provider environment is
available. Installed Origin/default, PWA/private-network and cross-account ACL
acceptance stay NOT RUN; the default therefore remains opt-in.
