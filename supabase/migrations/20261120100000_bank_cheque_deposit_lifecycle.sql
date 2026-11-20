begin;

alter table public.bank_transactions add column missing_reason text
  check (missing_reason in ('cheque_transition_unresolved'));

-- Store the original bank observation and both identities, including prior
-- presence and acknowledgements, before reusing or retiring an archive row.
create table netunim_internal.bank_cheque_deposit_transitions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  pending_transaction_id bigint not null,
  completed_transaction_id bigint not null,
  completed_merge_key text not null,
  snapshot_at timestamptz not null,
  pending_observation jsonb not null,
  primary key(owner_id,pending_transaction_id)
);
alter table netunim_internal.bank_cheque_deposit_transitions enable row level security;
revoke all on netunim_internal.bank_cheque_deposit_transitions from public,anon,authenticated;

create function netunim_internal.bank_unitemized_cheque_placeholder(p_tx public.bank_transactions)
returns boolean language sql immutable set search_path=pg_catalog,public as $$
  select coalesce(
    p_tx.status='pending' and p_tx.amount>0 and p_tx.currency='ILS'
    and p_tx.cheque and p_tx.activity_type_code=1
    and p_tx.bank_serial in ('','0') and p_tx.bank_reference='0'
    and btrim(p_tx.description)='הפק שיק-ע.ישיר'
    and p_tx.check_details->>'kind'='deposit'
    and p_tx.check_details->'checkItems'='[]'::jsonb
    and p_tx.check_details->'checkNumbers'='[]'::jsonb
    and coalesce(p_tx.check_details->>'checkCount','')=''
    and coalesce(p_tx.check_details->>'warning','')='',false)
$$;
revoke all on function netunim_internal.bank_unitemized_cheque_placeholder(public.bank_transactions)
  from public,anon,authenticated;

create or replace function netunim_internal.bank_aggregate_cheque_transition_matches(
  p_pending public.bank_transactions,p_completed jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare
  final_row public.bank_transactions;
  pack jsonb;
  pending_day date:=(p_pending.transaction_date at time zone 'Asia/Jerusalem')::date;
  value_day date:=(p_pending.processed_date at time zone 'Asia/Jerusalem')::date;
  final_day date:=((p_completed->>'date')::timestamptz at time zone 'Asia/Jerusalem')::date;
begin
  if not coalesce(
    netunim_internal.bank_unitemized_cheque_placeholder(p_pending)
    and p_completed->>'status'='completed' and p_completed->>'currency'=p_pending.currency
    and (p_completed->>'cheque')::boolean and (p_completed->>'activityTypeCode')::integer=1
    and p_completed->>'bankReference' ~ '^(-1|[0-9]*[1-9][0-9]*)$'
    and p_completed->>'bankSerial' ~ '^[1-9][0-9]*$'
    and btrim(p_completed->>'description')='הפק.שיק במכונה'
    and p_completed->'checkDetails'->>'kind'='deposit'
    and (p_completed->>'amount')::numeric=p_pending.amount
    and value_day=((p_completed->>'processedDate')::timestamptz at time zone 'Asia/Jerusalem')::date
    and (final_day=pending_day or (pending_day<value_day and final_day=value_day)),
    false) then return false; end if;

  final_row:=jsonb_populate_record(null::public.bank_transactions,
    jsonb_build_object('amount',p_completed->'amount','check_details',p_completed->'checkDetails'));
  pack:=netunim_internal.check_bank_items(final_row);
  return pack->>'kind'='valid'
    and not exists(select 1 from jsonb_array_elements(pack->'items') i
      where i->>'checkNumber'='' or i->>'bankNumber'='' or i->>'branchNumber'='' or i->>'accountNumber'='')
    and not exists(select 1 from jsonb_array_elements(pack->'items') i
      group by i-'amount' having count(*)>1);
end $$;

-- Keep the existing item-evidence comparison for claims. The ordinary merge
-- must defer this presentation to the complete snapshot, even if the running
-- balances happen to agree. Numbered placeholders keep their existing paths.
create function netunim_internal.check_bank_item_evidence_compatible(p_pending public.bank_transactions,p_completed jsonb)
returns boolean language plpgsql stable set search_path=pg_catalog,public as $$
declare nextrow public.bank_transactions; a jsonb; b jsonb; ak text; bk text;
begin
  ak:=netunim_internal.check_bank_kind(p_pending.description);bk:=netunim_internal.check_bank_kind(p_completed->>'description');
  if ak is null and bk is null then return true; end if;
  if ak is distinct from bk then return false; end if;
  nextrow:=jsonb_populate_record(null::public.bank_transactions,jsonb_build_object('amount',p_completed->'amount','check_details',p_completed->'checkDetails'));
  a:=netunim_internal.check_bank_items(p_pending);b:=netunim_internal.check_bank_items(nextrow);
  if a->>'kind'='invalid' or b->>'kind'='invalid' then return false; end if;
  if a->>'kind'='valid' and b->>'kind'='valid' then
    return jsonb_array_length(a->'items')=jsonb_array_length(b->'items') and not exists(select 1 from jsonb_array_elements(a->'items') x
      where (select count(*) from jsonb_array_elements(b->'items') y where netunim_internal.check_bank_same_item(x,y))<>1);
  end if;
  if jsonb_typeof(p_pending.check_details->'checkNumbers')='array' and jsonb_typeof(p_completed->'checkDetails'->'checkNumbers')='array'
    and p_pending.check_details->'checkNumbers'<>'[]'::jsonb and p_completed->'checkDetails'->'checkNumbers'<>'[]'::jsonb then
    return (select jsonb_agg(netunim_internal.check_bank_number(x) order by netunim_internal.check_bank_number(x)) from jsonb_array_elements_text(p_pending.check_details->'checkNumbers') x)
      =(select jsonb_agg(netunim_internal.check_bank_number(x) order by netunim_internal.check_bank_number(x)) from jsonb_array_elements_text(p_completed->'checkDetails'->'checkNumbers') x);
  end if;
  return true;
end $$;
revoke all on function netunim_internal.check_bank_item_evidence_compatible(public.bank_transactions,jsonb)
  from public,anon,authenticated;

create or replace function netunim_internal.check_bank_pending_compatible(p_pending public.bank_transactions,p_completed jsonb)
returns boolean language sql stable set search_path=pg_catalog,public as $$
  select not (netunim_internal.bank_unitemized_cheque_placeholder(p_pending)
    and coalesce(btrim(p_completed->>'description')='הפק.שיק במכונה',false))
    and netunim_internal.check_bank_item_evidence_compatible(p_pending,p_completed)
$$;
revoke all on function netunim_internal.check_bank_pending_compatible(public.bank_transactions,jsonb)
  from public,anon,authenticated;

create or replace function netunim_internal.check_bank_pending_items_equal(p_pending public.bank_transactions,p_completed jsonb)
returns boolean language plpgsql stable set search_path=pg_catalog,public as $$
declare r public.bank_transactions;
begin
  r:=jsonb_populate_record(null::public.bank_transactions,jsonb_build_object('amount',p_completed->'amount','check_details',p_completed->'checkDetails'));
  return netunim_internal.check_bank_kind(p_pending.description) in ('deposit','redeposit')
    and (netunim_internal.check_bank_items(p_pending)->>'kind'='valid' or exists(
      select 1 from netunim_internal.check_bank_claims l where l.owner_id=p_pending.owner_id and l.transaction_id=p_pending.id
        and not l.conflicted and jsonb_array_length(l.members)=jsonb_array_length(netunim_internal.check_bank_items(r)->'items')
        and not exists(select 1 from jsonb_array_elements(l.members) c where
          (select count(*) from jsonb_array_elements(netunim_internal.check_bank_items(r)->'items') i
            where netunim_internal.check_bank_same_item(coalesce(nullif(c->'bankItem','null'::jsonb),c),i))<>1)
        and not exists(select 1 from jsonb_array_elements(netunim_internal.check_bank_items(r)->'items') i where
          (select count(*) from jsonb_array_elements(l.members) c
            where netunim_internal.check_bank_same_item(coalesce(nullif(c->'bankItem','null'::jsonb),c),i))<>1)))
    and netunim_internal.check_bank_items(r)->>'kind'='valid'
    and netunim_internal.check_bank_item_evidence_compatible(p_pending,p_completed);
end $$;

drop function netunim_internal.reconcile_bank_aggregate_cheque_transition(text,text,jsonb,date,date);

create function netunim_internal.reconcile_bank_aggregate_cheque_transition(
  p_account_key text,p_account_role text,p_transactions jsonb,
  p_snapshot_at timestamptz,p_coverage_from date,p_coverage_to date)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare
  candidate record;
  v_owner uuid:=auth.uid();
  old_row public.bank_transactions;
  final_id bigint;
begin
  -- Plan from the entire observed batch and the pre-merge archive. Competing
  -- deposits include incomplete details and representations on the value day.
  for candidate in
    with source as materialized (
      select r, r->>'mergeKey' as merge_key, r->>'currency' as currency,
        (r->>'amount')::numeric as amount,
        ((r->>'date')::timestamptz at time zone 'Asia/Jerusalem')::date as tx_day,
        ((r->>'processedDate')::timestamptz at time zone 'Asia/Jerusalem')::date as value_day,
        netunim_internal.check_bank_kind(r->>'description')='deposit' as deposit
      from jsonb_array_elements(p_transactions) r
    )
    select b.id as pending_id, observed.final, archived.completed_id,
      observed.peers=1 and archived.pending_peers=0
        and archived.completed_peers=(case when archived.completed_id is null then 0 else 1 end) as unique_pair
    from public.bank_transactions b
    cross join lateral (
      select (b.transaction_date at time zone 'Asia/Jerusalem')::date as tx_day,
        (b.processed_date at time zone 'Asia/Jerusalem')::date as value_day
    ) bank_days
    cross join lateral (
      select count(*) as peers,
        bool_or(s.tx_day between p_coverage_from and p_coverage_to
          and netunim_internal.bank_aggregate_cheque_transition_matches(b,s.r)) as has_match,
        case when count(*)=1 then jsonb_agg(s.r)->0 end as final
      from source s
      where s.deposit and s.amount=b.amount and s.currency=b.currency
        and (s.value_day=bank_days.value_day or s.tx_day=bank_days.tx_day)
    ) observed
    cross join lateral (
      select count(*) filter (where a.status='pending') as pending_peers,
        count(*) filter (where a.status='completed') as completed_peers,
        min(a.id) filter (where a.status='completed'
          and a.first_seen_at>=b.first_seen_at and a.last_seen_at<=p_snapshot_at
          and a.cheque and a.activity_type_code=1 and btrim(a.description)='הפק.שיק במכונה'
          and a.bank_serial=observed.final->>'bankSerial' and a.bank_reference=observed.final->>'bankReference'
          and (a.merge_key=observed.final->>'mergeKey'
            or (a.transaction_date::date=((observed.final->>'date')::timestamptz)::date
              and not exists(select 1 from source s where s.merge_key=a.merge_key)))
          and (a.transaction_date at time zone 'Asia/Jerusalem')::date
            =((observed.final->>'date')::timestamptz at time zone 'Asia/Jerusalem')::date
          and (a.processed_date at time zone 'Asia/Jerusalem')::date=bank_days.value_day
          and a.amount=b.amount and a.currency=b.currency
          and (netunim_internal.check_bank_items(a)->>'kind'='none'
            or netunim_internal.check_bank_pending_items_equal(a,observed.final))) as completed_id
      from public.bank_transactions a
      where (a.owner_id,a.account_key,a.account_role)=(b.owner_id,b.account_key,b.account_role)
        and a.id<>b.id
        and (a.merge_key=observed.final->>'mergeKey' or (a.amount=b.amount and (
          ((a.bank_serial=observed.final->>'bankSerial'
              or (a.bank_reference=observed.final->>'bankReference'
                and a.description=observed.final->>'description'
                and a.memo=coalesce(observed.final->>'memo','')))
            and a.transaction_date::date=((observed.final->>'date')::timestamptz)::date)
          or (a.currency=b.currency and netunim_internal.check_bank_kind(a.description)='deposit'
            and ((a.processed_date at time zone 'Asia/Jerusalem')::date=bank_days.value_day
              or (a.transaction_date at time zone 'Asia/Jerusalem')::date=bank_days.tx_day)))))
    ) archived
    where (b.owner_id,b.account_key,b.account_role)=(v_owner,p_account_key,p_account_role)
      and b.status='pending' and b.presence_state in ('present','missing') and b.last_seen_at<p_snapshot_at
      and bank_days.tx_day between p_coverage_from and p_coverage_to
      and netunim_internal.bank_unitemized_cheque_placeholder(b)
      and observed.has_match
      and not exists(select 1 from source s where s.merge_key=b.merge_key)
  loop
    -- Acknowledgements can be written separately from snapshot ingestion.
    select * into strict old_row from public.bank_transactions b where b.id=candidate.pending_id for update;
    final_id:=candidate.completed_id;
    if not candidate.unique_pair
      or old_row.handled_at is not null
      or exists(select 1 from public.bank_transaction_document_links l
        where l.owner_id=v_owner and l.transaction_id=old_row.id)
      or exists(select 1 from public.morning_document_operations o
        where o.owner_id=v_owner and o.source_bank_transaction_id=old_row.id)
      or (exists(select 1 from netunim_internal.check_bank_claims c
        where c.owner_id=v_owner and c.transaction_id=old_row.id)
        and (not netunim_internal.check_bank_pending_items_equal(old_row,candidate.final)
          or exists(select 1 from netunim_internal.check_bank_claims c
            where c.owner_id=v_owner and c.transaction_id=final_id))) then
      update public.bank_transactions set missing_reason='cheque_transition_unresolved'
      where id=old_row.id and missing_reason is distinct from 'cheque_transition_unresolved';
      continue;
    end if;

    insert into netunim_internal.bank_cheque_deposit_transitions(
      owner_id,pending_transaction_id,completed_transaction_id,completed_merge_key,snapshot_at,pending_observation)
    values(v_owner,old_row.id,coalesce(final_id,old_row.id),candidate.final->>'mergeKey',p_snapshot_at,to_jsonb(old_row));

    if final_id is null then
      -- The existing merger enriches the original archive identity in place.
      update public.bank_transactions set merge_key=candidate.final->>'mergeKey' where id=old_row.id;
    else
      -- Keep the discovered final identity and any existing links to it.
      perform netunim_internal.move_check_bank_claim(old_row.id,final_id);
      delete from public.bank_transactions where id=old_row.id;
    end if;
  end loop;
end $$;
revoke all on function netunim_internal.reconcile_bank_aggregate_cheque_transition(text,text,jsonb,timestamptz,date,date)
  from public,anon,authenticated;


CREATE OR REPLACE FUNCTION netunim_internal.fenced_impl_sync_bank_transactions_snapshot(p_account_key text, p_account_role text, p_transactions jsonb, p_snapshot_at timestamp with time zone, p_coverage_from date, p_coverage_to date, p_complete boolean)
 RETURNS TABLE(inserted_count integer, updated_count integer, total_count integer, missing_count integer, active_missing_count integer, snapshot_stored boolean, baseline_created boolean)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_owner uuid:=auth.uid();
  v_inserted integer:=0;
  v_updated integer:=0;
  v_total integer:=0;
  v_previous_snapshot_at timestamptz;
  v_had_complete_snapshot boolean:=false;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if coalesce(btrim(p_account_key),'')='' or p_account_role not in ('business','home')
     or jsonb_typeof(p_transactions) is distinct from 'array'
     or p_snapshot_at is null then
    raise exception 'invalid_bank_snapshot_input' using errcode='22023';
  end if;
  if coalesce(p_complete,false) and (p_coverage_from is null or p_coverage_to is null or p_coverage_to<p_coverage_from) then
    raise exception 'invalid_bank_snapshot_coverage' using errcode='22023';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then
    raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout','100ms',true);

  select s.snapshot_at into v_previous_snapshot_at
  from public.bank_transaction_snapshots s
  where s.owner_id=v_owner and s.account_key=p_account_key and s.account_role=p_account_role
  for update;
  v_had_complete_snapshot:=v_previous_snapshot_at is not null;

  -- Reject stale evidence before inspecting or changing archive identities.
  if v_previous_snapshot_at is not null and p_snapshot_at<v_previous_snapshot_at then
    raise exception 'bank_snapshot_stale'
      using errcode='40001',hint='A newer complete bank snapshot is already stored. The stale snapshot was not applied.';
  end if;

  if coalesce(p_complete,false) then
    perform netunim_internal.reconcile_bank_aggregate_cheque_transition(
      p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to);
  end if;

  -- The lease, per-owner writer lock and transaction cover identity
  -- reconciliation, the normal merge and presence updates together.
  select m.inserted_count,m.updated_count,m.total_count
    into v_inserted,v_updated,v_total
  from netunim_internal.fenced_impl_merge_bank_transactions(p_account_key,p_account_role,p_transactions) m;

  -- Rows actually returned by the bank are present. This is safe even for a partial read; absence
  -- is the only fact that is forbidden unless the connector proved the whole requested range.
  -- Reappearance also clears an old acknowledgement so a later disappearance becomes a new incident.
  update public.bank_transactions b set
    presence_state='present',
    last_seen_at=p_snapshot_at,
    missing_since=null,
    missing_reason=null,
    missing_acknowledged_at=null
  where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
    and coalesce(b.last_seen_at,'-infinity'::timestamptz)<=p_snapshot_at
    and exists (
      select 1 from jsonb_array_elements(p_transactions) x(value)
      where x.value->>'mergeKey'=b.merge_key
    )
    and (
      b.presence_state is distinct from 'present'
      or b.last_seen_at is distinct from p_snapshot_at
      or b.missing_since is not null
      or b.missing_reason is not null
      or b.missing_acknowledged_at is not null
    );

  if coalesce(p_complete,false) then
    -- Pre-upgrade archive rows start UNKNOWN. The first complete snapshot is a baseline only: it
    -- cannot manufacture warnings for old history whose prior presence was never proven. Starting
    -- with the second complete snapshot, only previously PRESENT rows inside the connector-declared
    -- coverage window can transition to MISSING.
    if v_had_complete_snapshot then
      update public.bank_transactions b set
        presence_state='missing',
        missing_since=coalesce(b.missing_since,p_snapshot_at)
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.presence_state='present'
        and (coalesce(b.transaction_date,b.processed_date) at time zone 'Asia/Jerusalem')::date between p_coverage_from and p_coverage_to
        and (b.last_seen_at is null or b.last_seen_at<p_snapshot_at)
        and not exists (
          select 1 from jsonb_array_elements(p_transactions) x(value)
          where x.value->>'mergeKey'=b.merge_key
        );
    end if;

    insert into public.bank_transaction_snapshots(
      owner_id,account_key,account_role,snapshot_at,coverage_from,coverage_to,
      transaction_count,transactions,updated_at
    ) values (
      v_owner,p_account_key,p_account_role,p_snapshot_at,p_coverage_from,p_coverage_to,
      jsonb_array_length(p_transactions),p_transactions,now()
    )
    on conflict(owner_id,account_key,account_role) do update set
      snapshot_at=excluded.snapshot_at,
      coverage_from=excluded.coverage_from,
      coverage_to=excluded.coverage_to,
      transaction_count=excluded.transaction_count,
      transactions=excluded.transactions,
      updated_at=now()
    where public.bank_transaction_snapshots.snapshot_at<=excluded.snapshot_at;
  end if;

  select count(*)::integer into missing_count
  from public.bank_transactions b
  where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
    and b.presence_state='missing';

  select count(*)::integer into active_missing_count
  from public.bank_transactions b
  where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
    and b.presence_state='missing' and b.missing_acknowledged_at is null;

  inserted_count:=coalesce(v_inserted,0);
  updated_count:=coalesce(v_updated,0);
  total_count:=coalesce(v_total,0);
  snapshot_stored:=coalesce(p_complete,false);
  baseline_created:=coalesce(p_complete,false) and not v_had_complete_snapshot;
  return next;
end $function$;

commit;
