# Bridge origin and pairing threat model, 2026-10-22

This is a source review plus isolated real-HTTP characterization. No installed
Bridge, pairing token, provider account or business data was accessed.

| Boundary | Bank Bridge | Document Bridge |
| --- | --- | --- |
| Listener | `127.0.0.1:8765` | `127.0.0.1:8766` |
| Public requests | OPTIONS, GET health (pathname aliases retained) | OPTIONS, exact GET health, after origin admission |
| Origin | Reflects supplied Origin, or `*` if absent | Configured allowlist; foreign/null origins rejected before token reads |
| Private authority | Timing-safe comparison of Bearer token before body or route entry | Same token gate, after origin admission |
| Private-network preflight | Advertised | Advertised only after accepted origin |
| Body ceiling | 32 KiB | 8 KiB |
| File authority | Private retained cheque image IDs; vault/provider owners | Private expiring opaque result IDs, rather than caller paths |
| Destructive commands | Shared pairing authority; UI confirmations are a separate boundary | Shared pairing authority; deletion confirmation and opaque IDs are separate boundaries |

Bank generates its initial token from 32 random bytes and preserves an existing
token across restarts/reinstallation. The token is captured at startup. Its CLI
initialization/print-token operation intentionally prints the pairing secret.
Credential/profile DPAPI protection does not by itself protect a leaked pairing
token, browser token storage, terminal history or same-user process access.

The review's CORS observation is confirmed. It is not a token bypass: real HTTP
tests from foreign, null, local and absent origins return 401 without a valid
token, including credentials deletion/import, reset, shutdown, provider and image
route shapes. The resolver is never entered and invalid JSON is never parsed.
With the synthetic valid token, the foreign Bank origin is accepted. Consequently
Bank's current policy offers no additional origin barrier after token compromise.
Document rejects foreign and suffix-spoofed origins even with that synthetic token.
Both still trust an authorized application's code possessing the pairing key.

## Decision and compatibility proof

Retain Bank's deployed policy in this continuation. Its original characterization
explicitly preserved reflection; there is no isolated installed-provider environment
available to prove a default-origin migration across custom domains and installation
launch methods. A default allowlist change is therefore pending rollout evidence,
not represented as already secured. This decision does not establish that reflection
is necessary. The preferred next hardening experiment is a Bank allowlist with an
explicit persisted custom-origin escape hatch, tested before changing the default.

`tests/bridge_origin_security.test.mjs` verifies the current authority ordering
with real ephemeral loopback HTTP and inert command ports. The Document matrix
covers both Pages families and previews, the custom furniture domain/subdomains,
localhost/127.0.0.1 ports, absent Origin for native clients, configured exact custom
origins, null and malicious suffixes. Existing Bank/Document HTTP, binary, native
startup, configuration/DPAPI and shutdown tests remain mandatory. These are HTTP
and code-policy observations; they do not claim real browser private-network
permission or target-machine installation compatibility.

Before changing Bank's policy, record every deployed application Origin, exercise
normal local/native clients plus browser permission/preflight/actual requests on
the installed service, and prove unauthorized origins reach no private capability.
Test custom-origin configuration, restart, upgrade and rollback with synthetic
accounts. Do not reduce authentication or extend listener binding for compatibility.

## Compromised-key and destructive-command exercise

Use only a disposable installation. Close admitted work through the existing
shutdown path and verify listener exit. Preserve the vault and provider profiles;
move the disposable installation's `bridge-token.txt` aside, restart to generate
a replacement, then re-pair both test browser profiles. Verify the old key receives
401 for reads and destructive commands while the new key works. Reinstallation
alone preserves the old key. Record only key fingerprints, never raw keys, provider
credentials, document bodies or cheque images. Audit target Windows directory ACLs
separately; a JavaScript file-mode argument is not evidence of Windows ACL policy.

Per-command authorization and server-side user-presence prompts are separate
product decisions. This review does not equate existing UI confirmations with
protection against an arbitrary client that already holds a valid token.
