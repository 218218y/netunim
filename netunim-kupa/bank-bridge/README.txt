Bank Bridge
===========

Run install_bank_bridge.bat on each Windows workstation that refreshes Bank
or Credit. The installer starts and verifies the service at 127.0.0.1:8765.
Review docs/operations/connectors.md for pairing, verified local console
commands, origin policy and rollback. See docs/development/finance.md for
the transaction and credit coverage contracts.

The private runtime and per-user files live under
%LOCALAPPDATA%\NetunimKupaBankBridge. Keep credentials, profiles, pairing
state and cheque images local. If startup fails, review bridge.log there
and use the verified local console to identify the active listener.
The installed rollback_bank_bridge.bat switches to the preserved runtime.
Use remove_bank_bridge_autostart.bat to remove the startup entry.
Use the app's connection settings to manage saved provider credentials.
