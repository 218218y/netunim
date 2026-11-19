Document Bridge
===============

Run install_document_bridge.bat on each Windows workstation that needs local
document access. The installer starts and verifies the service at 127.0.0.1:8766.
Run configure_document_bridge.bat to review the approved folders and drives.
See docs/operations/connectors.md for the verified local pairing console,
origin policy, acceptance and rollback. See docs/integrations/document-search.md
for search, indexing and viewer diagnostics.

The runtime and per-user files live under %LOCALAPPDATA%\NetunimDocumentBridge.
Keep config, private pairing state and index files local. An empty root list
blocks document access. The service revalidates real paths before file operations.
Reinstall from the previous verified release for runtime rollback. Preserve the
existing configuration and pairing data.
