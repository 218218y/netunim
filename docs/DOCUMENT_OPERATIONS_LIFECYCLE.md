# Document operations and service lifecycle

createDocumentOperations owns opaque-result file authority, native preview/folder
commands, direct/indexed/PDF text, private preview metadata, match projection and
open/reveal/recycle operations. Existing PowerShell commands, result TTL, byte
limits, search/geometry policy and HTTP payloads remain unchanged.

Its strict command owner admits and tracks each complete accepted command through
filesystem absence verification, derived-index invalidation and audit. Closing
rejects new document and status/maintenance work without aborting an accepted
filesystem side effect. Shutdown now joins that owner alongside all previous
search/session/process/PDF/maintenance/native owners. Failure of one drain still
joins its siblings before rejection. Preview text likewise joins both Everything
and PDF work before returning the first observed failure.

Two concrete lifetime gaps are covered: an accepted recycle command outliving
shutdown; and fast PDF rejection releasing the document command while its
Everything sibling remained active. Native synthetic-file removal/index journal
coverage and an actual coordinator mutation reproduce the weaker behavior.
No live file, provider or installed Bridge is touched by these fixtures.

createBridgeService owns status/health, manual maintenance status/start/stop,
HTTP listener, graceful shutdown and CLI dispatch. The root constructs owners,
wires routes and enters main. It no longer implements these policies. CLI command
fixtures and a Linux production-entrypoint --init/--print-token test preserve boot;
Windows installation and private Node/preview-host contracts remain in the full gate.

The final relocated files receive whitespace-only readability changes, checked
against identical JavaScript token streams. Existing immutable policy fixtures are
not rewritten. The root source budget is tightened to 18 KB; startup budgets for
both browser applications are unchanged. Windows staging includes every new module.

COMPATIBILITY_INVENTORY.md records Current, Historical Reader, Immutable Migration,
Generated and proven Dead classifications. No historical reader or SQL history is
removed speculatively. Repeated startup optimization, whole journal/owner-transfer
strict coverage, physical two-computer tests and live providers remain separate
release/backlog work, not completion claims of this slice.
