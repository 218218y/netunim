Bank Bridge
===========

Run install_bank_bridge.bat on each Windows workstation that refreshes Bank
or Credit. The installer starts and verifies the service at 127.0.0.1:8765
and registers a Windows Task Scheduler task for that user's sign-in.
Automatic startup runs in the background without opening a console window.
Review docs/operations/connectors.md for pairing, verified local console
commands, origin policy and rollback. See docs/development/finance.md for
the transaction and credit coverage contracts.

The private runtime and per-user files live under
%LOCALAPPDATA%\NetunimKupaBankBridge. Keep credentials, profiles, pairing
state and cheque images local. If startup fails, check autostart.log for
the launcher result, bridge.log for the service output, and the Windows
task named NetunimKupaBankBridge-<user SID> for its last result.
The installed rollback_bank_bridge.bat switches to the preserved runtime.
Use remove_bank_bridge_autostart.bat to remove automatic startup.
Use the app's connection settings to manage saved provider credentials.
