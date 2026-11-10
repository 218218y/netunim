# Scoped Bridge pairing

The scoped protocol is opt-in per Bridge on each computer. Install both updated
web clients and runtimes before activating it. The runtime versions remain Bank
79 and Document 48 for wire compatibility. Use the release commit, rather than
the version number alone, to distinguish these builds. Updated listeners also
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
2. Open an interactive terminal as the Windows user that runs the Bridge.
   Use its installed Node executable and active `server.mjs`. Bank uses
   `%LOCALAPPDATA%\NetunimKupaBankBridge\app\server.mjs`. Document uses
   the active runtime directory named by
   `%LOCALAPPDATA%\NetunimDocumentBridge\active-runtime.txt`.
3. Run `node server.mjs --pairing status` for the selected Bridge.
   Run `node server.mjs --pairing begin` and type `APPROVE` to open a
   seven-day overlap. A Bank runtime configured in legacy-reflect mode must
   first be switched to the existing allowlist mode.
4. Issue a code for one Origin, for example
   `node server.mjs --pairing issue https://orders.bargig-furniture.com document.read`
   or `node server.mjs --pairing issue https://kupa.bargig-furniture.com bank.read bank.refresh`.
   Type `APPROVE`. Paste the code on the exact site's security page within
   two minutes, selecting the correct Bridge. Keep the code out of terminal
   transcripts and support tickets. Repeat for each site, Bridge, and
   required permission set. A new issue/exchange rotates the previous key
   for that exact Origin.
5. Confirm the paired site works and that disallowed actions are blocked.
   Verify the other site independently. Run
   `node server.mjs --pairing revoke ORIGIN` to revoke only that Origin
   or cancel its pending first pairing. Reissue locally if required.
6. Run `node server.mjs --pairing finish` after accepting all sites for this
   Bridge. This permanently closes its overlap. Keep the old installer and
   the recorded release commit for recovery. Repeat on the other computers
   after the canary, including cold and warm search/preview on C: and Y:,
   mapped-drive failures, and the normal bank/credit workflow.

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
cutover with `node tools/measure-document-bridge.mjs --native plan.json report.json`.
Native and legacy-site measurements use different baseline identities. For the
actual scoped browser path collect the request duration and Server-Timing in
DevTools. Only share aggregate timings and counts.

For a deliberate downgrade to a runtime that predates protocol 1, complete the transition and run
`node server.mjs --pairing prepare-rollback` while the scoped runtime is
running. This prepares a fresh legacy credential without re-enabling the old
one on the scoped listener. Use the current runtime's `--stop-existing`
(or the Bank rollback helper) to drain it before installing/starting the
previous runtime. An older runtime uses the fresh local legacy key, so pair
its browser clients explicitly if needed. When restoring the scoped release,
the preserved registry will recognize previously active scoped keys. Reissue
locally if a browser was re-paired to the legacy key. Do not delete pairing
state, DPAPI files, provider profiles, Everything settings, browser data or
offline queues. A downgrade restores the legacy trust model while in use.

For a rollback between protocol 1 builds, drain the current listener and use
the prior runtime against the existing local data. Keep the existing registry
and keys. The installation ID identifies the selected runtime and is independent
of pairing. Retain the previous installer or its release commit for the Document
Bridge, whose successful installation cleans up inactive runtime directories.

Automated tests cover the HTTP and production wiring, enrollment/replay,
cross-Origin access, capability denial, restart, failed registry writes, key
rotation for downgrade, document ID ownership and Bank admission. Canary
acceptance requires the actual Windows browsers, Origin/CORS permission
prompts, installation, providers, drives and performance measurements.
