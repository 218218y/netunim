# Synthetic test lab

Use the existing browser, native Bridge, crash investigation and disposable
Supabase fixtures through one entry point:

```powershell
python tools/test_lab.py list
python tools/test_lab.py run --scenario isolation --scenario local-save-abort
python tools/test_lab.py run --scenario concurrent-edits --scenario restore-and-crash
python tools/test_lab.py run --scenario local-save-crash
python tools/test_lab.py run --scenario old-tab --scenario bridge
python tools/test_lab.py run --all
```

Reports live in `.work/test-lab/<run>/report.json` and `report.md`. Each selected
scenario retains suite logs, source SHA/dirty state, timing, exit code and artifact
SHA-256 hashes. Restore investigation retains stopped IndexedDB bytes **before**
restart, snapshots, Journal/base/flight/ACK records and checksums. The real Supabase
fixture retains operation IDs, revision ledger and restart snapshots. Fixtures use
only synthetic records. No project URL, provider credential, browser profile or
data path can be supplied to the entry point. Child suites run with isolated
home/config/temp directories and without inherited provider credentials or proxies.
Each child process tree and scratch directory has an existing fixture owner.

`network-and-lost-ack` requires the existing disposable GitHub-hosted Linux stack;
it returns BLOCKED locally instead of using a linked/production Supabase project.
That required CI job starts actual GoTrue/PostgREST/Storage/pg_cron. Its tests cover
offline/reconnect, concurrent changes, lost HTTP ACK after commit and hard restart.
Other browser scenarios are component integration; they do not prove live cloud
behavior. `local-save-abort` tests native request-success/transaction-abort authority;
it does not alone prove physical power loss during a write.

`local-save-crash` pauses in the real IndexedDB Journal request-success event,
proves that the production completion receipt has not been issued, and kills the
owned Chromium process tree. Orders, Kupa and Shared Checks reopen twice. Only a
whole pre-write or whole committed transaction is accepted; Journal/metadata must
agree and cloud revision/ACK must remain unchanged. Stopped IndexedDB files and
their hashes are retained before recovery. This proves the tested native process
failure boundary; it does not emulate a hardware power failure or disk controller.

## Offline isolated Windows

From a **clean committed** Windows checkout with the locked Node dependencies and
Python websocket-client already installed:

```powershell
python tools/test_lab.py prepare-windows
```

The command prints the absolute `NetunimLab.wsb` path under a newly owned temporary
directory. Open that file to start a new Sandbox. Only an exported Git snapshot and
offline runtimes are mapped read-only. Only its separate empty evidence folder is
writable. The working checkout, `.git` history/config, browser profiles, vaults,
installed Bridge data and inherited credentials are never mapped. The package
contains hashes for all included bytes; altered or extra files reject launch.
Networking, clipboard, audio/video input, printing and vGPU are disabled. No NetFree
certificate is needed for these offline scenarios and host certificate trust is
unchanged. The [Microsoft configuration reference](https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)
describes read-only mappings and disabled networking.

The guest script verifies its virtual-machine identity and package, copies into a
fresh `C:\NetunimLabRun`, initializes a new **synthetic** Git snapshot, and runs
isolation, native transaction abort, bounded restore/crash, old-tab/PWA and staged
Bridge tests. The original exported source SHA/tree remains in `package-source.json`;
the guest Git SHA identifies the derived lab snapshot. Existing fixtures allocate
their own loopback ports/profiles and stage Bridge code/data away from 8765/8766.
No global Bridge installation or startup entry is created. Inert provider adapters
and synthetic DPAPI secrets exercise native behavior without a provider login.

Reports are mirrored to the mapped evidence folder every three seconds. An abrupt
Sandbox close may lose the final three seconds; missing completion is NOT RUN or
UNRESOLVED, never PASS. Keep the entire package directory until evidence is copied.
A new Sandbox run starts from a fresh guest. For a persistent isolated VM, copy
`payload` to `C:\NetunimLabPackage` and its owned `evidence` folder to
`C:\NetunimLabEvidence`, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\NetunimLabPackage\source\tools\start-test-lab.ps1 -Kind vm
```

The VM must be isolated from work accounts/data and have a Chromium browser. The
launcher rejects physical hosts and an existing guest run directory. Preserve and
rename the old lab directory before another VM run. It never deletes existing VM
data to force a rerun. Offline runtimes are copied from the host installation;
their byte hashes prove reproducibility, not a clean-room software supply chain.

## Evidence and remaining operator work

| Result | Meaning |
| --- | --- |
| PASS / automatic | The selected fixture returned success with scoped cleanup |
| PASS / isolated-windows | The prepared guest fixture passed with VM attestation |
| PASS / physical | Never emitted by this runner; requires a separate operator record |
| NOT RUN | Scenario unselected, external account/equipment required, or no run started |
| BLOCKED | Missing dependency or required disposable environment |
| UNRESOLVED | Observed failure/interruption; cause not yet proved |

The default report leaves live Google, Morning sandbox, Bank/Credit, physical
machines and the full global Windows installer explicitly NOT RUN. Staged native
Bridge checks cover pairing-token replacement, DPAPI file retention, origin opt-in
policy/restart/rollback and graceful/forced process drain. They do not prove the
complete installer/updater/uninstaller on a persistent VM. Origin allowlist remains
opt-in. The lab does not install a root certificate, invoke a provider account,
schedule work, deploy or touch the active Bank/Document Bridge.

On 2026-11-03 the first local CLI probes and required Windows CI reproduced a
missing Known Folder path under the synthetic USERPROFILE. A fresh-child native
Shell API regression failed before repair. The runner now creates coherent
AppData/Local and AppData/Roaming paths before any child starts; Chromium's
non-default-profile protection remains enabled. Original failed reports remain
UNRESOLVED and are never rewritten. This was a lab environment defect, not evidence
of an application storage failure.
