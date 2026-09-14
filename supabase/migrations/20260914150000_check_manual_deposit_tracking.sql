-- Manual deposit remains eligible for bank association. An advisory/proposal is
-- not an acquired bank claim. Keep actual claims protected from manual changes.
begin;

create or replace function netunim_internal.protect_check_bank_metadata()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb; oldc jsonb; rows jsonb:='[]'; linked boolean; material_changed boolean; number_changed boolean;
begin
  if current_setting('app.check_bank_reconcile',true)='1' then return new; end if;
  for c in select value from jsonb_array_elements(new.state->'checks') loop
    select value into oldc from jsonb_array_elements(case when tg_op='UPDATE' then old.state->'checks' else '[]'::jsonb end)
      where value->>'id'=c->>'id';
    c:=c-'bankMatch';
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
          'bankMatch',(oldc->'bankMatch')||'{"phase":"manual"}'::jsonb);
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
      c:=jsonb_set(c,'{bankMatch}',(c->'bankMatch')||'{"phase":"manual"}'::jsonb);
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
    rows:=rows||jsonb_build_array(c);
  end loop;
  new.state:=jsonb_set(new.state,'{checks}',rows);
  return new;
end $$;

notify pgrst,'reload schema';
commit;
