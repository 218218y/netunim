# Compatibility and retirement inventory

Audited against the current source on 2026-10-15. This table classifies the active
compatibility families raised by the V7 review and adjacent persisted formats.
Classification follows consumers and retained data, never a filename containing
legacy, v1 or migration. It is not a certificate that old user data has disappeared.

| Source or family | Classification | Current consumer / retained evidence | Retirement rule |
| --- | --- | --- | --- |
| shared/storage-v2-persisted-compat.js | Historical Reader | storage-operation, bootstrap and journal IDB read earlier completed bootstrap intents, upload-owner metadata and shadow roles | Keep until retained journal/backup migration and old-record recovery evidence replace every reader |
| shared/storage-journal-idb.js upgrade removal of cutover-preparations / legacy-recoveries | Current | Normal IDB schema upgrade retires unused stores; current V2 writer remains independent | Preserve upgrade behavior for older installed browsers; no V1 business writer is re-enabled |
| netunim-kupa/site/assets/js/sync/legacy-card-migration.js | Historical Reader | sync/merge.js uses migrateLegacyCards3Way; remote-adoption still detects missing historical card IDs | Keep exact identity/conflict policy until all retained remote/base/backup records are migrated |
| shared/credit-billing-cycles.js legacy-credit-feed and date-only input | Historical Reader | Current Finance/cash-flow projection reads historical issuer months/dates without inventing coverage or shifting dates | Require historical transaction/billing fixtures and retained-record migration evidence |
| shared/kupa-cashflow.js validated legacy_bank_reference fields | Historical Reader | Exact issuer-reference and cycle reconciliation still consumes retained financial rows | Preserve unique-candidate and amount/date proof; never delete solely because a reference is old |
| shared/spreadsheet-model.js and spreadsheet-sync.js legacy capture/recovery | Historical Reader | Independent workbooks decode old cells/sheets, capture prior Main content, retain conflicts/recovery exports | Require old workbook/import/backup recovery and conflict evidence before removing formats |
| shared/notes-sheet-model.js historical generated sheet names | Historical Reader | Current workbook presentation reads earlier auto sheet prefixes | Keep until retained workbook names have a reviewed migration |
| shared/document-search/integrations/document-bridge.js token keys | Historical Reader | Reads old Orders/Kupa local pairing keys; best-effort migration preserves access when preference writes fail | Keep installed-device pairing recovery; setting a new token already removes old keys |
| netunim-kupa/site/assets/js/ui/folders.js remembered backup handle fallback | Historical Reader | restoreRememberedBackupTarget first reads the dedicated backup handle, then the earlier general remembered handle | Keep until installed-browser permission/handle migration is verified |
| Document Bridge pdf-index-reader.mjs and pdf-index-coordinator.mjs older PDF schema/revisions | Historical Reader | Schemas 1/2 and older extractor metadata remain readable; current revisions decide reinspection | Keep old snapshot/journal corpus and on-demand geometry reinspection evidence |
| shared/bank-bridge-client.js rollback /credit route and ui/folders.js legacyFileInput | Current | Explicit transport rollback and browser file-input fallback are live paths | Retire only after supported-runtime/browser policy changes and consumer coverage prove them unused |
| /rest/v1/, /functions/v1/, save_spreadsheet_document_v1 and other deployed RPC version names | Current | Active Supabase HTTP and independent-workbook APIs; unrelated to retired Storage V1 writers | API compatibility policy applies; names alone provide no retirement evidence |
| supabase/migrations/*.sql and applied SQL/function history | Immutable Migration | PostgreSQL replay, deployed history/statement hashes and canonical migration manifests | Do not rewrite or delete deployed history; use an additive reviewed migration |
| App/operator setup.sql and *_upgrade.sql copies | Current | Operator installation/upgrade entrypoints, canonical migration and SQL parity contracts | Keep until a reviewed deterministic replacement exists; do not assume every copy is generated |
| supabase/canonical-migration-manifest.json | Generated | tools/supabase_migration_manifest.py checks reviewed local expectations; this is not live server evidence | Regenerate/check with the canonical tool, without rewriting deployed evidence |
| Site shared assets, document-search copies, service-worker shell/cache and standalone bank-money-value.mjs | Generated | tools/sync-assets.py deterministically produces and checks deployed copies | Edit canonical sources and synchronize; intentional copies are not dead duplication |
| Unused assertStorageJson import after Shared Checks validation extraction | Dead | No remaining binding consumer; full lint detects the orphan; removed in Stage 11 | Removed without deleting its canonical validator or any retained-data reader |
| Old server-local implementations after coordinator extraction | Current, relocated | Actual functions now live in the index/search/document/service owners; source-based behavior fixtures follow them | Keep one implementation; the removed duplicate listener bodies are not a data migration |

No additional historical reader was proven Dead during this continuation.
A retirement PR must identify the consumer closure, the retained format, the
replacement/migration and old-record/restart evidence. Synthetic CI does not prove
that a live account, another computer or an old backup no longer contains a format.
