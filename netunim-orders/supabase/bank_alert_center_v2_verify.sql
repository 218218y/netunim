-- Read-only postflight for bank_alert_center_v2_upgrade.sql
-- Expected after applying v2: all *_ok columns are true and legacy_unacknowledged_count is 0.

with alert_rpc as (
  select p.prosecdef
  from pg_proc p
  where p.oid=to_regprocedure('public.acknowledge_bank_transaction_alert(bigint,text)')
), legacy_unack as (
  select count(*)::bigint as n
  from public.bank_transactions b
  join netunim_internal.bank_alert_rollout_baselines x
    on x.owner_id=b.owner_id and x.alert_kind='returned_cheque'
  where b.first_seen_at<=x.baseline_at
    and not (coalesce(b.alert_acknowledgements,'{}'::jsonb) ? 'returned_cheque')
    and (
      btrim(b.description) ~ '^(החזרת[[:space:]]+(שיק(ים)?|צ[׳'']?ק(ים)?|המחא(ה|ות))|((שיק|צ[׳'']?ק|המחאה)[[:space:]]+(הוחזר|חזר)))($|[[:space:].,:;()־–—-])'
      or lower(btrim(b.description)) ~ '^(returned|return)[[:space:]]+(check|cheque)s?($|[[:space:].,:;()–—-])'
    )
)
select
  coalesce((select prosecdef from alert_rpc),false) as alert_rpc_security_definer_ok,
  not has_table_privilege('authenticated','public.bank_transactions','UPDATE') as direct_table_update_revoked_ok,
  has_function_privilege('authenticated','public.acknowledge_bank_transaction_alert(bigint,text)','EXECUTE') as alert_rpc_execute_granted_ok,
  to_regclass('netunim_internal.bank_alert_rollout_baselines') is not null as rollout_baseline_exists_ok,
  (select n from legacy_unack)=0 as legacy_baseline_complete_ok,
  (select n from legacy_unack) as legacy_unacknowledged_count;
