# Supabase exported function inventory — 2026-11-08

Source: the owner-supplied CSV, observed at 2026-11-08T14:00:05.222Z.
This is a code-location inventory, not verification of deployed function bodies.
The WARN indicates privileged callable code, not proof of a privilege bypass.
Retain required public RPCs; inspect their owner checks and delegated helpers.

| Public function | Last checked-in migration definition |
| --- | --- |
| `acknowledge_bank_transaction_alert` | [20260906200304_production_schema_baseline.sql:1853](../supabase/migrations/20260906200304_production_schema_baseline.sql#L1853) |
| `acknowledge_bank_transaction_missing` | [20260906200304_production_schema_baseline.sql:1883](../supabase/migrations/20260906200304_production_schema_baseline.sql#L1883) |
| `activate_storage_protocol_v2` | [20260924120000_storage_writer_protocol_v2.sql:273](../supabase/migrations/20260924120000_storage_writer_protocol_v2.sql#L273) |
| `apply_restore_group_v6` | [20260929093000_storage_writer_operation_contract.sql:250](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L250) |
| `bulk_delete_save_kupa_document_v6` | [20260929093000_storage_writer_operation_contract.sql:188](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L188) |
| `bulk_delete_save_order_management_document_v6` | [20260929093000_storage_writer_operation_contract.sql:169](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L169) |
| `bulk_delete_save_shared_checks_document_v6` | [20260929093000_storage_writer_operation_contract.sql:207](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L207) |
| `claim_finance_sync_lease` | [20260906200304_production_schema_baseline.sql:1995](../supabase/migrations/20260906200304_production_schema_baseline.sql#L1995) |
| `get_storage_protocol_state` | [20260924120000_storage_writer_protocol_v2.sql:255](../supabase/migrations/20260924120000_storage_writer_protocol_v2.sql#L255) |
| `list_active_sync_incidents_v1` | [20261018180000_sync_incidents.sql:73](../supabase/migrations/20261018180000_sync_incidents.sql#L73) |
| `mark_sync_incident_reviewed_v1` | [20261018180000_sync_incidents.sql:81](../supabase/migrations/20261018180000_sync_incidents.sql#L81) |
| `merge_bank_transactions_v6` | [20261016130000_bank_business_evidence_authority.sql:124](../supabase/migrations/20261016130000_bank_business_evidence_authority.sql#L124) |
| `refresh_check_bank_matches` | [20261018120000_check_bank_refresh.sql:515](../supabase/migrations/20261018120000_check_bank_refresh.sql#L515) |
| `release_finance_sync_lease` | [20260906200304_production_schema_baseline.sql:2098](../supabase/migrations/20260906200304_production_schema_baseline.sql#L2098) |
| `report_sync_incident_v1` | [20261018180000_sync_incidents.sql:65](../supabase/migrations/20261018180000_sync_incidents.sql#L65) |
| `resolve_sync_incident_v1` | [20261018180000_sync_incidents.sql:69](../supabase/migrations/20261018180000_sync_incidents.sql#L69) |
| `restore_spreadsheet_document_v1` | [20260917180000_independent_spreadsheet_documents.sql:135](../supabase/migrations/20260917180000_independent_spreadsheet_documents.sql#L135) |
| `save_bank_sync_snapshot_v6` | [20260929093000_storage_writer_operation_contract.sql:303](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L303) |
| `save_finance_sync_document_v6` | [20260929093000_storage_writer_operation_contract.sql:319](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L319) |
| `save_kupa_document_v6` | [20260929093000_storage_writer_operation_contract.sql:143](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L143) |
| `save_order_management_document_v6` | [20260929093000_storage_writer_operation_contract.sql:130](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L130) |
| `save_shared_checks_document_v6` | [20260929093000_storage_writer_operation_contract.sql:156](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L156) |
| `save_spreadsheet_document_v1` | [20260917180000_independent_spreadsheet_documents.sql:88](../supabase/migrations/20260917180000_independent_spreadsheet_documents.sql#L88) |
| `save_tax_calculator_document_v1` | [20261019041407_tax_calculator.sql:146](../supabase/migrations/20261019041407_tax_calculator.sql#L146) |
| `set_bank_transaction_handled` | [20260922101500_bank_handled_rpc_security_fix.sql:6](../supabase/migrations/20260922101500_bank_handled_rpc_security_fix.sql#L6) |
| `stage_restore_group_v6` | [20260929093000_storage_writer_operation_contract.sql:227](../supabase/migrations/20260929093000_storage_writer_operation_contract.sql#L227) |
| `sync_bank_transactions_snapshot_v6` | [20261016140000_bank_snapshot_temporal_authority.sql:5](../supabase/migrations/20261016140000_bank_snapshot_temporal_authority.sql#L5) |
