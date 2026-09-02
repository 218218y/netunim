-- Core RPC contention hardening
-- Purpose: prevent one or more stale/parallel browser clients from exhausting the
-- PostgREST connection pool and taking all Data API reads offline.
-- Data safety: this migration changes function placement/definitions only. It does
-- not INSERT/UPDATE/DELETE application rows.

begin;

create schema if not exists netunim_internal;
revoke all on schema netunim_internal from public, anon;
grant usage on schema netunim_internal to authenticated;

-- Preserve the already-reviewed business implementations byte-for-byte by moving
-- them behind non-exposed wrappers. If setup.sql was re-run after an earlier
-- hardening pass, promote that newer public implementation back to internal first.
do $move$
declare
  v_public oid;
  v_internal oid;
begin
  -- Orders document
  v_public := to_regprocedure('public.save_order_management_document(text,bigint,jsonb)');
  v_internal := to_regprocedure('netunim_internal.save_order_management_document(text,bigint,jsonb)');
  if v_public is not null and v_internal is not null
     and position('netunim_internal.save_order_management_document' in pg_get_functiondef(v_public)) = 0 then
    drop function netunim_internal.save_order_management_document(text,bigint,jsonb);
    alter function public.save_order_management_document(text,bigint,jsonb) set schema netunim_internal;
  elsif v_internal is null then
    if v_public is null then raise exception 'missing save_order_management_document'; end if;
    alter function public.save_order_management_document(text,bigint,jsonb) set schema netunim_internal;
  end if;

  -- Shared checks
  v_public := to_regprocedure('public.save_shared_checks_document(text,bigint,jsonb)');
  v_internal := to_regprocedure('netunim_internal.save_shared_checks_document(text,bigint,jsonb)');
  if v_public is not null and v_internal is not null
     and position('netunim_internal.save_shared_checks_document' in pg_get_functiondef(v_public)) = 0 then
    drop function netunim_internal.save_shared_checks_document(text,bigint,jsonb);
    alter function public.save_shared_checks_document(text,bigint,jsonb) set schema netunim_internal;
  elsif v_internal is null then
    if v_public is null then raise exception 'missing save_shared_checks_document'; end if;
    alter function public.save_shared_checks_document(text,bigint,jsonb) set schema netunim_internal;
  end if;

  -- Kupa document
  v_public := to_regprocedure('public.save_kupa_document(text,bigint,jsonb)');
  v_internal := to_regprocedure('netunim_internal.save_kupa_document(text,bigint,jsonb)');
  if v_public is not null and v_internal is not null
     and position('netunim_internal.save_kupa_document' in pg_get_functiondef(v_public)) = 0 then
    drop function netunim_internal.save_kupa_document(text,bigint,jsonb);
    alter function public.save_kupa_document(text,bigint,jsonb) set schema netunim_internal;
  elsif v_internal is null then
    if v_public is null then raise exception 'missing save_kupa_document'; end if;
    alter function public.save_kupa_document(text,bigint,jsonb) set schema netunim_internal;
  end if;

  -- Finance document
  v_public := to_regprocedure('public.save_finance_sync_document(text,bigint,jsonb)');
  v_internal := to_regprocedure('netunim_internal.save_finance_sync_document(text,bigint,jsonb)');
  if v_public is not null and v_internal is not null
     and position('netunim_internal.save_finance_sync_document' in pg_get_functiondef(v_public)) = 0 then
    drop function netunim_internal.save_finance_sync_document(text,bigint,jsonb);
    alter function public.save_finance_sync_document(text,bigint,jsonb) set schema netunim_internal;
  elsif v_internal is null then
    if v_public is null then raise exception 'missing save_finance_sync_document'; end if;
    alter function public.save_finance_sync_document(text,bigint,jsonb) set schema netunim_internal;
  end if;

  -- Atomic bank snapshot
  v_public := to_regprocedure('public.save_bank_sync_snapshot(text,jsonb,text,bigint)');
  v_internal := to_regprocedure('netunim_internal.save_bank_sync_snapshot(text,jsonb,text,bigint)');
  if v_public is not null and v_internal is not null
     and position('netunim_internal.save_bank_sync_snapshot' in pg_get_functiondef(v_public)) = 0 then
    drop function netunim_internal.save_bank_sync_snapshot(text,jsonb,text,bigint);
    alter function public.save_bank_sync_snapshot(text,jsonb,text,bigint) set schema netunim_internal;
  elsif v_internal is null then
    if v_public is null then raise exception 'missing save_bank_sync_snapshot'; end if;
    alter function public.save_bank_sync_snapshot(text,jsonb,text,bigint) set schema netunim_internal;
  end if;

  -- Bank archive merge
  v_public := to_regprocedure('public.merge_bank_transactions(text,text,jsonb)');
  v_internal := to_regprocedure('netunim_internal.merge_bank_transactions(text,text,jsonb)');
  if v_public is not null and v_internal is not null
     and position('netunim_internal.merge_bank_transactions' in pg_get_functiondef(v_public)) = 0 then
    drop function netunim_internal.merge_bank_transactions(text,text,jsonb);
    alter function public.merge_bank_transactions(text,text,jsonb) set schema netunim_internal;
  elsif v_internal is null then
    if v_public is null then raise exception 'missing merge_bank_transactions'; end if;
    alter function public.merge_bank_transactions(text,text,jsonb) set schema netunim_internal;
  end if;
end
$move$;

revoke all on function netunim_internal.save_order_management_document(text,bigint,jsonb) from public, anon;
revoke all on function netunim_internal.save_shared_checks_document(text,bigint,jsonb) from public, anon;
revoke all on function netunim_internal.save_kupa_document(text,bigint,jsonb) from public, anon;
revoke all on function netunim_internal.save_finance_sync_document(text,bigint,jsonb) from public, anon;
revoke all on function netunim_internal.save_bank_sync_snapshot(text,jsonb,text,bigint) from public, anon;
revoke all on function netunim_internal.merge_bank_transactions(text,text,jsonb) from public, anon;
grant execute on function netunim_internal.save_order_management_document(text,bigint,jsonb) to authenticated;
grant execute on function netunim_internal.save_shared_checks_document(text,bigint,jsonb) to authenticated;
grant execute on function netunim_internal.save_kupa_document(text,bigint,jsonb) to authenticated;
grant execute on function netunim_internal.save_finance_sync_document(text,bigint,jsonb) to authenticated;
grant execute on function netunim_internal.save_bank_sync_snapshot(text,jsonb,text,bigint) to authenticated;
grant execute on function netunim_internal.merge_bank_transactions(text,text,jsonb) to authenticated;

-- Orders are independent of the financial domain. Busy is explicitly NOT called a
-- revision_conflict; old clients therefore stop instead of starting GET+merge+POST storms.
create or replace function public.save_order_management_document(p_document_name text,p_expected_revision bigint,p_state jsonb)
returns table(revision bigint,updated_at timestamptz)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal
as $$
declare v_owner uuid:=auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('order_management:'||v_owner::text||':'||p_document_name,0)) then
    raise exception 'save_busy' using errcode='PT429',hint='Another save is already in progress. Retry later without refreshing the revision.';
  end if;
  perform set_config('lock_timeout','100ms',true);
  begin
    return query select * from netunim_internal.save_order_management_document(p_document_name,p_expected_revision,p_state);
  exception when lock_not_available then
    raise exception 'save_busy' using errcode='PT429',hint='The document row is temporarily locked. Retry later without refreshing the revision.';
  end;
end $$;

-- All financial writers share one short per-user gate. This gives a deterministic
-- order to Kupa/checks/finance/bank writes and prevents cross-RPC lock convoys.
create or replace function public.save_shared_checks_document(p_document_name text,p_expected_revision bigint,p_state jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal
as $$
declare v_owner uuid:=auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.'; end if;
  perform set_config('lock_timeout','100ms',true);
  begin return query select * from netunim_internal.save_shared_checks_document(p_document_name,p_expected_revision,p_state);
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429',hint='A financial row is temporarily locked. Retry later.'; end;
end $$;

create or replace function public.save_kupa_document(p_document_name text,p_expected_revision bigint,p_state jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal
as $$
declare v_owner uuid:=auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.'; end if;
  perform set_config('lock_timeout','100ms',true);
  begin return query select * from netunim_internal.save_kupa_document(p_document_name,p_expected_revision,p_state);
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429',hint='A financial row is temporarily locked. Retry later.'; end;
end $$;

create or replace function public.save_finance_sync_document(p_document_name text,p_expected_revision bigint,p_state jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal
as $$
declare v_owner uuid:=auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.'; end if;
  perform set_config('lock_timeout','100ms',true);
  begin return query select * from netunim_internal.save_finance_sync_document(p_document_name,p_expected_revision,p_state);
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429',hint='A financial row is temporarily locked. Retry later.'; end;
end $$;

create or replace function public.save_bank_sync_snapshot(p_document_name text,p_bank_state jsonb,p_snapshot_token text,p_snapshot_seq bigint)
returns table(finance_revision bigint,kupa_revision bigint,updated_at timestamptz)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal
as $$
declare v_owner uuid:=auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.'; end if;
  perform set_config('lock_timeout','100ms',true);
  begin return query select * from netunim_internal.save_bank_sync_snapshot(p_document_name,p_bank_state,p_snapshot_token,p_snapshot_seq);
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429',hint='A financial row is temporarily locked. Retry later.'; end;
end $$;

create or replace function public.merge_bank_transactions(p_account_key text,p_account_role text,p_transactions jsonb)
returns table(inserted_count integer,updated_count integer,total_count integer)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal
as $$
declare v_owner uuid:=auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.'; end if;
  perform set_config('lock_timeout','100ms',true);
  begin return query select * from netunim_internal.merge_bank_transactions(p_account_key,p_account_role,p_transactions);
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429',hint='A financial row is temporarily locked. Retry later.'; end;
end $$;

revoke all on function public.save_order_management_document(text,bigint,jsonb) from public,anon;
revoke all on function public.save_shared_checks_document(text,bigint,jsonb) from public,anon;
revoke all on function public.save_kupa_document(text,bigint,jsonb) from public,anon;
revoke all on function public.save_finance_sync_document(text,bigint,jsonb) from public,anon;
revoke all on function public.save_bank_sync_snapshot(text,jsonb,text,bigint) from public,anon;
revoke all on function public.merge_bank_transactions(text,text,jsonb) from public,anon;
grant execute on function public.save_order_management_document(text,bigint,jsonb) to authenticated;
grant execute on function public.save_shared_checks_document(text,bigint,jsonb) to authenticated;
grant execute on function public.save_kupa_document(text,bigint,jsonb) to authenticated;
grant execute on function public.save_finance_sync_document(text,bigint,jsonb) to authenticated;
grant execute on function public.save_bank_sync_snapshot(text,jsonb,text,bigint) to authenticated;
grant execute on function public.merge_bank_transactions(text,text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
