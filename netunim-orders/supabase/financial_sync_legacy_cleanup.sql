-- Financial Sync legacy payload cleanup
-- RUN ONLY AFTER:
--   1) financial_sync_integrity_v2_upgrade.sql
--   2) one successful MANUAL Bank refresh from Kupa or Orders
--   3) financial_sync_integrity_v2_verify.sql returns OK for every configured account
-- The v2 manual refresh performs a fresh up-to-365-day backfill and stores an immutable
-- archiveBaselineAudit. Later rolling refreshes do not replace that baseline proof.
-- This script is transactional and refuses cleanup unless the baseline is independently verified.

begin;

do $$
begin
  if to_regclass('public.finance_sync_documents') is null or to_regclass('public.bank_transactions') is null then
    raise exception 'financial_sync_archive_missing'
      using hint='Run financial_sync_archive_upgrade.sql and financial_sync_integrity_v2_upgrade.sql first.';
  end if;

  if exists (
    select 1
    from public.kupa_documents k
    where k.state ? 'creditSync'
      and not exists (
        select 1 from public.finance_sync_documents f
        where f.owner_id=k.owner_id and f.document_name='main'
          and jsonb_typeof(f.state->'creditSync')='object'
      )
  ) then
    raise exception 'credit_sync_not_migrated'
      using hint='A legacy Kupa creditSync exists but the dedicated finance document is missing it. Refresh credit sync before cleanup.';
  end if;

  if exists (
    select 1
    from public.kupa_documents k
    where (
      k.state#>'{bank,feed}' is not null
      or k.state#>'{bank,homeFeed}' is not null
      or k.state#>>'{bank,source}'='hapoalim'
    )
    and not exists (
      select 1 from public.finance_sync_documents f
      where f.owner_id=k.owner_id and f.document_name='main'
        and f.state#>>'{bank,source}'='hapoalim'
        and coalesce((f.state#>>'{bank,archiveInitialized}')::boolean,false)=true
        and coalesce((f.state#>>'{bank,archiveVersion}')::integer,0)>=2
    )
  ) then
    raise exception 'bank_archive_v2_not_initialized'
      using hint='Run one manual Bank refresh after installing financial_sync_integrity_v2_upgrade.sql, then rerun this cleanup.';
  end if;

  -- Gate cleanup on the immutable 365-day baseline audit produced by independent client read-back.
  -- Current archive size may be larger than the baseline after later rolling syncs; it may never be smaller.
  if exists (
    with accounts as (
      select f.owner_id,'business'::text account_role,
             coalesce(f.state#>>'{bank,archiveBaselineAudit,business,accountKey}',f.state#>>'{bank,feed,accountNumber}') account_key,
             coalesce((f.state#>>'{bank,archiveBaselineAudit,version}')::integer,0) audit_version,
             coalesce((f.state#>>'{bank,archiveBaselineAudit,historyDays}')::integer,0) history_days,
             f.state#>'{bank,archiveBaselineAudit,business}' audit
      from public.finance_sync_documents f where f.document_name='main' and f.state#>>'{bank,source}'='hapoalim'
      union all
      select f.owner_id,'home',
             coalesce(f.state#>>'{bank,archiveBaselineAudit,home,accountKey}',f.state#>>'{bank,homeFeed,accountNumber}'),
             coalesce((f.state#>>'{bank,archiveBaselineAudit,version}')::integer,0),
             coalesce((f.state#>>'{bank,archiveBaselineAudit,historyDays}')::integer,0),
             f.state#>'{bank,archiveBaselineAudit,home}'
      from public.finance_sync_documents f where f.document_name='main' and f.state#>>'{bank,source}'='hapoalim'
    ), actual as (
      select owner_id,account_role,account_key,count(*)::integer rows
      from public.bank_transactions group by owner_id,account_role,account_key
    )
    select 1 from accounts a
    left join actual x using(owner_id,account_role,account_key)
    where coalesce(a.account_key,'')<>'' and (
      a.audit is null or a.audit_version<2 or a.history_days<365
      or coalesce(a.audit->>'accountKey','')<>coalesce(a.account_key,'')
      or coalesce((a.audit->>'exactCount')::boolean,false)=false
      or coalesce((a.audit->>'sourceCount')::integer,-1)<>coalesce((a.audit->>'archiveCount')::integer,-2)
      or coalesce(x.rows,-1)<coalesce((a.audit->>'archiveCount')::integer,2147483647)
    )
  ) then
    raise exception 'bank_archive_v2_incomplete'
      using hint='The immutable 365-day Bank Bridge baseline audit is missing or no longer covered by bank_transactions. Do not clean legacy snapshots; run the manual Bank refresh again and verify v2 first.';
  end if;

  if exists (
    select 1 from (
      select owner_id,account_role,account_key,
        case
          when bank_serial not in ('','0') and transaction_date is not null then 'serial:'||transaction_date::date||':'||bank_serial||':'||amount
          when bank_reference<>'' and transaction_date is not null then 'ref:'||transaction_date::date||':'||bank_reference||':'||amount||':'||description||':'||memo
          else merge_key
        end identity_key,count(*) c
      from public.bank_transactions
      group by owner_id,account_role,account_key,identity_key
      having count(*)>1
    ) duplicates
  ) then
    raise exception 'bank_archive_v2_duplicate_identity'
      using hint='Archive identity duplicates still exist. Do not clean the legacy snapshots.';
  end if;
end $$;

create or replace function pg_temp.compact_kupa_finance_payload(p_state jsonb)
returns jsonb
language sql
immutable
as $fn$
  select (p_state - 'creditSync' - 'bank') || jsonb_build_object(
    'bank', jsonb_build_object(
      'currentBalance', case when p_state#>>'{bank,source}'='manual' then coalesce(p_state#>'{bank,currentBalance}','null'::jsonb) else 'null'::jsonb end,
      'updatedAt', case when p_state#>>'{bank,source}'='manual' then coalesce(p_state#>'{bank,updatedAt}','null'::jsonb) else 'null'::jsonb end,
      'asOfDate', case when p_state#>>'{bank,source}'='manual' then coalesce(p_state#>'{bank,asOfDate}','null'::jsonb) else 'null'::jsonb end,
      'adjustments', case when jsonb_typeof(p_state#>'{bank,adjustments}')='array' then p_state#>'{bank,adjustments}' else '[]'::jsonb end,
      'source', case when p_state#>>'{bank,source}'='manual' then 'manual'::text else null end,
      'sourceAccount', null,
      'snapshotToken', coalesce(p_state#>'{bank,snapshotToken}','null'::jsonb),
      'snapshotSeq', coalesce(p_state#>'{bank,snapshotSeq}','null'::jsonb)
    )
  )
$fn$;

-- Bypass the direct-write guard only inside this controlled migration transaction.
select set_config('app.kupa_rpc_write','1',true);

-- Current document: bump revision so every connected client detects the migration instead of silently
-- continuing from an old revision. No extra pre-cleanup backup is created by this migration.
update public.kupa_documents k
set state=pg_temp.compact_kupa_finance_payload(k.state),
    revision=k.revision+1,
    updated_at=now();

-- Historical Kupa backups remain restorable, but their heavy Bank/Credit sync payload is removed.
-- Snapshot token/sequence and manual Kupa adjustments are retained because they are Kupa consistency metadata.
update public.kupa_document_backups b
set state=pg_temp.compact_kupa_finance_payload(b.state);

update public.kupa_periodic_backups p
set state=pg_temp.compact_kupa_finance_payload(p.state);

-- The finance document should contain only finance data; Kupa check-watermark coordination lives in Kupa.
update public.finance_sync_documents f
set state=jsonb_set(
      f.state,
      '{bank}',
      case when jsonb_typeof(f.state->'bank')='object'
           then (f.state->'bank') - 'adjustments' - 'snapshotToken' - 'snapshotSeq'
           else f.state->'bank' end,
      true
    ),
    revision=f.revision+1,
    updated_at=now()
where jsonb_typeof(f.state->'bank')='object';

commit;
