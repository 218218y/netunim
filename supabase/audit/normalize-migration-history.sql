-- Reviewed metadata-only normalization. Original rows are preserved in
-- audit/original-full-migration-history.json. No application table or DDL is touched.
-- Baseline version was created by Supabase CLI; subsequent versions by apply_migration.
BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
WITH observed AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version),'[]') AS rows
  FROM supabase_migrations.schema_migrations
), guard AS MATERIALIZED (
  SELECT 1 / CASE WHEN rows = '[{"version":"20260826180906","name":"shared_checks_cutover_20260826"},{"version":"20260826182721","name":"fix_revision_rpc_ambiguity_20260826"},{"version":"20260826183010","name":"guard_bulk_empty_shared_checks_20260826"},{"version":"20260902140209","name":"order_management_fail_fast_writer_gate_20260902"},{"version":"20260902140237","name":"order_management_fail_fast_writer_gate_20260902"},{"version":"20260902142007","name":"postgrest_14_nonretry_conflicts_20260902"},{"version":"20260902143640","name":"harden_core_rpc_write_contention_20260902"},{"version":"20260906203818","name":"capabilities_security_invoker"},{"version":"20260906203827","name":"restore_group_qualified_owner_updates"},{"version":"20260906203837","name":"oauth_owner_index"}]'::jsonb THEN 1 ELSE 0 END AS verified FROM observed
), removed AS (
  DELETE FROM supabase_migrations.schema_migrations m USING guard
  WHERE guard.verified=1 AND m.version IN ('20260826180906','20260826182721','20260826183010','20260902140209','20260902140237','20260902142007','20260902143640')
  RETURNING m.version
), baseline AS (
  INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
  SELECT '20260906200304','production_schema_baseline',NULL::text[]
  WHERE (SELECT count(*) FROM removed)=7
  RETURNING version
)
SELECT (SELECT count(*) FROM removed) AS archived_versions,
       (SELECT version FROM baseline) AS baseline_marked_applied;
COMMIT;

