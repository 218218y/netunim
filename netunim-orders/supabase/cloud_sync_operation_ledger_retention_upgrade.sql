-- Cloud Sync v3 operation-ledger maintenance. Apply only after
-- cloud_sync_lossless_v3_upgrade.sql. This migration does not schedule or run
-- cleanup and does not touch business documents.
--
-- Product recovery contract:
--   * maximum supported durable offline/recovery horizon: 365 days;
--   * operation-ledger retention: 730 days (2x the supported horizon);
--   * defense in depth: retain at least the newest 100 operations for every
--     owner/domain/document (and owner/document for Bank), regardless of age.
--
-- Schedule netunim_internal.prune_sync_operation_ledgers() from trusted
-- server-side maintenance (for example a reviewed weekly pg_cron job). Do not
-- invoke it from a user save and do not expose it to browser roles.
begin;

create or replace function netunim_internal.prune_sync_operation_ledgers()
returns table(document_operations_deleted bigint, bank_operations_deleted bigint)
language plpgsql
security definer
set search_path = pg_catalog, netunim_internal
as $maintenance$
declare
  v_cutoff constant timestamptz := statement_timestamp() - interval '730 days';
  v_keep_per_document constant integer := 100;
  v_batch_size constant integer := 10000;
begin
  with ranked as materialized (
    select owner_id,
           domain,
           document_name,
           operation_id,
           created_at,
           row_number() over (
             partition by owner_id, domain, document_name
             order by created_at desc, operation_id desc
           ) as recency_rank
    from netunim_internal.document_sync_operations
  ),
  doomed as materialized (
    select owner_id, domain, document_name, operation_id
    from ranked
    where created_at < v_cutoff
      and recency_rank > v_keep_per_document
    order by created_at, owner_id, domain, document_name, operation_id
    limit v_batch_size
  ),
  deleted as (
    delete from netunim_internal.document_sync_operations target
    using doomed
    where target.owner_id = doomed.owner_id
      and target.domain = doomed.domain
      and target.document_name = doomed.document_name
      and target.operation_id = doomed.operation_id
    returning 1
  )
  select count(*)::bigint into document_operations_deleted from deleted;

  with ranked as materialized (
    select owner_id,
           document_name,
           operation_id,
           created_at,
           row_number() over (
             partition by owner_id, document_name
             order by created_at desc, operation_id desc
           ) as recency_rank
    from netunim_internal.bank_sync_operations
  ),
  doomed as materialized (
    select owner_id, document_name, operation_id
    from ranked
    where created_at < v_cutoff
      and recency_rank > v_keep_per_document
    order by created_at, owner_id, document_name, operation_id
    limit v_batch_size
  ),
  deleted as (
    delete from netunim_internal.bank_sync_operations target
    using doomed
    where target.owner_id = doomed.owner_id
      and target.document_name = doomed.document_name
      and target.operation_id = doomed.operation_id
    returning 1
  )
  select count(*)::bigint into bank_operations_deleted from deleted;

  return next;
end
$maintenance$;

comment on function netunim_internal.prune_sync_operation_ledgers() is
  'Server-only bounded maintenance: retain 730 days and at least 100 newest operation acknowledgements per document; deletes no business data.';

revoke all on function netunim_internal.prune_sync_operation_ledgers() from public, anon, authenticated;
grant usage on schema netunim_internal to service_role;
grant execute on function netunim_internal.prune_sync_operation_ledgers() to service_role;

-- Browser roles keep read/insert rights required by the SECURITY INVOKER v3
-- writers, but never receive DELETE/TRUNCATE or maintenance execution rights.
revoke delete, truncate on table netunim_internal.document_sync_operations from public, anon, authenticated;
revoke delete, truncate on table netunim_internal.bank_sync_operations from public, anon, authenticated;

commit;
