-- Focused recovery hardening. Apply once after sync_integrity_v5_upgrade.sql.
-- All publication wrappers retain the existing CAS, ledger and bank-watermark implementations.
begin;
alter table public.finance_sync_leases add column if not exists fence_epoch bigint not null default 1 check(fence_epoch>0);
revoke insert,update,delete on public.finance_sync_leases from authenticated,anon;

drop function public.claim_finance_sync_lease(text,text,integer);
create function public.claim_finance_sync_lease(p_lease_name text,p_lease_token text,p_ttl_seconds integer default 1200)
returns table(acquired boolean,leased_until timestamptz,lease_token text,fence_epoch bigint)
language plpgsql security definer set search_path=pg_catalog,public as $lease$
declare v_owner uuid:=auth.uid();v_now timestamptz:=clock_timestamp();
begin
 if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
 if p_lease_name not in ('bank','credit') or p_lease_name is null or coalesce(btrim(p_lease_token),'')='' or length(p_lease_token)>200 or p_ttl_seconds is null or p_ttl_seconds<60 or p_ttl_seconds>1800 then raise exception 'invalid_finance_sync_lease' using errcode='22023';end if;
 insert into public.finance_sync_leases as l(owner_id,lease_name,lease_token,leased_until,fence_epoch)
 values(v_owner,p_lease_name,p_lease_token,v_now+make_interval(secs=>p_ttl_seconds),1)
 on conflict(owner_id,lease_name) do update set lease_token=excluded.lease_token,
 leased_until=clock_timestamp()+make_interval(secs=>p_ttl_seconds),updated_at=clock_timestamp(),
 fence_epoch=case when l.lease_token=excluded.lease_token and l.leased_until>clock_timestamp() then l.fence_epoch else l.fence_epoch+1 end
 where l.leased_until<=clock_timestamp() or l.lease_token=excluded.lease_token
 returning true,l.leased_until,l.lease_token,l.fence_epoch into acquired,leased_until,lease_token,fence_epoch;
 if not found then select false,l.leased_until,l.lease_token,l.fence_epoch into acquired,leased_until,lease_token,fence_epoch from public.finance_sync_leases l where l.owner_id=v_owner and l.lease_name=p_lease_name;end if;
 return next;
end $lease$;
revoke all on function public.claim_finance_sync_lease(text,text,integer) from public,anon;
grant execute on function public.claim_finance_sync_lease(text,text,integer) to authenticated;
-- The existing release checks authenticated owner and token and keeps the epoch row forever.
alter function public.release_finance_sync_lease(text,text) security definer;

create or replace function netunim_internal.assert_finance_sync_fence(p_lease_name text,p_lease_token text,p_fence_epoch bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $fence$
declare l public.finance_sync_leases%rowtype;v_owner uuid:=auth.uid();
begin
 if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
 -- Keep the row locked until the publication transaction commits. Recheck time after the lock.
 select * into l from public.finance_sync_leases where owner_id=v_owner and lease_name=p_lease_name for update;
 if not found or p_lease_token is distinct from l.lease_token or p_fence_epoch is distinct from l.fence_epoch or l.leased_until<=clock_timestamp() then
  raise exception 'stale_finance_sync_fence' using errcode='PT409';
 end if;
end $fence$;
revoke all on function netunim_internal.assert_finance_sync_fence(text,text,bigint) from public,anon,authenticated;

alter function public.save_bank_sync_snapshot(text,jsonb,text,bigint) rename to fenced_impl_save_bank_sync_snapshot;
alter function public.fenced_impl_save_bank_sync_snapshot(text,jsonb,text,bigint) set schema netunim_internal;
revoke all on function netunim_internal.fenced_impl_save_bank_sync_snapshot(text,jsonb,text,bigint) from public,anon,authenticated;
create function public.save_bank_sync_snapshot(p_document_name text,p_bank_state jsonb,p_snapshot_token text,p_snapshot_seq bigint,p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(finance_revision bigint,kupa_revision bigint,updated_at timestamptz) language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $publish$
begin
 if p_lease_name is distinct from 'bank' then raise exception 'stale_finance_sync_fence' using errcode='PT409';end if;
 perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
 return query select * from netunim_internal.fenced_impl_save_bank_sync_snapshot(p_document_name,p_bank_state,p_snapshot_token,p_snapshot_seq);
end $publish$;
revoke all on function public.save_bank_sync_snapshot(text,jsonb,text,bigint,text,text,bigint) from public,anon;
grant execute on function public.save_bank_sync_snapshot(text,jsonb,text,bigint,text,text,bigint) to authenticated;

alter function public.merge_bank_transactions(text,text,jsonb) rename to fenced_impl_merge_bank_transactions;
alter function public.fenced_impl_merge_bank_transactions(text,text,jsonb) set schema netunim_internal;
revoke all on function netunim_internal.fenced_impl_merge_bank_transactions(text,text,jsonb) from public,anon,authenticated;
create function public.merge_bank_transactions(p_account_key text,p_account_role text,p_transactions jsonb,p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer) language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $publish$
begin
 if p_lease_name is distinct from 'bank' then raise exception 'stale_finance_sync_fence' using errcode='PT409';end if;
 perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
 return query select * from netunim_internal.fenced_impl_merge_bank_transactions(p_account_key,p_account_role,p_transactions);
end $publish$;
revoke all on function public.merge_bank_transactions(text,text,jsonb,text,text,bigint) from public,anon;
grant execute on function public.merge_bank_transactions(text,text,jsonb,text,text,bigint) to authenticated;

alter function public.sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean) rename to fenced_impl_sync_bank_transactions_snapshot;
alter function public.fenced_impl_sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean) set schema netunim_internal;
revoke all on function netunim_internal.fenced_impl_sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean) from public,anon,authenticated;
create function public.sync_bank_transactions_snapshot(p_account_key text,p_account_role text,p_transactions jsonb,p_snapshot_at timestamptz,p_coverage_from date,p_coverage_to date,p_complete boolean,p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer,missing_count integer,active_missing_count integer,snapshot_stored boolean,baseline_created boolean) language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $publish$
begin
 if p_lease_name is distinct from 'bank' then raise exception 'stale_finance_sync_fence' using errcode='PT409';end if;
 perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
 return query select * from netunim_internal.fenced_impl_sync_bank_transactions_snapshot(p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete);
end $publish$;
revoke all on function public.sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint) from public,anon;
grant execute on function public.sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint) to authenticated;

alter function public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb) rename to fenced_impl_save_finance_sync_document_v5;
alter function public.fenced_impl_save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb) set schema netunim_internal;
revoke all on function netunim_internal.fenced_impl_save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb) from public,anon,authenticated;
create function public.save_finance_sync_document_v5(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_audit jsonb,p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint) language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $publish$
begin
 perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
 return query select * from netunim_internal.fenced_impl_save_finance_sync_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_audit);
end $publish$;
revoke all on function public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb,text,text,bigint) from public,anon;
grant execute on function public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb,text,text,bigint) to authenticated;

-- A validated snapshot delegates to its archive implementation inside the same transaction.
do $nested$
declare definition text;
begin
 select pg_get_functiondef('netunim_internal.fenced_impl_sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean)'::regprocedure) into definition;
 definition:=replace(definition,'public.merge_bank_transactions(','netunim_internal.fenced_impl_merge_bank_transactions(');
 execute definition;
end $nested$;
-- No browser caller may bypass the fenced entry points via an older finance writer.
revoke all on function public.save_finance_sync_document(text,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.save_finance_sync_document_v3(text,bigint,jsonb,text) from public,anon,authenticated;
revoke all on function netunim_internal.save_finance_sync_document(text,bigint,jsonb) from public,anon,authenticated;
revoke all on function netunim_internal.save_bank_sync_snapshot(text,jsonb,text,bigint) from public,anon,authenticated;
revoke insert,update,delete on public.finance_sync_documents from public,anon,authenticated;
revoke insert,update,delete on public.bank_transactions,public.bank_transaction_snapshots from public,anon,authenticated;
revoke all on function netunim_internal.merge_bank_transactions(text,text,jsonb) from public,anon,authenticated;
-- This user action changes only missing_acknowledged_at, checks owner_id explicitly,
-- and does not publish a scraped snapshot.
alter function public.acknowledge_bank_transaction_missing(bigint) security definer;

create function public.get_netunim_sync_capabilities() returns jsonb
language sql stable security definer set search_path=pg_catalog,public,netunim_internal as $capabilities$
 select jsonb_build_object(
 'documentOperationLedger',case when to_regclass('netunim_internal.document_sync_operations') is not null then 3 else 0 end,
 'syncIntegrity',case when to_regprocedure('netunim_internal.document_invariant_guard()') is not null then 5 else 0 end,
 'deleteIntents',case when (select count(*) from pg_trigger where tgname in ('order_management_delete_intent_guard','kupa_delete_intent_guard','shared_checks_delete_intent_guard') and tgenabled<>'D')=3 then 4 else 0 end,
 'massDeleteGuard',case when (select count(*) from pg_trigger where tgname in ('order_management_mass_destructive_guard','kupa_mass_destructive_guard','shared_checks_mass_destructive_guard') and tgenabled<>'D')=3 then 5 else 0 end,
 'restoreGroups',case when to_regclass('netunim_internal.restore_operation_groups') is not null and to_regprocedure('public.apply_restore_group_v5(uuid)') is not null then 5 else 0 end,
 'sharedChecksIntegrity',case when to_regprocedure('public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)') is not null then 5 else 0 end,
 'financeFencing',case when to_regprocedure('public.save_bank_sync_snapshot(text,jsonb,text,bigint,text,text,bigint)') is not null and to_regprocedure('public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb,text,text,bigint)') is not null then 1 else 0 end);
$capabilities$;
revoke all on function public.get_netunim_sync_capabilities() from public,anon;
grant execute on function public.get_netunim_sync_capabilities() to authenticated;
notify pgrst,'reload schema';
commit;
