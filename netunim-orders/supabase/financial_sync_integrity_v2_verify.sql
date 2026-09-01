-- Financial Sync Integrity v2 verification (READ ONLY)
-- Run after one successful MANUAL Bank refresh with the v2 code.
-- The manual refresh stores archiveBaselineAudit from the independent Bridge -> archive read-back.
-- Later rolling (30-day) refreshes may replace archiveAudit, but MUST NOT replace archiveBaselineAudit.

with finance as (
  select owner_id,state
  from public.finance_sync_documents
  where document_name='main' and state#>>'{bank,source}'='hapoalim'
), accounts as (
  select f.owner_id,'business'::text account_role,
         coalesce(f.state#>>'{bank,archiveBaselineAudit,business,accountKey}',f.state#>>'{bank,feed,accountNumber}') account_key,
         coalesce((f.state#>>'{bank,archiveVersion}')::integer,0) archive_version,
         coalesce((f.state#>>'{bank,archiveBaselineAudit,version}')::integer,0) audit_version,
         coalesce((f.state#>>'{bank,archiveBaselineAudit,historyDays}')::integer,0) audit_history_days,
         f.state#>'{bank,archiveBaselineAudit,business}' audit
  from finance f
  union all
  select f.owner_id,'home',
         coalesce(f.state#>>'{bank,archiveBaselineAudit,home,accountKey}',f.state#>>'{bank,homeFeed,accountNumber}'),
         coalesce((f.state#>>'{bank,archiveVersion}')::integer,0),
         coalesce((f.state#>>'{bank,archiveBaselineAudit,version}')::integer,0),
         coalesce((f.state#>>'{bank,archiveBaselineAudit,historyDays}')::integer,0),
         f.state#>'{bank,archiveBaselineAudit,home}'
  from finance f
), archive_counts as (
  select owner_id,account_role,account_key,count(*)::integer archive_rows_total
  from public.bank_transactions
  group by owner_id,account_role,account_key
), archive_duplicates as (
  select owner_id,account_role,account_key,count(*)::integer duplicate_identity_groups
  from (
    select owner_id,account_role,account_key,
      case
        when bank_serial not in ('','0') and transaction_date is not null then 'serial:'||transaction_date::date||':'||bank_serial||':'||amount
        when bank_reference<>'' and transaction_date is not null then 'ref:'||transaction_date::date||':'||bank_reference||':'||amount||':'||description||':'||memo
        else merge_key
      end identity_key,
      count(*) c
    from public.bank_transactions
    group by owner_id,account_role,account_key,identity_key
    having count(*)>1
  ) d
  group by owner_id,account_role,account_key
), archive_pending as (
  select owner_id,account_role,account_key,count(*)::integer stale_pending_rows
  from public.bank_transactions
  where status='pending' and transaction_date < now()-interval '7 days'
  group by owner_id,account_role,account_key
)
select a.account_role,a.account_key,a.archive_version,a.audit_version,a.audit_history_days,
       coalesce((a.audit->>'sourceCount')::integer,0) baseline_source_rows,
       coalesce((a.audit->>'archiveCount')::integer,0) baseline_archive_rows,
       coalesce(c.archive_rows_total,0) archive_rows_total,
       coalesce(d.duplicate_identity_groups,0) duplicate_identity_groups,
       coalesce(p.stale_pending_rows,0) stale_pending_rows,
       a.audit->>'verifiedAt' baseline_verified_at,
       case when a.archive_version>=2
                  and a.audit is not null
                  and a.audit_version>=2
                  and a.audit_history_days>=365
                  and coalesce(a.audit->>'accountKey','')=coalesce(a.account_key,'')
                  and coalesce((a.audit->>'exactCount')::boolean,false)=true
                  and coalesce((a.audit->>'sourceCount')::integer,-1)=coalesce((a.audit->>'archiveCount')::integer,-2)
                  and coalesce(c.archive_rows_total,-1)>=coalesce((a.audit->>'archiveCount')::integer,2147483647)
                  and coalesce(d.duplicate_identity_groups,0)=0
                  and coalesce(p.stale_pending_rows,0)=0
             then 'OK' else 'FAIL' end status
from accounts a
left join archive_counts c using(owner_id,account_role,account_key)
left join archive_duplicates d using(owner_id,account_role,account_key)
left join archive_pending p using(owner_id,account_role,account_key)
where coalesce(a.account_key,'')<>''
order by a.account_role,a.account_key;
