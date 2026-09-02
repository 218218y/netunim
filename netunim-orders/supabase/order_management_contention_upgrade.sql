-- Production-safe additive fix for PostgREST pool exhaustion caused by concurrent
-- save_order_management_document callers queueing on SELECT ... FOR UPDATE.
-- No table rows are changed by this upgrade; only the RPC definition is replaced.

begin;

create or replace function public.save_order_management_document(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb
)
returns table(revision bigint, updated_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid := auth.uid();
  v_current_revision bigint;
  v_old_state jsonb;
  v_old_updated_at timestamptz;
  v_new_revision bigint;
  v_new_updated_at timestamptz;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_document_name is null or btrim(p_document_name) = '' then
    raise exception 'invalid_document_name' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_expected_revision' using errcode = '22023';
  end if;
  if p_state is null
     or jsonb_typeof(p_state) is distinct from 'object'
     or (p_state ? 'checks')
     or jsonb_typeof(p_state->'suppliers') is distinct from 'array'
     or jsonb_typeof(p_state->'transactions') is distinct from 'array'
     or jsonb_typeof(p_state->'customerDebts') is distinct from 'array'
     or jsonb_typeof(p_state->'customerOrders') is distinct from 'array'
     or jsonb_typeof(p_state->'serviceCalls') is distinct from 'array'
     or jsonb_typeof(p_state->'inventoryItems') is distinct from 'array'
     or jsonb_typeof(p_state->'inventoryCategoryOrder') is distinct from 'array'
     or jsonb_typeof(p_state->'inventoryEvents') is distinct from 'array'
     or jsonb_typeof(p_state->'warehouseOrders') is distinct from 'array'
     or jsonb_typeof(p_state->'notes') is distinct from 'array' then
    raise exception 'invalid_order_management_state'
      using errcode = '22023',
            hint = 'Post-cutover order state is missing required arrays or still contains checks.';
  end if;

  perform set_config('app.order_management_rpc_write', '1', true);

  -- Busy is not a revision conflict. Failing fast prevents a stale/parallel client
  -- from turning one active writer into a PostgREST connection-pool convoy.
  if not pg_try_advisory_xact_lock(
    hashtextextended('order_management:' || v_owner::text || ':' || p_document_name, 0)
  ) then
    raise exception 'save_busy'
      using errcode = 'PT429',
            hint = 'Another save is already in progress. Retry later without refreshing the revision.';
  end if;
  perform set_config('lock_timeout', '100ms', true);

  begin
    select d.revision, d.state, d.updated_at
      into v_current_revision, v_old_state, v_old_updated_at
    from public.order_management_documents d
    where d.owner_id = v_owner and d.document_name = p_document_name
    for update nowait;
  exception when lock_not_available then
    raise exception 'save_busy'
      using errcode = 'PT429',
            hint = 'The document row is temporarily locked. Retry later without refreshing the revision.';
  end;

  if v_current_revision is null then
    if coalesce(p_expected_revision,0) <> 0 then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
    insert into public.order_management_documents(owner_id, document_name, revision, state, updated_at)
    values (v_owner, p_document_name, 1, p_state, now())
    returning order_management_documents.revision, order_management_documents.updated_at
      into v_new_revision, v_new_updated_at;
    insert into public.order_management_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, p_state, v_new_updated_at)
    on conflict do nothing;
    return query select v_new_revision, v_new_updated_at;
    return;
  end if;

  -- savedAt משתנה בכל prepareState ולכן אינו חלק מהשוואת התוכן העסקי.
  -- הבדיקה קודמת ל-revision conflict כדי לתמוך ב-retry לאחר ACK שאבד.
  if (v_old_state #- '{_meta,savedAt}') = (p_state #- '{_meta,savedAt}') then
    return query select v_current_revision, v_old_updated_at;
    return;
  end if;
  if v_current_revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  insert into public.order_management_document_backups(owner_id, document_name, revision, state, saved_at)
  values (v_owner, p_document_name, v_current_revision, v_old_state, v_old_updated_at)
  on conflict do nothing;

  update public.order_management_documents d
  set revision=d.revision+1, state=p_state, updated_at=now()
  where d.owner_id=v_owner and d.document_name=p_document_name
  returning d.revision, d.updated_at into v_new_revision, v_new_updated_at;

  if not exists (
    select 1 from public.order_management_periodic_backups p
    where p.owner_id=v_owner and p.document_name=p_document_name
      and p.saved_at > now() - interval '12 hours'
  ) then
    insert into public.order_management_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, p_state, v_new_updated_at)
    on conflict do nothing;
  end if;

  delete from public.order_management_periodic_backups p
  where p.owner_id=v_owner and p.document_name=p_document_name
    and p.saved_at < now() - interval '365 days';
  delete from public.order_management_document_backups b
  where b.owner_id=v_owner and b.document_name=p_document_name
    and b.id in (
      select x.id from public.order_management_document_backups x
      where x.owner_id=v_owner and x.document_name=p_document_name
      order by x.saved_at desc, x.id desc offset 200
    );

  return query select v_new_revision, v_new_updated_at;
end;
$$;
revoke all on function public.save_order_management_document(text, bigint, jsonb) from public, anon;
grant execute on function public.save_order_management_document(text, bigint, jsonb) to authenticated;

commit;
