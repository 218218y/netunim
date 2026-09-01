-- Financial Sync Integrity v2
-- Safe to run after financial_sync_archive_upgrade.sql. This step is non-destructive:
-- it fixes archive identity/matching and Kupa backup boundaries, but it does NOT delete legacy payloads yet.

do $$
begin
  if to_regclass('public.finance_sync_documents') is null or to_regclass('public.bank_transactions') is null then
    raise exception 'financial_sync_archive_upgrade_required' using hint='Run financial_sync_archive_upgrade.sql first.';
  end if;
end $$;

create or replace function public.save_kupa_document(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb
)
returns table(revision bigint, updated_at timestamptz, state jsonb)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid := auth.uid();
  v_current_revision bigint;
  v_old_state jsonb;
  v_old_updated_at timestamptz;
  v_server_state jsonb;
  v_bank jsonb;
  v_old_bank jsonb;
  v_new_token text;
  v_old_token text;
  v_requested_snapshot_num numeric;
  v_requested_snapshot_seq bigint;
  v_old_snapshot_seq bigint := 0;
  v_shared_max_seq bigint := 0;
  v_now timestamptz;
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
     or jsonb_typeof(p_state->'credits') is distinct from 'array'
     or jsonb_typeof(p_state->'cash') is distinct from 'array'
     or jsonb_typeof(p_state->'expenses') is distinct from 'array'
     or jsonb_typeof(p_state->'cards') is distinct from 'array'
     or jsonb_typeof(p_state->'bank') is distinct from 'object'
     or jsonb_typeof(p_state#>'{bank,adjustments}') is distinct from 'array' then
    raise exception 'invalid_kupa_state'
      using errcode = '22023',
            hint = 'Post-cutover state must contain credits/cash/expenses/cards arrays and bank object, without checks.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_state#>'{bank,adjustments}') a
    where a->>'type' = 'check_deposit'
  ) then
    raise exception 'legacy_check_deposit_forbidden'
      using errcode = '22023', hint = 'Check deposits are derived from shared_checks_documents after cutover.';
  end if;

  perform set_config('app.kupa_rpc_write', '1', true);

  select d.revision, d.state, d.updated_at
    into v_current_revision, v_old_state, v_old_updated_at
  from public.kupa_documents d
  where d.owner_id = v_owner and d.document_name = p_document_name
  for update;

  v_server_state := p_state;
  v_bank := p_state->'bank';
  v_old_bank := coalesce(v_old_state->'bank','{}'::jsonb);
  v_new_token := nullif(v_bank->>'snapshotToken','');
  v_old_token := nullif(v_old_bank->>'snapshotToken','');

  if v_new_token is distinct from v_old_token and v_new_token is not null then
    if jsonb_typeof(v_bank->'snapshotSeq') is distinct from 'number'
       or (v_bank->>'source' = 'manual' and jsonb_typeof(v_bank->'currentBalance') is distinct from 'number') then
      raise exception 'invalid_bank_snapshot' using errcode = '22023';
    end if;

    -- snapshotSeq הוא watermark שהלקוח באמת ראה אחרי sync של מאגר הצ'קים.
    -- אסור לשרת להקצות כאן sequence חדש: אירוע צ'ק מקביל שלא נצפה חייב להישאר אחרי ה-baseline.
    v_requested_snapshot_num := (v_bank->>'snapshotSeq')::numeric;
    if v_requested_snapshot_num < 0
       or v_requested_snapshot_num <> trunc(v_requested_snapshot_num)
       or v_requested_snapshot_num > 9223372036854775807::numeric then
      raise exception 'invalid_bank_snapshot_sequence' using errcode = '22023';
    end if;
    v_requested_snapshot_seq := v_requested_snapshot_num::bigint;

    if jsonb_typeof(v_old_bank->'snapshotSeq') = 'number' then
      begin
        v_old_snapshot_seq := greatest(0, (v_old_bank->>'snapshotSeq')::bigint);
      exception when others then
        raise exception 'invalid_existing_bank_snapshot_sequence' using errcode = '22023';
      end;
    end if;

    select coalesce(max((e.value->>'seq')::bigint), 0)
      into v_shared_max_seq
    from public.shared_checks_documents s
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(s.state->'bankEvents')='array' then s.state->'bankEvents' else '[]'::jsonb end
    ) e(value) on true
    where s.owner_id = v_owner and s.document_name = 'main';
    v_shared_max_seq := coalesce(v_shared_max_seq, 0);

    if v_requested_snapshot_seq < v_old_snapshot_seq then
      raise exception 'stale_bank_snapshot_watermark'
        using errcode = '40001', hint = 'Refresh shared checks before saving a new bank snapshot.';
    end if;
    if v_requested_snapshot_seq > greatest(v_old_snapshot_seq, v_shared_max_seq) then
      raise exception 'bank_snapshot_watermark_ahead_of_server'
        using errcode = '22023', hint = 'The client watermark was not observed in shared check events.';
    end if;

    v_now := clock_timestamp();
    v_bank := v_bank || jsonb_build_object('snapshotSeq', v_requested_snapshot_seq);
    if v_bank->>'source' = 'manual' then
      v_bank := v_bank || jsonb_build_object('updatedAt', v_now);
    end if;
  elsif v_old_state is not null then
    -- Lightweight bank snapshot metadata is server-authoritative; ordinary Kupa saves cannot roll it back.
    v_bank := v_bank || jsonb_build_object(
      'snapshotToken', coalesce(v_old_bank->'snapshotToken','null'::jsonb),
      'snapshotSeq', coalesce(v_old_bank->'snapshotSeq','null'::jsonb),
      'updatedAt', case when v_bank->>'source' = 'manual' then coalesce(v_old_bank->'updatedAt','null'::jsonb) else 'null'::jsonb end
    );
  else
    v_bank := v_bank || jsonb_build_object('snapshotSeq', null);
  end if;

  -- Financial feeds and credit-company sync are stored in finance_sync_documents / bank_transactions,
  -- never in the Kupa document or its snapshot backups. Keep only the tiny Kupa-owned bank baseline metadata.
  v_bank := jsonb_build_object(
    'currentBalance', case when v_bank->>'source' = 'manual' then coalesce(v_bank->'currentBalance','null'::jsonb) else 'null'::jsonb end,
    'updatedAt', case when v_bank->>'source' = 'manual' then coalesce(v_bank->'updatedAt','null'::jsonb) else 'null'::jsonb end,
    'asOfDate', case when v_bank->>'source' = 'manual' then coalesce(v_bank->'asOfDate','null'::jsonb) else 'null'::jsonb end,
    'adjustments', coalesce(v_bank->'adjustments','[]'::jsonb),
    'source', case when v_bank->>'source' = 'manual' then 'manual'::text else null end,
    'sourceAccount', null,
    'snapshotToken', coalesce(v_bank->'snapshotToken','null'::jsonb),
    'snapshotSeq', coalesce(v_bank->'snapshotSeq','null'::jsonb)
  );
  v_server_state := (v_server_state - 'bank' - 'creditSync') || jsonb_build_object('bank', v_bank);

  if v_current_revision is null then
    if coalesce(p_expected_revision,0) <> 0 then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
    insert into public.kupa_documents(owner_id, document_name, revision, state, updated_at)
    values (v_owner, p_document_name, 1, v_server_state, now())
    returning kupa_documents.revision, kupa_documents.updated_at, kupa_documents.state
      into v_new_revision, v_new_updated_at, v_server_state;
    insert into public.kupa_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, v_server_state, v_new_updated_at)
    on conflict do nothing;
    return query select v_new_revision, v_new_updated_at, v_server_state;
    return;
  end if;

  -- ACK שאבד: קודם בודקים אם התוכן שכבר בשרת הוא בדיוק התוכן המבוקש.
  if v_old_state = v_server_state then
    return query select v_current_revision, v_old_updated_at, v_old_state;
    return;
  end if;
  if v_current_revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  insert into public.kupa_document_backups(owner_id, document_name, revision, state, saved_at)
  values (v_owner, p_document_name, v_current_revision, v_old_state, v_old_updated_at)
  on conflict do nothing;

  update public.kupa_documents d
  set revision = d.revision + 1, state = v_server_state, updated_at = now()
  where d.owner_id = v_owner and d.document_name = p_document_name
  returning d.revision, d.updated_at, d.state
    into v_new_revision, v_new_updated_at, v_server_state;

  if not exists (
    select 1 from public.kupa_periodic_backups p
    where p.owner_id = v_owner and p.document_name = p_document_name
      and p.saved_at > now() - interval '12 hours'
  ) then
    insert into public.kupa_periodic_backups(owner_id, document_name, revision, state, saved_at)
    values (v_owner, p_document_name, v_new_revision, v_server_state, v_new_updated_at)
    on conflict do nothing;
  end if;

  delete from public.kupa_periodic_backups p
  where p.owner_id = v_owner and p.document_name = p_document_name
    and p.saved_at < now() - interval '365 days';
  delete from public.kupa_document_backups b
  where b.owner_id = v_owner and b.document_name = p_document_name
    and b.id in (
      select x.id from public.kupa_document_backups x
      where x.owner_id = v_owner and x.document_name = p_document_name
      order by x.saved_at desc, x.id desc offset 200
    );

  return query select v_new_revision, v_new_updated_at, v_server_state;
end;
$$;
revoke all on function public.save_kupa_document(text, bigint, jsonb) from public, anon;
grant execute on function public.save_kupa_document(text, bigint, jsonb) to authenticated;



-- Atomically publish a verified bank snapshot and advance the Kupa cheque watermark.
-- The heavy bank payload stays only in finance_sync_documents; kupa_documents retains only
-- the tiny snapshot metadata needed to apply cheque events exactly once.
create or replace function public.save_bank_sync_snapshot(
  p_document_name text,
  p_bank_state jsonb,
  p_snapshot_token text,
  p_snapshot_seq bigint
)
returns table(finance_revision bigint, kupa_revision bigint, updated_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid := auth.uid();
  v_kupa_state jsonb;
  v_kupa_bank jsonb;
  v_old_snapshot_seq bigint := 0;
  v_shared_max_seq bigint := 0;
  v_finance_state jsonb;
  v_finance_revision bigint;
  v_kupa_revision bigint;
  v_now timestamptz := clock_timestamp();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_bank_state is null or jsonb_typeof(p_bank_state) is distinct from 'object' then raise exception 'invalid_bank_sync_state' using errcode='22023'; end if;
  if coalesce(btrim(p_snapshot_token),'')='' then raise exception 'invalid_bank_snapshot_token' using errcode='22023'; end if;
  if p_snapshot_seq is null or p_snapshot_seq<0 then raise exception 'invalid_bank_snapshot_sequence' using errcode='22023'; end if;

  -- Lock Kupa first. No other finance RPC locks both rows, so this gives one deterministic order.
  select d.state,d.revision into v_kupa_state,v_kupa_revision
  from public.kupa_documents d
  where d.owner_id=v_owner and d.document_name=p_document_name
  for update;
  if v_kupa_state is null then raise exception 'kupa_document_not_found' using errcode='P0002'; end if;

  v_kupa_bank:=coalesce(v_kupa_state->'bank','{}'::jsonb);
  if jsonb_typeof(v_kupa_bank->'snapshotSeq')='number' then
    begin v_old_snapshot_seq:=greatest(0,(v_kupa_bank->>'snapshotSeq')::bigint);
    exception when others then raise exception 'invalid_existing_bank_snapshot_sequence' using errcode='22023'; end;
  end if;

  select coalesce(max((e.value->>'seq')::bigint),0) into v_shared_max_seq
  from public.shared_checks_documents s
  left join lateral jsonb_array_elements(case when jsonb_typeof(s.state->'bankEvents')='array' then s.state->'bankEvents' else '[]'::jsonb end) e(value) on true
  where s.owner_id=v_owner and s.document_name='main';
  v_shared_max_seq:=coalesce(v_shared_max_seq,0);

  if p_snapshot_seq<v_old_snapshot_seq then
    raise exception 'stale_bank_snapshot_watermark' using errcode='40001',hint='Refresh shared checks before saving the bank snapshot.';
  end if;
  if p_snapshot_seq>greatest(v_old_snapshot_seq,v_shared_max_seq) then
    raise exception 'bank_snapshot_watermark_ahead_of_server' using errcode='22023',hint='The requested watermark was not observed in shared check events.';
  end if;

  select f.state,f.revision into v_finance_state,v_finance_revision
  from public.finance_sync_documents f
  where f.owner_id=v_owner and f.document_name=p_document_name
  for update;

  if v_finance_revision is null then
    insert into public.finance_sync_documents(owner_id,document_name,revision,state,updated_at)
    values(v_owner,p_document_name,1,jsonb_build_object('bank',p_bank_state,'creditSync',null),v_now)
    returning revision into v_finance_revision;
  else
    v_finance_state:=coalesce(v_finance_state,'{}'::jsonb);
    update public.finance_sync_documents f
    set revision=f.revision+1,
        state=jsonb_set(v_finance_state,'{bank}',p_bank_state,true),
        updated_at=v_now
    where f.owner_id=v_owner and f.document_name=p_document_name
    returning f.revision into v_finance_revision;
  end if;

  -- Direct Kupa writes are guarded; mark this transaction as an approved RPC write.
  perform set_config('app.kupa_rpc_write','1',true);
  v_kupa_bank:=jsonb_build_object(
    'currentBalance',null,
    'updatedAt',null,
    'asOfDate',null,
    'adjustments',coalesce(v_kupa_bank->'adjustments','[]'::jsonb),
    'source',null,
    'sourceAccount',null,
    'snapshotToken',p_snapshot_token,
    'snapshotSeq',p_snapshot_seq
  );
  v_kupa_state:=(v_kupa_state-'bank'-'creditSync')||jsonb_build_object('bank',v_kupa_bank);
  update public.kupa_documents d
  set revision=d.revision+1,state=v_kupa_state,updated_at=v_now
  where d.owner_id=v_owner and d.document_name=p_document_name
  returning d.revision into v_kupa_revision;

  finance_revision:=v_finance_revision;kupa_revision:=v_kupa_revision;updated_at:=v_now;return next;
end $$;
revoke all on function public.save_bank_sync_snapshot(text,jsonb,text,bigint) from public,anon;
grant execute on function public.save_bank_sync_snapshot(text,jsonb,text,bigint) to authenticated;

create or replace function public.merge_bank_transactions(p_account_key text,p_account_role text,p_transactions jsonb)
returns table(inserted_count integer, updated_count integer, total_count integer)
language plpgsql
set search_path=pg_catalog,public
as $$
declare
  v_owner uuid:=auth.uid();
  r jsonb;
  v_id bigint;
  v_inserted int:=0;
  v_updated int:=0;
  v_candidates int;
  v_candidate bigint;
  v_date timestamptz;
  v_processed timestamptz;
  v_amount numeric;
  v_serial text;
  v_reference text;
  v_description text;
  v_memo text;
  v_party_name text;
  v_status text;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if coalesce(btrim(p_account_key),'')='' or p_account_role not in ('business','home') or jsonb_typeof(p_transactions) is distinct from 'array' then raise exception 'invalid_bank_merge_input' using errcode='22023'; end if;

  -- A duplicate merge key means the client could not distinguish two source rows. Fail atomically
  -- instead of silently collapsing financial movements. Fallback rows receive occurrence suffixes.
  if exists (
    select 1
    from jsonb_array_elements(p_transactions) x(value)
    group by x.value->>'mergeKey'
    having coalesce(x.value->>'mergeKey','')='' or count(*)>1
  ) then
    raise exception 'bank_archive_ambiguous_source_identity'
      using errcode='22023', hint='The bank returned rows that cannot be given unique stable identities. No archive rows were changed.';
  end if;

  for r in select value from jsonb_array_elements(p_transactions) loop
    if nullif(r->>'amount','') is null then raise exception 'invalid_bank_transaction_amount' using errcode='22023'; end if;
    v_date:=nullif(r->>'date','')::timestamptz;
    v_processed:=nullif(r->>'processedDate','')::timestamptz;
    v_amount:=(r->>'amount')::numeric;
    v_serial:=coalesce(r->>'bankSerial','');
    v_reference:=coalesce(r->>'bankReference','');
    v_description:=coalesce(r->>'description','');
    v_memo:=coalesce(r->>'memo','');
    v_party_name:=coalesce(r->>'partyName','');
    v_status:=case when r->>'status'='pending' then 'pending' else 'completed' end;
    v_id:=null;

    -- Hapoalim reference numbers are not globally unique. The bank serial is day-scoped and is
    -- the strongest stable identifier available for completed rows, so date is part of every match.
    if v_date is not null and v_serial not in ('','0') then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.transaction_date::date=v_date::date and b.bank_serial=v_serial and b.amount=v_amount;
      if v_candidates>1 then
        raise exception 'bank_archive_existing_identity_collision'
          using errcode='40001', hint='More than one archived row matches the same bank date/serial/amount identity. No merge was committed.';
      elsif v_candidates=1 then v_id:=v_candidate; end if;
    end if;
    if v_id is null and v_date is not null and v_reference<>'' then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.transaction_date::date=v_date::date and b.bank_reference=v_reference and b.amount=v_amount
        and b.description=v_description and b.memo=v_memo;
      if v_candidates>1 then
        raise exception 'bank_archive_existing_identity_collision'
          using errcode='40001', hint='More than one archived row matches the same bank date/reference/amount/content identity. No merge was committed.';
      elsif v_candidates=1 then v_id:=v_candidate; end if;
    end if;

    -- Pending -> completed reconciliation is deliberately conservative. Prefer the same bank
    -- reference across a small date shift; only fall back to content when at least one strong
    -- beneficiary/memo field exists and every supplied strong field matches exactly.
    if v_id is null and v_status='completed' and v_date is not null and v_reference<>'' then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.status='pending' and b.amount=v_amount and b.bank_reference=v_reference
        and b.transaction_date between (v_date-interval '3 days') and (v_date+interval '3 days');
      if v_candidates=1 then v_id:=v_candidate; end if;
    end if;
    if v_id is null and v_status='completed' and v_date is not null and (v_memo<>'' or v_party_name<>'') then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.status='pending' and b.amount=v_amount and b.description=v_description
        and (v_memo='' or b.memo=v_memo) and (v_party_name='' or b.party_name=v_party_name)
        and b.transaction_date between (v_date-interval '3 days') and (v_date+interval '3 days');
      if v_candidates=1 then v_id:=v_candidate; end if;
    end if;
    if v_id is null and coalesce(r->>'mergeKey','')<>'' then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role and b.merge_key=r->>'mergeKey';
      if v_candidates>1 then
        raise exception 'bank_archive_existing_merge_key_collision'
          using errcode='40001', hint='More than one archived row has the same merge key. No merge was committed.';
      elsif v_candidates=1 then v_id:=v_candidate; end if;
    end if;

    if v_id is null then
      insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,transaction_date,processed_date,amount,currency,description,memo,party_name,party_headline,message_headline,message_detail,status,balance_after,bank_reference,bank_serial,activity_type_code,cheque,check_details)
      values(v_owner,p_account_key,p_account_role,r->>'mergeKey',v_date,v_processed,v_amount,coalesce(nullif(r->>'currency',''),'ILS'),v_description,coalesce(r->>'memo',''),coalesce(r->>'partyName',''),coalesce(r->>'partyHeadline',''),coalesce(r->>'messageHeadline',''),coalesce(r->>'messageDetail',''),v_status,nullif(r->>'balanceAfter','')::numeric,v_reference,v_serial,nullif(r->>'activityTypeCode','')::integer,coalesce((r->>'cheque')::boolean,false),r->'checkDetails');
      v_inserted:=v_inserted+1;
    else
      update public.bank_transactions b set
        merge_key=coalesce(nullif(r->>'mergeKey',''),b.merge_key),
        transaction_date=coalesce(v_date,b.transaction_date),
        processed_date=coalesce(v_processed,b.processed_date),
        currency=coalesce(nullif(r->>'currency',''),b.currency),
        description=coalesce(nullif(r->>'description',''),b.description),
        memo=coalesce(r->>'memo',b.memo),
        party_name=coalesce(r->>'partyName',b.party_name),
        party_headline=coalesce(r->>'partyHeadline',b.party_headline),
        message_headline=coalesce(r->>'messageHeadline',b.message_headline),
        message_detail=coalesce(r->>'messageDetail',b.message_detail),
        status=case when v_status='pending' and b.status='completed' then b.status else v_status end,
        balance_after=coalesce(nullif(r->>'balanceAfter','')::numeric,b.balance_after),
        bank_reference=coalesce(nullif(r->>'bankReference',''),b.bank_reference),
        bank_serial=coalesce(nullif(r->>'bankSerial',''),b.bank_serial),
        activity_type_code=coalesce(nullif(r->>'activityTypeCode','')::integer,b.activity_type_code),
        cheque=coalesce((r->>'cheque')::boolean,b.cheque),
        check_details=coalesce(r->'checkDetails',b.check_details),
        last_changed_at=now()
      where b.id=v_id and (
        b.merge_key is distinct from coalesce(nullif(r->>'mergeKey',''),b.merge_key)
        or b.transaction_date is distinct from coalesce(v_date,b.transaction_date)
        or b.processed_date is distinct from coalesce(v_processed,b.processed_date)
        or b.currency is distinct from coalesce(nullif(r->>'currency',''),b.currency)
        or b.description is distinct from coalesce(nullif(r->>'description',''),b.description)
        or b.memo is distinct from coalesce(r->>'memo',b.memo)
        or b.party_name is distinct from coalesce(r->>'partyName',b.party_name)
        or b.party_headline is distinct from coalesce(r->>'partyHeadline',b.party_headline)
        or b.message_headline is distinct from coalesce(r->>'messageHeadline',b.message_headline)
        or b.message_detail is distinct from coalesce(r->>'messageDetail',b.message_detail)
        or b.status is distinct from (case when v_status='pending' and b.status='completed' then b.status else v_status end)
        or b.balance_after is distinct from coalesce(nullif(r->>'balanceAfter','')::numeric,b.balance_after)
        or b.bank_reference is distinct from coalesce(nullif(r->>'bankReference',''),b.bank_reference)
        or b.bank_serial is distinct from coalesce(nullif(r->>'bankSerial',''),b.bank_serial)
        or b.activity_type_code is distinct from coalesce(nullif(r->>'activityTypeCode','')::integer,b.activity_type_code)
        or b.cheque is distinct from coalesce((r->>'cheque')::boolean,b.cheque)
        or b.check_details is distinct from coalesce(r->'checkDetails',b.check_details)
      );
      if found then v_updated:=v_updated+1; end if;
    end if;
  end loop;
  -- Self-verify the statement before returning. If any source row failed to become the exact
  -- archived row for its merge key, raise and let PostgreSQL roll the whole RPC statement back.
  if exists (
    select 1
    from jsonb_array_elements(p_transactions) x(value)
    where not exists (
      select 1 from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.merge_key=x.value->>'mergeKey'
        and (nullif(x.value->>'date','') is null or b.transaction_date is not distinct from (x.value->>'date')::timestamptz)
        and (nullif(x.value->>'processedDate','') is null or b.processed_date is not distinct from (x.value->>'processedDate')::timestamptz)
        and b.amount=(x.value->>'amount')::numeric
        and b.description=coalesce(x.value->>'description','')
        and b.memo=coalesce(x.value->>'memo','')
        and (coalesce(x.value->>'bankReference','')='' or b.bank_reference=x.value->>'bankReference')
        and (coalesce(x.value->>'bankSerial','')='' or b.bank_serial=x.value->>'bankSerial')
        and (case when x.value->>'status'='pending' then b.status in ('pending','completed') else b.status='completed' end)
    )
  ) then
    raise exception 'bank_archive_merge_verification_failed'
      using errcode='40001', hint='The transaction merge did not reproduce every bank row exactly. The entire RPC was rolled back.';
  end if;

  select count(*)::int into total_count from public.bank_transactions b where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role;
  inserted_count:=v_inserted; updated_count:=v_updated; return next;
end $$;
revoke all on function public.merge_bank_transactions(text,text,jsonb) from public,anon;
grant execute on function public.merge_bank_transactions(text,text,jsonb) to authenticated;

