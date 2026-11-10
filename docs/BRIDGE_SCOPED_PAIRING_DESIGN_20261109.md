# Scoped Bridge pairing

The scoped protocol is opt-in per Bridge on each computer. Install both updated
web clients and runtimes before activating it. See the
[operator rollout](SECURITY_OPERATOR_ROLLOUT_HE.md) for the current versions
and installer paths. Record the release commit to distinguish builds that
share a runtime version. Updated listeners also
report `pairingProtocol: 1` on loopback `/health`. Each installer also stages a
fresh, public `installationId`. The listener snapshots it at startup, and the
installer checks it against the staged value before accepting the listener.
The security page at
`/security.html` on each site accepts one-time pairing codes.

## Authority

Each site Origin has its own key and explicit permissions. The Origin must
also pass the existing allowlist on every browser request. Pages aliases and
custom domains are separate Origins and require separate approval. Scoped keys
are never accepted without an Origin or for native administration.

| Permission | Access granted |
| --- | --- |
| `document.read` | Status, search, folder picker, open, reveal, and previews |
| `document.delete` | Send authorized files to the Recycle Bin |
| `document.maintenance` | Inspect or change PDF index maintenance |
| `bank.read` | Status, structural diagnostics, and retained cheque images |
| `bank.refresh` | Bank and credit provider refresh |
| `bank.configure` | Set credentials, select an account, or save a credit profile |
| `bank.remove` | Delete connections and reset local profiles |

Grant permissions only where required. Connection import can replace existing
connections and requires both `bank.configure` and `bank.remove`. Native
administration uses a separate credential and includes shutdown.
Existing authorization of real paths, hidden files, and
authorized roots is still enforced. Opaque document IDs are scoped to the key
that published them. A changed or revoked grant blocks queued work at its
authorization boundary. Effects already submitted to Windows or to a provider
finish through the existing owners.

## Canary procedure

1. In the first Windows computer, run the updated installers while the existing
   clients are still paired. Confirm search, preview, bank and credit use before
   changing permissions. Confirm that each intended site has received the
   updated `/security.html`. Choose its canonical HTTPS Origin.
2. Open the [local console](#local-console) for the selected Bridge.
3. Run `& $node $server --pairing status`.
   Run `& $node $server --pairing begin` and type `APPROVE` to open a
   seven-day overlap. A Bank runtime configured in legacy-reflect mode must
   first be switched to the existing allowlist mode.
4. Issue a code for one Origin, for example
   `& $node $server --pairing issue https://orders.bargig-furniture.com document.read`
   or `& $node $server --pairing issue https://kupa.bargig-furniture.com bank.read bank.refresh`.
   Type `APPROVE`. Paste the code on the exact site's security page within
   two minutes, selecting the correct Bridge. Keep the code out of terminal
   transcripts and support tickets. Repeat for each site, Bridge, and
   required permission set. To replace a key, issue and exchange another code
   for the same Origin. The exchange invalidates the previous key.
5. Confirm the paired site works and that disallowed actions are blocked.
   Verify the other site independently. Run
   `& $node $server --pairing revoke ORIGIN` to revoke only that Origin
   or cancel its pending first pairing. Reissue locally if required.
6. Run `& $node $server --pairing finish` after accepting all sites for this
   Bridge. This permanently closes its overlap. Keep the old installer and
   the recorded release commit for recovery. Repeat on the other computers
   after the canary, including cold and warm search/preview on C: and Y:,
   mapped-drive failures, and the normal bank/credit workflow.

## Local console

From the repository root, start an interactive `powershell.exe -NoProfile
-ExecutionPolicy Bypass` as the Windows user running the Bridge. Paste one
of these blocks to verify the pinned executable and select the active server.

Bank Bridge

```powershell
$root = Join-Path $env:LOCALAPPDATA 'NetunimKupaBankBridge'
$node = & .\netunim-kupa\bank-bridge\install_node_runtime.ps1 -AppRoot $root -VerifyOnly
$server = Join-Path $root 'app\server.mjs'
& $node $server --check-running
& $node $server --pairing status
```

Document Bridge

```powershell
$root = Join-Path $env:LOCALAPPDATA 'NetunimDocumentBridge'
$node = & .\netunim-orders\document-bridge\install_node_runtime.ps1 -AppRoot $root -VerifyOnly
$active = (Get-Content -LiteralPath (Join-Path $root 'active-runtime.txt') -Raw).Trim()
if ($active -notmatch '^app-v[0-9]+-[0-9]+-[0-9]+$') { throw 'Invalid Document Bridge runtime' }
$server = Join-Path (Join-Path $root $active) 'server.mjs'
& $node $server --check-running
& $node $server --pairing status
```

Use the same `$node` and `$server` for the pairing commands. Repeat the block
after reinstalling or switching runtimes so it resolves the active copy.

Pairing codes are 32-byte random values. The registry contains only digests,
exact origins, record IDs and permissions. A local admin credential is stored
separately under the Windows user/SYSTEM ACL in `pairing-v1`. Codes are
limited to three pending Origins and five valid-format guesses per code.
They expire on the monotonic clock, are consumed once and are lost on restart.
The registry is committed before the Bridge returns a site key. An initialized
installation with a missing or corrupt registry fails closed. Ordinary scoped
requests check an in-memory committed snapshot, with no registry reads.

The first successful pairing disables the legacy key for that Origin
immediately. An unpaired allowed Origin can still use it during overlap.
`status` lists the registered Origins, capabilities and deadline, without
showing credentials or asserting which browser is currently connected.

## Performance and recovery

Collect local timing on both sides of the update with the same test plan and
transport. Use at least 20 warm repetitions per scenario and record cold
requests separately. The timing CLI can still exercise read routes after
cutover with `& $node tools/measure-document-bridge.mjs --native plan.json report.json`
from the repository root after opening the Document Bridge console.
Native and legacy-site measurements use different baseline identities. For the
actual scoped browser path collect the request duration and Server-Timing in
DevTools. Only share aggregate timings and counts.

For a deliberate downgrade to a runtime that predates protocol 1, complete the transition and run
`& $node $server --pairing prepare-rollback` while the scoped runtime is
running. This prepares a fresh legacy credential without re-enabling the old
one on the scoped listener. Use the current runtime's `--stop-existing`
(or the Bank rollback helper) to drain it before installing/starting the
previous runtime. An older runtime uses the fresh local legacy key, so pair
its browser clients explicitly if needed. When restoring the scoped release,
the preserved registry will recognize previously active scoped keys. Reissue
locally if a browser was re-paired to the legacy key. Do not delete pairing
state, DPAPI files, provider profiles, Everything settings, browser data or
offline queues. A downgrade restores the legacy trust model while in use.

For a Bank rollback between protocol 1 builds, run the installed
`%LOCALAPPDATA%\NetunimKupaBankBridge\rollback_bank_bridge.bat`.
It drains the listener, swaps to the preserved runtime, and verifies it.
Run the same helper again to roll forward. For Document Bridge, reinstall
from the previous release checkout. Its installer cleans up inactive runtime
directories after successful activation. Keep the local registry and keys.
The installation ID identifies the selected runtime independently of pairing.

Automated tests cover the HTTP and production wiring, enrollment/replay,
cross-Origin access, capability denial, restart, failed registry writes, key
rotation for downgrade, document ID ownership and Bank admission. Canary
acceptance requires the actual Windows browsers, Origin/CORS permission
prompts, installation, providers, drives and performance measurements.
