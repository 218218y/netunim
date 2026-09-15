begin;
-- Delete notification payloads only. Bank claims/current evidence remain intact.
create or replace function netunim_internal.check_bank_prune_history(p_check jsonb,p_at timestamptz,p_requested jsonb default '[]')
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare h jsonb; history jsonb:='[]'; m jsonb:=p_check->'bankMatch'; quiet boolean; requested boolean; expired boolean; current_event boolean;
begin
  for h in select value from jsonb_array_elements(case when jsonb_typeof(p_check->'bankHistory')='array' then p_check->'bankHistory' else '[]'::jsonb end) loop
    current_event:=h->>'eventId'=m->>'eventId';
    quiet:=coalesce(not (h ? 'warning') and (h->>'phase'='cleared' or (h->>'phase'='deposited' and h->>'autoConfirmed'='true')),false);
    requested:=coalesce(p_requested ? (h->>'eventId'),false) and
      (not current_event or quiet or p_check->>'bankReview'=m->>'eventId');
    expired:=quiet and netunim_internal.check_bank_date(left(h->>'recordedAt',10)) <= (p_at at time zone 'Asia/Jerusalem')::date-60;
    if coalesce(requested or expired,false) then
      if current_event then p_check:=p_check||jsonb_build_object('bankHistoryHiddenEvent',m->>'eventId'); end if;
    else history:=history||jsonb_build_array(h); end if;
  end loop;
  -- Current evidence can predate history recording; an explicit safe dismissal
  -- must suppress its UI fallback too, without dropping the tracking metadata.
  if coalesce(p_requested ? (m->>'eventId'),false) and
    (p_check->>'bankReview'=m->>'eventId' or (not (m ? 'warning') and
      (m->>'phase'='cleared' or (m->>'phase'='deposited' and m->>'autoConfirmed'='true')))) then
    p_check:=p_check||jsonb_build_object('bankHistoryHiddenEvent',m->>'eventId');
  end if;
  return case when p_check ? 'bankHistory' then p_check||jsonb_build_object('bankHistory',history) else p_check end;
end $$;

create or replace function netunim_internal.check_bank_record_history(p_check jsonb,p_at timestamptz)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare history jsonb:=case when jsonb_typeof(p_check->'bankHistory')='array' then p_check->'bankHistory' else '[]'::jsonb end;
  m jsonb:=p_check->'bankMatch';
begin
  if m->>'eventId' is not null and m->>'phase'<>'manual'
    and coalesce(p_check->>'bankHistoryHiddenEvent','')<>m->>'eventId'
    and not exists(select 1 from jsonb_array_elements(history) h where h->>'eventId'=m->>'eventId') then
    p_check:=p_check||jsonb_build_object('bankHistory',history||jsonb_build_array(m||jsonb_build_object(
      'recordedAt',p_at,'checkName',p_check->>'name','checkAmount',p_check->'amount',
      'checkNumber',p_check->>'checkNumber','checkAccount',coalesce(p_check->>'account','עסקי'),'checkStatus',p_check->>'status')));
  end if;
  return netunim_internal.check_bank_prune_history(p_check,p_at);
end $$;

create or replace function netunim_internal.protect_check_bank_metadata()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb; oldc jsonb; rows jsonb:='[]'; linked boolean; material_changed boolean; number_changed boolean; requested jsonb;
begin
  if current_setting('app.check_bank_reconcile',true)='1' then return new; end if;
  for c in select value from jsonb_array_elements(new.state->'checks') loop
    select value into oldc from jsonb_array_elements(case when tg_op='UPDATE' then old.state->'checks' else '[]'::jsonb end)
      where value->>'id'=c->>'id';
    requested:=case when jsonb_typeof(c->'bankHistoryDismiss')='array' then c->'bankHistoryDismiss' else '[]'::jsonb end;
    c:=c-'bankMatch'-'bankHistory'-'bankHistoryDismiss'-'bankHistoryHiddenEvent';
    if oldc ? 'bankHistoryHiddenEvent' then c:=c||jsonb_build_object('bankHistoryHiddenEvent',oldc->'bankHistoryHiddenEvent'); end if;
    if oldc ? 'bankHistory' then c:=c||jsonb_build_object('bankHistory',oldc->'bankHistory'); end if;
    material_changed:=(c->>'status',c->>'amount',c->>'dueDate',coalesce(c->>'account','עסקי'))
      is distinct from (oldc->>'status',oldc->>'amount',oldc->>'dueDate',coalesce(oldc->>'account','עסקי'));
    number_changed:=netunim_internal.check_bank_number(c->>'checkNumber')
      is distinct from netunim_internal.check_bank_number(oldc->>'checkNumber');
    select exists(select 1 from netunim_internal.check_bank_claims l
      where l.owner_id=new.owner_id and l.document_name=new.document_name and l.check_ids ? (c->>'id')
        and (l.transaction_id::text=oldc->'bankMatch'->>'transactionId'
          or l.previous_transaction_ids ? (oldc->'bankMatch'->>'transactionId'))) into linked;

    if linked then
      c:=c||jsonb_build_object('bankMatch',oldc->'bankMatch');
      if material_changed or (number_changed and (
        netunim_internal.check_bank_number(oldc->>'checkNumber')<>''
        or (coalesce(oldc->'bankMatch'->'bankItem'->>'checkNumber','')<>''
          and netunim_internal.check_bank_number(c->>'checkNumber')<>oldc->'bankMatch'->'bankItem'->>'checkNumber'))) then
        c:=c||jsonb_build_object('bankAutomationDisabled',true,
          'bankMatch',((oldc->'bankMatch')-'autoConfirmed')||'{"phase":"manual"}'::jsonb);
      end if;
    elsif oldc ? 'bankMatch' and not material_changed and not number_changed then
      -- Unchanged advisories retain their acknowledgement; editing their inputs
      -- discards the old proposal and lets the next complete snapshot reassess.
      c:=c||jsonb_build_object('bankMatch',oldc->'bankMatch');
    end if;

    if not c ? 'bankAutomationDisabled' and oldc ? 'bankAutomationDisabled' then
      c:=c||jsonb_build_object('bankAutomationDisabled',oldc->'bankAutomationDisabled');
    end if;
    if not c ? 'bankReview' and oldc ? 'bankReview' then c:=c||jsonb_build_object('bankReview',oldc->'bankReview'); end if;
    if c->>'bankAutomationDisabled'='true' and c ? 'bankMatch' then
      c:=jsonb_set(c,'{bankMatch}',((c->'bankMatch')-'autoConfirmed')||'{"phase":"manual"}'::jsonb);
    end if;
    if oldc->>'bankAutomationDisabled'='true' and c->>'bankAutomationDisabled'='false' then
      if linked and c->>'status'='הופקד - במעקב' and c->'bankMatch'->>'phase'='manual' then
        c:=jsonb_set(c,'{bankMatch}',(c->'bankMatch')||jsonb_build_object('phase','deposited',
          'eventId',(c->'bankMatch'->>'transactionId')||':resume:'||clock_timestamp()::text));
      elsif not linked then
        -- Explicit resume of an unclaimed warning starts a fresh search; never
        -- manufacture a deposited link or a null event identity from an advisory.
        c:=c-'bankMatch';
      end if;
    end if;
    c:=netunim_internal.check_bank_prune_history(c,clock_timestamp(),requested);
    rows:=rows||jsonb_build_array(c);
  end loop;
  new.state:=jsonb_set(new.state,'{checks}',rows);
  return new;
end $$;
revoke all on function netunim_internal.check_bank_prune_history(jsonb,timestamptz,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
