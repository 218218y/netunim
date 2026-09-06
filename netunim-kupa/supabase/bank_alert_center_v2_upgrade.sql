-- Bank alert center v2: finance-fencing compatible acknowledgements + one-time legacy baseline
--
-- Why this exists:
--   sync_recovery_fencing_v6 intentionally revokes direct UPDATE on public.bank_transactions
--   from browser roles. User-driven alert dismissal therefore MUST go through a tightly scoped
--   SECURITY DEFINER RPC that re-checks auth.uid()/owner_id. Re-granting table UPDATE would weaken
--   the finance fencing boundary and is deliberately not done here.
--
-- Rollout baseline:
--   Returned-cheque alerting was added after the archive already contained historical rows.
--   Existing returned-cheque rows are acknowledged exactly once per owner so an upgrade does not
--   manufacture a backlog of old alerts. New rows inserted after this migration remain unacknowledged
--   and will alert normally. The internal baseline marker makes this migration safe to re-run.

begin;

do $$
begin
  if to_regclass('public.bank_transactions') is null then
    raise exception 'missing_bank_transactions_table' using errcode='42P01';
  end if;
  if to_regprocedure('public.acknowledge_bank_transaction_alert(bigint,text)') is null then
    raise exception 'missing_acknowledge_bank_transaction_alert_rpc' using errcode='42883';
  end if;
end $$;

-- Keep the browser's table permissions read-only. The function owner performs only this one
-- owner-scoped metadata update on behalf of the authenticated caller.
alter function public.acknowledge_bank_transaction_alert(bigint,text) security definer;
alter function public.acknowledge_bank_transaction_alert(bigint,text) set search_path=pg_catalog,public;
revoke all on function public.acknowledge_bank_transaction_alert(bigint,text) from public,anon;
grant execute on function public.acknowledge_bank_transaction_alert(bigint,text) to authenticated;

create schema if not exists netunim_internal;
revoke all on schema netunim_internal from public,anon;

create table if not exists netunim_internal.bank_alert_rollout_baselines (
  owner_id uuid not null references auth.users(id) on delete cascade,
  alert_kind text not null check (alert_kind in ('returned_cheque')),
  baseline_at timestamptz not null,
  primary key(owner_id,alert_kind)
);
revoke all on table netunim_internal.bank_alert_rollout_baselines from public,anon,authenticated;

-- Baseline only owners that have never been baselined. This means re-running the migration later
-- cannot silently acknowledge a genuinely new returned cheque.
with owners_to_baseline as (
  select distinct b.owner_id
  from public.bank_transactions b
  where not exists (
    select 1
    from netunim_internal.bank_alert_rollout_baselines x
    where x.owner_id=b.owner_id and x.alert_kind='returned_cheque'
  )
), marked as (
  update public.bank_transactions b
     set alert_acknowledgements = coalesce(b.alert_acknowledgements,'{}'::jsonb)
       || jsonb_build_object('returned_cheque',now())
    from owners_to_baseline o
   where b.owner_id=o.owner_id
     and not (coalesce(b.alert_acknowledgements,'{}'::jsonb) ? 'returned_cheque')
     and (
       btrim(b.description) ~ '^(החזרת[[:space:]]+(שיק(ים)?|צ[׳'']?ק(ים)?|המחא(ה|ות))|((שיק|צ[׳'']?ק|המחאה)[[:space:]]+(הוחזר|חזר)))($|[[:space:].,:;()־–—-])'
       or lower(btrim(b.description)) ~ '^(returned|return)[[:space:]]+(check|cheque)s?($|[[:space:].,:;()–—-])'
     )
  returning b.owner_id
)
insert into netunim_internal.bank_alert_rollout_baselines(owner_id,alert_kind,baseline_at)
select o.owner_id,'returned_cheque',now()
from owners_to_baseline o
on conflict(owner_id,alert_kind) do nothing;

notify pgrst,'reload schema';
commit;
