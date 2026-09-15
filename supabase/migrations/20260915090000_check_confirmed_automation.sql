-- Automatically approve only uniquely claimed, numbered, amount-exact bank
-- items. References and amount-only inference never constitute this proof.
begin;
create or replace function netunim_internal.check_bank_number_confirmed(p_check jsonb,p_match jsonb,p_tx public.bank_transactions,p_checks jsonb)
returns boolean language sql stable set search_path=pg_catalog,public as $$
  select coalesce(
    p_tx.amount>0 and p_tx.currency='ILS' and p_tx.presence_state='present'
    and p_tx.status in ('pending','completed')
    and netunim_internal.check_bank_kind(p_tx.description) in ('deposit','redeposit')
    and coalesce(p_check->>'bankAutomationDisabled','false')<>'true'
    and netunim_internal.check_bank_number(p_check->>'checkNumber')<>''
    and netunim_internal.check_bank_same_item(p_check,p_match->'bankItem')
    and netunim_internal.check_bank_items(p_tx)->>'kind'='valid'
    and (select count(*) from jsonb_array_elements(netunim_internal.check_bank_items(p_tx)->'items') i
      where netunim_internal.check_bank_same_item(p_match->'bankItem',i))=1
    and exists(select 1 from netunim_internal.check_bank_claims l where l.owner_id=p_tx.owner_id
      and l.transaction_id=p_tx.id and l.account_key=p_tx.account_key and l.account_role=p_tx.account_role
      and not l.conflicted and l.check_ids ? (p_check->>'id'))
    and (select count(*) from jsonb_array_elements(p_checks) c
      where coalesce(c->>'account','עסקי')=coalesce(p_check->>'account','עסקי')
        and netunim_internal.check_bank_number(c->>'checkNumber')=netunim_internal.check_bank_number(p_check->>'checkNumber')
        and netunim_internal.check_bank_item_matches(coalesce(nullif(c->'bankMatch'->'bankItem','null'::jsonb),c),p_match->'bankItem'))=1
    and not exists(select 1 from public.bank_transactions b where b.owner_id=p_tx.owner_id
      and b.account_key=p_tx.account_key and b.account_role=p_tx.account_role and b.id<>p_tx.id
      and b.presence_state='present' and b.last_seen_at=p_tx.last_seen_at and b.amount>0 and b.currency='ILS'
      and netunim_internal.check_bank_kind(b.description) in ('deposit','redeposit')
      and abs((b.transaction_date at time zone 'Asia/Jerusalem')::date-(p_tx.transaction_date at time zone 'Asia/Jerusalem')::date)<=7
      and exists(select 1 from jsonb_array_elements(netunim_internal.check_bank_items(b)->'items') i
        where netunim_internal.check_bank_same_item(p_match->'bankItem',i))
      and not (netunim_internal.check_bank_kind(p_tx.description)='redeposit' and exists(
        select 1 from public.bank_transactions r where r.owner_id=p_tx.owner_id and r.account_key=p_tx.account_key
          and r.account_role=p_tx.account_role and r.status='completed' and r.presence_state='present' and r.amount<0
          and netunim_internal.check_bank_kind(r.description)='return'
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date>=(b.transaction_date at time zone 'Asia/Jerusalem')::date
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date<(p_tx.transaction_date at time zone 'Asia/Jerusalem')::date
          and netunim_internal.check_bank_return_matches(p_check,p_match,r))))
  ,false);
$$;

-- Append once per meaningful server event. Client acknowledgements and repeated
-- bank refreshes never manufacture additional history entries.
create or replace function netunim_internal.check_bank_record_history(p_check jsonb,p_at timestamptz)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare history jsonb:=case when jsonb_typeof(p_check->'bankHistory')='array' then p_check->'bankHistory' else '[]'::jsonb end;
  m jsonb:=p_check->'bankMatch';
begin
  if m->>'eventId' is null or m->>'phase'='manual' or exists(select 1 from jsonb_array_elements(history) h where h->>'eventId'=m->>'eventId') then return p_check; end if;
  return p_check||jsonb_build_object('bankHistory',history||jsonb_build_array(m||jsonb_build_object(
    'recordedAt',p_at,'checkName',p_check->>'name','checkAmount',p_check->'amount',
    'checkNumber',p_check->>'checkNumber','checkAccount',coalesce(p_check->>'account','עסקי'),'checkStatus',p_check->>'status')));
end $$;

create or replace function netunim_internal.protect_check_bank_metadata()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb; oldc jsonb; rows jsonb:='[]'; linked boolean; material_changed boolean; number_changed boolean;
begin
  if current_setting('app.check_bank_reconcile',true)='1' then return new; end if;
  for c in select value from jsonb_array_elements(new.state->'checks') loop
    select value into oldc from jsonb_array_elements(case when tg_op='UPDATE' then old.state->'checks' else '[]'::jsonb end)
      where value->>'id'=c->>'id';
    c:=c-'bankMatch'-'bankHistory';
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
    rows:=rows||jsonb_build_array(c);
  end loop;
  new.state:=jsonb_set(new.state,'{checks}',rows);
  return new;
end $$;

create or replace function netunim_internal.reconcile_check_bank_snapshot()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare doc record; tx public.bank_transactions; ret public.bank_transactions; c jsonb; m jsonb;
  rows jsonb; nextrows jsonb; proposals jsonb:='[]'; proposal jsonb; match jsonb; ids jsonb;
  phase text; event text; txday date; clearafter date; returncount int; overlapcount int; claim netunim_internal.check_bank_claims;
  pack jsonb; mapped_item jsonb; mapped_count int; oldclaim netunim_internal.check_bank_claims; already_claimed boolean; number_confirmed boolean;
  batches jsonb:='{}'; remainder jsonb; members jsonb; reduced_survivor boolean;
begin
  -- The existing archive RPC supplies authenticated identity and complete, fenced snapshots.
  if auth.uid() is null or new.owner_id<>auth.uid() then return new; end if;
  if tg_op='UPDATE' and new.snapshot_at<=old.snapshot_at then return new; end if;
  if new.snapshot_at>clock_timestamp()+interval '5 minutes' then return new; end if;
  select * into doc from public.shared_checks_documents d where d.owner_id=new.owner_id and d.document_name='main' for update;
  if not found then return new; end if;
  rows:=doc.state->'checks';

  -- Reserve reduced successors BEFORE proposing fresh deposits, so a replacement
  -- cannot consume unrelated open checks and leave its original group stranded.
  for claim in select l.* from netunim_internal.check_bank_claims l where l.owner_id=new.owner_id
    and l.account_key=new.account_key and l.account_role=new.account_role and not l.conflicted
  loop
    select * into tx from public.bank_transactions where id=claim.transaction_id and owner_id=new.owner_id;
    pack:=netunim_internal.check_bank_items(tx);
    if claim.bank_members is null and tx.amount=(claim.source_transaction->>'amount')::numeric
      and tx.last_seen_at=new.snapshot_at and tx.presence_state='present' and pack->>'kind'='valid'
      and not exists(select 1 from jsonb_array_elements(claim.members) member where not exists(
        select 1 from jsonb_array_elements(pack->'items') i where netunim_internal.check_bank_item_matches(coalesce(nullif(member->'bankItem','null'::jsonb),member),i))) then
      update netunim_internal.check_bank_claims set bank_members=pack->'items' where owner_id=claim.owner_id and transaction_id=claim.transaction_id;
      claim.bank_members:=pack->'items';
    end if;
    remainder:=netunim_internal.check_bank_remainder(claim,new);
    if remainder->>'kind'='reduced' and (remainder->>'transactionId')::bigint<>claim.transaction_id then
      perform netunim_internal.move_check_bank_claim(claim.transaction_id,(remainder->>'transactionId')::bigint);
    end if;
    if remainder is not null then
      batches:=batches||jsonb_build_object(claim.transaction_id::text,remainder,(remainder->>'transactionId'),remainder);
    end if;
  end loop;

  -- Proposals are built against the SAME original check list before accepting any of them.
  for tx in select b.* from public.bank_transactions b
    where b.owner_id=new.owner_id and b.account_key=new.account_key and b.account_role=new.account_role
      and b.amount>0 and b.currency='ILS' and b.status in ('pending','completed')
      and b.presence_state='present' and b.last_seen_at=new.snapshot_at
      and (b.transaction_date at time zone 'Asia/Jerusalem')::date between new.coverage_from and least(new.coverage_to,(new.snapshot_at at time zone 'Asia/Jerusalem')::date)
      and b.transaction_date>=new.snapshot_at-interval '30 days'
      and netunim_internal.check_bank_kind(b.description) in ('deposit','redeposit')
    order by b.id
  loop
    proposals:=proposals||netunim_internal.check_bank_proposals(rows,tx);
  end loop;
  for proposal in select value from jsonb_array_elements(proposals) loop
    select * into tx from public.bank_transactions where id=(proposal->>'transactionId')::bigint;
    ids:=proposal->'ids';
    select * into claim from netunim_internal.check_bank_claims where owner_id=new.owner_id and transaction_id=tx.id;
    already_claimed:=found;
    if already_claimed and proposal->>'kind'='unique' and not exists(select 1 from jsonb_array_elements_text(ids) id where not (claim.check_ids ? id)) then continue; end if;
    if already_claimed and proposal ? 'bankItem' and (
      exists(select 1 from jsonb_array_elements(claim.members) member where
        netunim_internal.check_bank_same_item(coalesce(nullif(member->'bankItem','null'::jsonb),member),proposal->'bankItem'))
      or (select sum((member->>'amount')::numeric) from jsonb_array_elements(claim.members) member)=(claim.source_transaction->>'amount')::numeric
    ) then continue; end if;
    -- An amount-only claim reserves the entire movement, including deleted checks.
    if already_claimed and not (proposal ? 'bankItem') then continue; end if;
    -- Every alternative (including an ambiguous/over-limit deposit) blocks shared candidates.
    select count(*) into overlapcount from jsonb_array_elements(proposals) p
    where (p->>'transactionId',p->>'slot') is distinct from (proposal->>'transactionId',proposal->>'slot')
      and exists(select 1 from jsonb_array_elements(p->'candidates') x where ids ? (x->>'id'));
    phase:=case when proposal->>'kind'='unique' and overlapcount=0 then 'deposited' else 'ambiguous' end;
    if phase='deposited' and exists(select 1 from jsonb_array_elements(rows) x where ids ? (x->>'id')
      and (x->>'status'='נפרע' or x->'bankMatch'->>'phase' in ('deposited','cleared','missing'))) then phase:='ambiguous'; end if;
    if phase='deposited' and netunim_internal.check_bank_kind(tx.description)='redeposit' and exists(
      select 1 from jsonb_array_elements(rows) x where ids ? (x->>'id') and (
        not (proposal ? 'bankItem') or netunim_internal.check_bank_number(x->>'checkNumber')=''
        or not netunim_internal.check_bank_same_item(coalesce(nullif(x->'bankMatch'->'bankItem','null'::jsonb),x),proposal->'bankItem')
        or exists(select 1 from public.bank_transactions r where r.owner_id=new.owner_id and r.account_key=new.account_key and r.account_role=new.account_role
          and r.amount<0 and r.presence_state='present' and netunim_internal.check_bank_kind(r.description)='return'
          and r.transaction_date::date=tx.transaction_date::date and netunim_internal.check_bank_return_matches(x,jsonb_build_object('bankItem',proposal->'bankItem'),r))
        or (x->>'status'='חזר' and exists(select 1 from public.bank_transactions r where r.owner_id=new.owner_id
          and r.id=(x->'bankMatch'->>'returnTransactionId')::bigint and r.transaction_date::date>=tx.transaction_date::date)))) then
      phase:='ambiguous';proposal:=proposal||jsonb_build_object('warning','redeposit_unverified'); end if;
    if phase='deposited' then
      select jsonb_agg(jsonb_build_object('id',member->>'id','name',member->>'name','amount',member->'amount','dueDate',member->>'dueDate',
        'account',coalesce(member->>'account','עסקי'),'status','בקופה','checkNumber',member->>'checkNumber','bankItem',proposal->'bankItem')) into members
      from jsonb_array_elements(rows) member where ids ? (member->>'id');
      insert into netunim_internal.check_bank_claims(owner_id,document_name,transaction_id,account_key,account_role,check_ids,members,source_transaction,bank_members)
      values(new.owner_id,'main',tx.id,new.account_key,new.account_role,ids,members,to_jsonb(tx),
        case when netunim_internal.check_bank_items(tx)->>'kind'='valid' then netunim_internal.check_bank_items(tx)->'items' end)
      on conflict(owner_id,transaction_id) do update set
        check_ids=netunim_internal.check_bank_claims.check_ids||excluded.check_ids,
        members=netunim_internal.check_bank_claims.members||excluded.members;
    else
      select jsonb_agg(x->>'id') into ids from jsonb_array_elements(proposal->'candidates') x;
    end if;
    nextrows:='[]';
    for c in select value from jsonb_array_elements(rows) loop
      if ids ? (c->>'id') and c->>'status' in ('בקופה','הופקד - במעקב','חזר')
        and coalesce(c->'bankMatch'->>'phase','') not in ('deposited','cleared','missing') then
        event:=tx.id::text||':'||phase||case when phase='ambiguous' then ':'||md5(ids::text) else '' end;
        m:=jsonb_build_object('transactionId',tx.id,'accountKey',tx.account_key,'accountRole',tx.account_role,'phase',phase,'eventId',event,
          'bankItem',proposal->'bankItem','provisional',tx.status='pending',
          'matchMethod',case when proposal ? 'bankItem' and netunim_internal.check_bank_number(c->>'checkNumber')<>''
            and netunim_internal.check_bank_number(c->>'checkNumber')=proposal->'bankItem'->>'checkNumber' then 'number' else 'amount' end,
          'description',tx.description,'amount',tx.amount,'date',(tx.transaction_date at time zone 'Asia/Jerusalem')::date,
          'detectedAt',case when c->'bankMatch'->>'eventId'=event then c->'bankMatch'->'detectedAt' else to_jsonb(new.snapshot_at) end,
          'completedSeenDate',case when tx.status='completed' and phase='deposited' then (new.snapshot_at at time zone 'Asia/Jerusalem')::date end,
          'checkIds',ids,'previousStatus',c->>'status','previousDepositDate',c->'depositDate');
        if proposal ? 'warning' then m:=m||jsonb_build_object('warning',proposal->>'warning'); end if;
        c:=c||jsonb_build_object('bankMatch',m);
        if phase='deposited' then c:=c||jsonb_build_object('status','הופקד - במעקב','depositDate',m->>'date','clearedDate',null); end if;
      end if;
      nextrows:=nextrows||jsonb_build_array(c);
    end loop;
    rows:=nextrows;
  end loop;

  -- Linked checks keep their claim even after rejection, deletion or manual correction.
  nextrows:='[]';
  for c in select value from jsonb_array_elements(rows) loop
    m:=c->'bankMatch'; phase:=m->>'phase';
    remainder:=batches->(m->>'transactionId');reduced_survivor:=false;
    if phase in ('deposited','cleared','missing') and coalesce(c->>'bankAutomationDisabled','false')<>'true'
      and m->>'accountKey'=new.account_key
      and coalesce(c->>'account','עסקי')=(case new.account_role when 'home' then 'ביתי' else 'עסקי' end) then
      select * into claim from netunim_internal.check_bank_claims where owner_id=new.owner_id
        and (transaction_id=(m->>'transactionId')::bigint or previous_transaction_ids ? (m->>'transactionId'));
      select * into tx from public.bank_transactions where owner_id=new.owner_id and id=coalesce(claim.transaction_id,(m->>'transactionId')::bigint) and account_role=new.account_role;
      if found then
        m:=m||jsonb_build_object('transactionId',tx.id);
        if claim.check_ids is not null and not (m ? 'remainder') then m:=m||jsonb_build_object('checkIds',claim.check_ids); end if;
        pack:=netunim_internal.check_bank_items(tx);
        if pack->>'kind'='valid' and tx.presence_state='present' and tx.last_seen_at=new.snapshot_at and (m->'bankItem' is null or m->'bankItem'='null'::jsonb) then
          select count(*),jsonb_agg(i)->0 into mapped_count,mapped_item from jsonb_array_elements(pack->'items') i where netunim_internal.check_bank_item_matches(c,i)
            and exists(select 1 from jsonb_array_elements(netunim_internal.check_bank_claim_members(claim)) member
              where member->>'id'=c->>'id' and netunim_internal.check_bank_same_item(member,i));
          if mapped_count=1 then m:=m||jsonb_build_object('bankItem',mapped_item,'matchMethod',case when netunim_internal.check_bank_number(c->>'checkNumber')=mapped_item->>'checkNumber' then 'number' else 'amount' end); end if;
        end if;
        if tx.status='completed' then m:=m||jsonb_build_object('provisional',false); end if;
        if remainder is null and m ? 'remainder' then
          m:=m-'remainder';
          if m->>'warning' in ('batch_missing','batch_ambiguous') then m:=m-'warning'; end if;
        end if;
        if remainder->>'kind'='full' and m ? 'remainder' then
          m:=(m-'remainder')||jsonb_build_object('amount',remainder->'originalAmount','checkIds',remainder->'originalIds');
        end if;
        if remainder->>'kind'='reduced' then
          reduced_survivor:=remainder->'remainingIds' ? (c->>'id');
          m:=m||jsonb_build_object('remainder',remainder);
          if reduced_survivor then
            -- Verify future amount/number/count against the surviving subset, while
            -- immutable original membership stays available in the claim forever.
            m:=m||jsonb_build_object('amount',tx.amount,'checkIds',remainder->'remainingIds');
          end if;
        end if;
        number_confirmed:=netunim_internal.check_bank_number_confirmed(c,m,tx,rows);
        if number_confirmed then m:=m||jsonb_build_object('matchMethod','number'); end if;
        txday:=greatest((tx.transaction_date at time zone 'Asia/Jerusalem')::date,(tx.processed_date at time zone 'Asia/Jerusalem')::date);
        -- Amount-only returns are alerts and block clearing, but do not prove WHICH cheque returned.
        returncount:=0;
        for ret in select r.* from public.bank_transactions r where r.owner_id=new.owner_id
          and r.account_key=new.account_key and r.account_role=new.account_role and r.amount<0
          and r.currency='ILS' and r.presence_state<>'missing'
          and netunim_internal.check_bank_kind(r.description)='return'
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date>=txday
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date<=txday+30
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date<=(new.snapshot_at at time zone 'Asia/Jerusalem')::date
        loop
          ret.amount:=-ret.amount;
          if netunim_internal.check_bank_candidates(netunim_internal.check_bank_claim_members(claim),ret)->>'kind'<>'none' then
            returncount:=returncount+1;
          end if;
        end loop;
        if reduced_survivor and remainder->>'evidence'='return_debits' then returncount:=0; end if;
        select r.* into ret from public.bank_transactions r where r.owner_id=new.owner_id
          and r.account_key=new.account_key and r.account_role=new.account_role and r.amount<0
          and r.status='completed' and r.currency='ILS' and r.presence_state='present'
          and netunim_internal.check_bank_kind(r.description)='return'
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date>=txday
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date<=(new.snapshot_at at time zone 'Asia/Jerusalem')::date
          and netunim_internal.check_bank_return_matches(c,m,r)
          and (select count(*) from jsonb_array_elements(rows) x where coalesce(x->>'account','עסקי')=coalesce(c->>'account','עסקי')
            and netunim_internal.check_bank_same_item(coalesce(nullif(x->'bankMatch'->'bankItem','null'::jsonb),x),coalesce(nullif(m->'bankItem','null'::jsonb),c)))=1
          order by r.id limit 1;
        if claim.conflicted then
          phase:='missing';m:=m||jsonb_build_object('warning','identity_conflict');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif found then
          phase:='returned'; c:=c||jsonb_build_object('status','חזר','clearedDate',null);
          m:=(m-'warning')||jsonb_build_object('returnTransactionId',ret.id,'returnDate',(ret.transaction_date at time zone 'Asia/Jerusalem')::date,'reason',concat_ws(' · ',nullif(ret.message_headline,''),nullif(ret.message_detail,''),ret.description));
        elsif remainder->>'kind'='reduced' and not reduced_survivor then
          phase:='missing';m:=m||jsonb_build_object('warning','batch_missing');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif remainder->>'kind'='ambiguous' then
          phase:='missing';m:=m||jsonb_build_object('warning','batch_ambiguous','remainder',remainder);
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif reduced_survivor and c->'bankMatch'->'remainder' is distinct from remainder then
          phase:='deposited';m:=(m-'warning')||jsonb_build_object('completedSeenDate',case when tx.status='completed' then (new.snapshot_at at time zone 'Asia/Jerusalem')::date end);
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif tx.presence_state='missing' then
          phase:='missing';
          -- A removed credit revokes an automatic cleared state; never assert a return without evidence.
          if c->>'status'='נפרע' then c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null); end if;
        elsif returncount>0 then
          m:=m||jsonb_build_object('warning','possible_return');
          if c->>'status'='נפרע' then phase:='deposited';c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null); end if;
        elsif pack->>'kind'='none' and m->'bankItem' is not null and m->'bankItem'<>'null'::jsonb then
          m:=m||jsonb_build_object('warning','details_unavailable');
          if c->>'status'='נפרע' then phase:='deposited';c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null); end if;
        elsif tx.amount<>(m->>'amount')::numeric or tx.currency<>'ILS' or tx.status not in ('pending','completed')
          or coalesce(netunim_internal.check_bank_kind(tx.description),'') not in ('deposit','redeposit')
          or pack->>'kind'='invalid'
          or (pack->>'kind'='valid' and not exists(select 1 from jsonb_array_elements(pack->'items') i
            where netunim_internal.check_bank_item_matches(coalesce(nullif(m->'bankItem','null'::jsonb),c),i)))
          or (pack->>'kind'='valid' and m->'bankItem' is not null and m->'bankItem'<>'null'::jsonb and not exists(
            select 1 from jsonb_array_elements(pack->'items') i where netunim_internal.check_bank_same_item(m->'bankItem',i)))
          or (pack->>'kind'='none' and netunim_internal.check_bank_number(c->>'checkNumber')<>''
            and jsonb_typeof(tx.check_details->'checkNumbers')='array' and tx.check_details->'checkNumbers'<>'[]'::jsonb
            and not exists(select 1 from jsonb_array_elements_text(tx.check_details->'checkNumbers') n where netunim_internal.check_bank_number(n)=netunim_internal.check_bank_number(c->>'checkNumber')))
          or (pack->>'kind'<>'valid' and coalesce(remainder->>'evidence','')<>'return_debits' and coalesce(tx.check_details->>'checkCount','') ~ '^[1-9][0-9]*$'
            and (tx.check_details->>'checkCount')::numeric<>jsonb_array_length(m->'checkIds')) then
          phase:='missing';m:=m||jsonb_build_object('warning','changed');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif tx.last_seen_at=new.snapshot_at and pack->>'kind'='valid'
          and netunim_internal.check_bank_number(c->>'checkNumber')<>'' and not number_confirmed then
          phase:='deposited';m:=m||jsonb_build_object('warning','number_ambiguous');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif phase='missing' and tx.presence_state='present' and tx.last_seen_at=new.snapshot_at then
          phase:='deposited';m:=m-'warning';
        elsif tx.status='completed' and tx.presence_state='present' and tx.last_seen_at=new.snapshot_at then
          if m->>'completedSeenDate' is null then m:=m||jsonb_build_object('completedSeenDate',(new.snapshot_at at time zone 'Asia/Jerusalem')::date); end if;
          clearafter:=netunim_internal.check_bank_clear_after(greatest(txday,(m->>'completedSeenDate')::date));
          m:=m||jsonb_build_object('clearAfter',clearafter);
          if clearafter is null then m:=m||jsonb_build_object('warning','calendar');
          elsif m->>'warning' in ('calendar','possible_return','details_unavailable','number_ambiguous') then m:=m-'warning'; end if;
          if clearafter is not null and (new.snapshot_at at time zone 'Asia/Jerusalem')::date>=clearafter
            and new.coverage_from<=txday and new.coverage_to>=(new.snapshot_at at time zone 'Asia/Jerusalem')::date
            and (number_confirmed or c->>'bankReview'=m->>'eventId') and not (c->'bankMatch' ? 'warning')
            and m->'bankItem' is not distinct from c->'bankMatch'->'bankItem' and coalesce((c->'bankMatch'->>'provisional')::boolean,false)=false
            and phase='deposited' then
            phase:='cleared';c:=c||jsonb_build_object('status','נפרע','clearedDate',(new.snapshot_at at time zone 'Asia/Jerusalem')::date);
          end if;
        end if;
        if tx.last_seen_at=new.snapshot_at then
          m:=m||jsonb_build_object('autoConfirmed',number_confirmed and phase in ('deposited','cleared') and not (m ? 'warning'));
        elsif phase not in ('deposited','cleared') or m ? 'warning' then m:=m-'autoConfirmed'; end if;
        event:=m->>'eventId';
        if coalesce((m->>'autoConfirmed')::boolean,false) is distinct from coalesce((c->'bankMatch'->>'autoConfirmed')::boolean,false) or phase is distinct from c->'bankMatch'->>'phase' or m->>'warning' is distinct from c->'bankMatch'->>'warning'
          or m->'remainder' is distinct from c->'bankMatch'->'remainder'
          or m->'bankItem' is distinct from c->'bankMatch'->'bankItem' or m->'provisional' is distinct from c->'bankMatch'->'provisional' then
          event:=tx.id::text||':'||phase||':'||new.snapshot_at::text;
        end if;
        c:=c||jsonb_build_object('bankMatch',m||jsonb_build_object('phase',phase,'eventId',event));
      else
        c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null,'bankMatch',(m-'autoConfirmed')||jsonb_build_object('phase','missing','eventId',(m->>'transactionId')||':missing'));
      end if;
    end if;
    nextrows:=nextrows||jsonb_build_array(c);
  end loop;
  rows:=nextrows;nextrows:='[]';
  for c in select value from jsonb_array_elements(rows) loop
    if coalesce(c->>'bankAutomationDisabled','false')<>'true'
      and coalesce(c->'bankMatch'->>'phase','') in ('','overdue','unverified')
      and coalesce(c->>'account','עסקי')=(case new.account_role when 'home' then 'ביתי' else 'עסקי' end)
      and c->>'status' in ('בקופה','הופקד - במעקב')
      and netunim_internal.check_bank_date(c->>'dueDate') between new.coverage_from and (new.snapshot_at at time zone 'Asia/Jerusalem')::date
      and new.coverage_to>=(new.snapshot_at at time zone 'Asia/Jerusalem')::date then
      phase:=case c->>'status' when 'בקופה' then 'overdue' else 'unverified' end;
      event:='no-bank:'||new.account_key||':'||(c->>'id')||':'||(c->>'dueDate')||':'||phase;
      if c->'bankMatch'->>'eventId' is distinct from event then
        c:=c||jsonb_build_object('bankMatch',jsonb_build_object('phase',phase,'eventId',event,'accountKey',new.account_key,
          'observedDate',(new.snapshot_at at time zone 'Asia/Jerusalem')::date,'date',c->>'dueDate'));
      end if;
    end if;
    nextrows:=nextrows||jsonb_build_array(c);
  end loop;
  select coalesce(jsonb_agg(netunim_internal.check_bank_record_history(a.c,new.snapshot_at) order by a.ord),'[]')
    into nextrows from jsonb_array_elements(nextrows) with ordinality a(c,ord);
  if nextrows is distinct from doc.state->'checks' then
    perform set_config('app.check_bank_reconcile','1',true);
    perform netunim_internal.save_shared_checks_document('main',doc.revision,jsonb_build_object('checks',nextrows));
    perform set_config('app.check_bank_reconcile','0',true);
  end if;
  return new;
end $$;

revoke all on function netunim_internal.check_bank_number_confirmed(jsonb,jsonb,public.bank_transactions,jsonb),
  netunim_internal.check_bank_record_history(jsonb,timestamptz) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
