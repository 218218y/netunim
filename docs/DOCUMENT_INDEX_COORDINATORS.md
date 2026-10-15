# Document index and search composition

PDF index state, reader/writer locking, disk signatures, complete inventory
reconciliation, derived backlog, scope filtering and partial-search projection
now belong to createPdfIndexCoordinator. Its returned index port exposes reads,
verified writer commands and a bounded metadata view; it exposes no Map writer.
The existing strict reader/writer/inventory/maintenance/preview owners keep their
algorithms and transaction policy. Construction performs no I/O.

createEverythingSearchCoordinator binds configuration, session/process commands,
PDF search, opaque-result publication and audit. It owns count/sample diagnostics,
exit-8 invalidation/reprobe and search request normalization. Provider discovery,
accepted process lifetime and registry path authority remain with their owners.

server.mjs wires the two coordinators rather than implementing their algorithms.
Document/preview commands and status/boot/shutdown remain for the next slice.
The Windows staging list includes the complete new module graph.

Evidence includes the immutable original Everything retry token digest and 4,716
old/current search/recent comparisons. Production private composition fixtures
locate the actual declarations across the extracted owners; immutable baselines
were not rewritten. Native index/journal fault, replay, removal, inventory/abort,
maintenance checkpoint and preview child/drain suites remain active. New tests
also construct both actual factories and exercise real disk writes/reloads,
corrupt-byte retention, scope filtering, read-only entries and exit-8 retries.
