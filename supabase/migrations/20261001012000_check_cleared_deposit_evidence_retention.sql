-- Preserve proven cheque clearing across transient bank-detail failures and same-deposit reappearance.
-- A real disappearance/return still reopens the cheque for review; contradictory evidence still requires fresh verification.
begin;

create or replace function netunim_internal.reconcile_check_bank_snapshot()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare doc record; tx public.bank_transactions; ret public.bank_transactions; c jsonb; m jsonb;
  rows jsonb; nextrows jsonb; proposals jsonb:='[]'; proposal jsonb; match jsonb; ids jsonb;
  phase text; event text; txday date; clearafter date; settled_evidence_date date; cleared_history_date date; cleared_history_ord bigint; resume_from_prior_clear boolean; returncount int; overlapcount int; claim netunim_internal.check_bank_claims;
  pack jsonb; mapped_item jsonb; mapped_count int; oldclaim netunim_internal.check_bank_claims; already_claimed boolean; number_confirmed boolean;
  batches jsonb:='{}'; remainder jsonb; members jsonb; reduced_survivor boolean; provisional_reference boolean; replacing_provisional_reference boolean;
  legacy_member jsonb; legacy_item jsonb; legacy_number text;
begin
  -- The existing archive RPC supplies authenticated identity and complete, fenced snapshots.
  if auth.uid() is null or new.owner_id<>auth.uid() then return new; end if;
  if tg_op='UPDATE' and new.snapshot_at<=old.snapshot_at then return new; end if;
  if new.snapshot_at>clock_timestamp()+interval '5 minutes' then return new; end if;
  select * into doc from public.shared_checks_documents d where d.owner_id=new.owner_id and d.document_name='main' for update;
  if not found then return new; end if;
  rows:=doc.state->'checks';

  -- Older reconciliation treated an amount-only pending match as a durable claim.
  -- Live Hapoalim evidence now proves that a very specific pending direct-deposit
  -- presentation carries the cheque number in bank_reference. Convert only a
  -- single-member exact-number/amount legacy claim back to provisional evidence,
  -- so the later completed multi-cheque row can replace it atomically.
  for claim in select l.* from netunim_internal.check_bank_claims l where l.owner_id=new.owner_id
    and l.account_key=new.account_key and l.account_role=new.account_role and not l.conflicted
  loop
    select * into tx from public.bank_transactions where id=claim.transaction_id and owner_id=new.owner_id;
    legacy_number:=case when found then netunim_internal.check_bank_pending_reference_number(tx) else '' end;
    if legacy_number<>'' and jsonb_array_length(claim.check_ids)=1 and jsonb_array_length(claim.members)=1 then
      select value into legacy_member from jsonb_array_elements(claim.members) member
        where netunim_internal.check_bank_number(member->>'checkNumber')=legacy_number
          and netunim_internal.check_bank_money(member->>'amount')=abs(tx.amount) limit 1;
      if found and exists(select 1 from jsonb_array_elements(rows) current_check
        where claim.check_ids ? (current_check->>'id')
          and current_check->'bankMatch'->>'transactionId'=claim.transaction_id::text
          and current_check->'bankMatch'->>'phase'='deposited'
          and not (current_check->'bankMatch' ? 'warning')
          and coalesce(current_check->>'bankAutomationDisabled','false')<>'true'
          and netunim_internal.check_bank_number(current_check->>'checkNumber')=legacy_number
          and netunim_internal.check_bank_money(current_check->>'amount')=abs(tx.amount)) then
        -- Legacy amount/date inference created a durable claim before this bank
        -- presentation was understood. Remove only that exact single-member claim
        -- and mark its current evidence provisional so the stronger rule can replace it.
        delete from netunim_internal.check_bank_claims l where l.owner_id=claim.owner_id and l.transaction_id=claim.transaction_id;
        legacy_item:=jsonb_build_object('checkNumber',legacy_number,'bankNumber','','branchNumber','','accountNumber','','amount',abs(tx.amount));
        select coalesce(jsonb_agg(case when claim.check_ids ? (current_check->>'id')
          and current_check->'bankMatch'->>'transactionId'=claim.transaction_id::text
          and netunim_internal.check_bank_number(current_check->>'checkNumber')=legacy_number
          and netunim_internal.check_bank_money(current_check->>'amount')=abs(tx.amount)
          then current_check||jsonb_build_object('bankMatch',((current_check->'bankMatch')-'autoConfirmed')||jsonb_build_object(
            'provisionalReference',true,'provisional',true,'bankReference',tx.bank_reference,
            'bankItem',legacy_item,'matchMethod','number')) else current_check end order by ord),'[]') into rows
          from jsonb_array_elements(rows) with ordinality a(current_check,ord);
      end if;
    end if;
  end loop;

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
      and (
        ((b.transaction_date at time zone 'Asia/Jerusalem')::date between new.coverage_from and least(new.coverage_to,(new.snapshot_at at time zone 'Asia/Jerusalem')::date)
          and b.transaction_date>=new.snapshot_at-interval '30 days')
        -- A pending direct cheque deposit can be visible TODAY while Hapoalim gives
        -- it the future value/event date. It is current evidence because this exact
        -- row was observed in the fenced snapshot, not because its future date is trusted.
        or netunim_internal.check_bank_pending_reference_number(b)<>''
      )
      and netunim_internal.check_bank_kind(b.description) in ('deposit','redeposit')
    order by b.id
  loop
    proposals:=proposals||netunim_internal.check_bank_proposals(rows,tx);
  end loop;
  for proposal in select value from jsonb_array_elements(proposals) loop
    select * into tx from public.bank_transactions where id=(proposal->>'transactionId')::bigint;
    ids:=proposal->'ids';
    provisional_reference:=coalesce((proposal->>'provisionalReference')::boolean,false);
    -- If the same snapshot already contains a completed structured bank item for
    -- this check, never let the weaker pending-reference proposal compete with it.
    if provisional_reference and exists(select 1 from jsonb_array_elements(proposals) stronger
      where not coalesce((stronger->>'provisionalReference')::boolean,false)
        and stronger->>'kind'='unique' and stronger ? 'bankItem'
        and exists(select 1 from jsonb_array_elements(stronger->'candidates') sc where ids ? (sc->>'id'))) then
      continue;
    end if;
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
      and not (not provisional_reference and proposal ? 'bankItem'
        and coalesce((p->>'provisionalReference')::boolean,false))
      and exists(select 1 from jsonb_array_elements(p->'candidates') x where ids ? (x->>'id'));
    phase:=case when proposal->>'kind'='unique' and overlapcount=0 then 'deposited' else 'ambiguous' end;
    if phase='deposited' and exists(select 1 from jsonb_array_elements(rows) x where ids ? (x->>'id')
      and (x->>'status'='נפרע' or x->'bankMatch'->>'phase' in ('deposited','cleared','missing'))
      and not (coalesce((x->'bankMatch'->>'provisionalReference')::boolean,false)
        and proposal ? 'bankItem' and netunim_internal.check_bank_same_item(x,proposal->'bankItem'))) then phase:='ambiguous'; end if;
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
    if phase='deposited' and not provisional_reference then
      select jsonb_agg(jsonb_build_object('id',member->>'id','name',member->>'name','amount',member->'amount','dueDate',member->>'dueDate',
        'account',coalesce(member->>'account','עסקי'),'status','בקופה','checkNumber',member->>'checkNumber','bankItem',proposal->'bankItem')) into members
      from jsonb_array_elements(rows) member where ids ? (member->>'id');
      insert into netunim_internal.check_bank_claims(owner_id,document_name,transaction_id,account_key,account_role,check_ids,members,source_transaction,bank_members)
      values(new.owner_id,'main',tx.id,new.account_key,new.account_role,ids,members,to_jsonb(tx),
        case when netunim_internal.check_bank_items(tx)->>'kind'='valid' then netunim_internal.check_bank_items(tx)->'items' end)
      on conflict(owner_id,transaction_id) do update set
        check_ids=netunim_internal.check_bank_claims.check_ids||excluded.check_ids,
        members=netunim_internal.check_bank_claims.members||excluded.members;
    elsif phase<>'deposited' then
      select jsonb_agg(x->>'id') into ids from jsonb_array_elements(proposal->'candidates') x;
    end if;
    nextrows:='[]';
    for c in select value from jsonb_array_elements(rows) loop
      if ids ? (c->>'id') and c->>'status' in ('בקופה','הופקד - במעקב','חזר')
        and (coalesce(c->'bankMatch'->>'phase','') not in ('deposited','cleared','missing')
          or (coalesce((c->'bankMatch'->>'provisionalReference')::boolean,false)
            and proposal ? 'bankItem' and netunim_internal.check_bank_same_item(c,proposal->'bankItem'))) then
        replacing_provisional_reference:=coalesce((c->'bankMatch'->>'provisionalReference')::boolean,false);
        event:=tx.id::text||':'||phase||case when phase='ambiguous' then ':'||md5(ids::text) else '' end;
        m:=jsonb_build_object('transactionId',tx.id,'accountKey',tx.account_key,'accountRole',tx.account_role,'phase',phase,'eventId',event,
          'bankItem',proposal->'bankItem','provisional',tx.status='pending',
          'matchMethod',case when proposal ? 'bankItem' and netunim_internal.check_bank_number(c->>'checkNumber')<>''
            and netunim_internal.check_bank_number(c->>'checkNumber')=proposal->'bankItem'->>'checkNumber' then 'number' else 'amount' end,
          'description',tx.description,'amount',tx.amount,'date',case when provisional_reference then (new.snapshot_at at time zone 'Asia/Jerusalem')::date else (tx.transaction_date at time zone 'Asia/Jerusalem')::date end,
          'detectedAt',case when c->'bankMatch'->>'eventId'=event then c->'bankMatch'->'detectedAt' else to_jsonb(new.snapshot_at) end,
          'completedSeenDate',case when tx.status='completed' and phase='deposited' then (new.snapshot_at at time zone 'Asia/Jerusalem')::date end,
          'checkIds',ids,
          'previousStatus',case when replacing_provisional_reference then coalesce(c->'bankMatch'->>'previousStatus',c->>'status') else c->>'status' end,
          'previousDepositDate',case when replacing_provisional_reference then c->'bankMatch'->'previousDepositDate' else c->'depositDate' end);
        if proposal ? 'warning' then m:=m||jsonb_build_object('warning',proposal->>'warning'); end if;
        if provisional_reference then m:=m||jsonb_build_object('provisionalReference',true,'bankReference',tx.bank_reference); end if;
        c:=c||jsonb_build_object('bankMatch',m);
        if phase='deposited' then c:=c||jsonb_build_object('status','הופקד - במעקב',
          'depositDate',case when replacing_provisional_reference then coalesce(c->>'depositDate',m->>'date') else m->>'date' end,
          'clearedDate',null); end if;
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
        -- Clearing maturity belongs to the claimed deposit cycle, not to the latest
        -- enrichment response. New settlements receive a durable server-owned marker.
        -- For records already affected before this migration, recover the marker only
        -- when history proves the same claim was cleared and every later event is the
        -- benign continuity break fixed here (details unavailable / same row missing).
        settled_evidence_date:=netunim_internal.check_bank_date(m->>'settledEvidenceDate');
        cleared_history_date:=null;cleared_history_ord:=null;
        resume_from_prior_clear:=phase='cleared' and c->>'status'='נפרע';
        if settled_evidence_date is null and resume_from_prior_clear then
          settled_evidence_date:=netunim_internal.check_bank_date(c->>'clearedDate');
        end if;
        if jsonb_typeof(c->'bankHistory')='array' then
          select h.ord,netunim_internal.check_bank_date(left(h.value->>'recordedAt',10))
          into cleared_history_ord,cleared_history_date
          from jsonb_array_elements(c->'bankHistory') with ordinality h(value,ord)
          where h.value->>'phase'='cleared' and h.value->>'accountKey'=new.account_key
            and (h.value->>'transactionId'=tx.id::text or claim.previous_transaction_ids ? (h.value->>'transactionId'))
          order by h.ord desc limit 1;
          if settled_evidence_date is null then settled_evidence_date:=cleared_history_date; end if;
          if not resume_from_prior_clear and cleared_history_ord is not null and phase in ('deposited','missing')
            and coalesce(m->>'warning','') in ('','details_unavailable')
            and exists(select 1 from jsonb_array_elements(c->'bankHistory') with ordinality h(value,ord)
              where h.ord>cleared_history_ord
                and (h.value->>'transactionId'=tx.id::text or claim.previous_transaction_ids ? (h.value->>'transactionId'))
                and (h.value->>'phase'='missing' or h.value->>'warning'='details_unavailable'))
            and not exists(select 1 from jsonb_array_elements(c->'bankHistory') with ordinality h(value,ord)
              where h.ord>cleared_history_ord and (
                not (h.value->>'transactionId'=tx.id::text or claim.previous_transaction_ids ? (h.value->>'transactionId'))
                or h.value->>'phase' not in ('deposited','missing')
                or coalesce(h.value->>'warning','') not in ('','details_unavailable'))) then
            resume_from_prior_clear:=true;
          end if;
        end if;
        if settled_evidence_date is not null and m->>'settlementReopenReason'='deposit_missing' then resume_from_prior_clear:=true; end if;
        if settled_evidence_date is not null then m:=m||jsonb_build_object('settledEvidenceDate',settled_evidence_date); end if;
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
          phase:='missing';m:=(m-'settlementReopenReason')||jsonb_build_object('warning','identity_conflict');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif found then
          phase:='returned'; c:=c||jsonb_build_object('status','חזר','clearedDate',null);
          m:=(m-'warning'-'settlementReopenReason')||jsonb_build_object('returnTransactionId',ret.id,'returnDate',(ret.transaction_date at time zone 'Asia/Jerusalem')::date,'reason',concat_ws(' · ',nullif(ret.message_headline,''),nullif(ret.message_detail,''),ret.description));
        elsif remainder->>'kind'='reduced' and not reduced_survivor then
          phase:='missing';m:=(m-'settlementReopenReason')||jsonb_build_object('warning','batch_missing');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif remainder->>'kind'='ambiguous' then
          phase:='missing';m:=(m-'settlementReopenReason')||jsonb_build_object('warning','batch_ambiguous','remainder',remainder);
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif reduced_survivor and c->'bankMatch'->'remainder' is distinct from remainder then
          phase:='deposited';m:=(m-'warning'-'settlementReopenReason')||jsonb_build_object('completedSeenDate',case when tx.status='completed' then (new.snapshot_at at time zone 'Asia/Jerusalem')::date end);
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif tx.presence_state='missing' then
          phase:='missing';
          -- A removed credit revokes the visible cleared state and must alert. If it
          -- was already mature, remember that only this same-deposit disappearance
          -- caused the reopen so an exact reappearance can restore maturity at once.
          if settled_evidence_date is not null and resume_from_prior_clear then
            m:=m||jsonb_build_object('settlementReopenReason','deposit_missing');
          else m:=m-'settlementReopenReason'; end if;
          if c->>'status'='נפרע' then c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null); end if;
        elsif returncount>0 then
          m:=(m-'settlementReopenReason')||jsonb_build_object('warning','possible_return');
          if c->>'status'='נפרע' then phase:='deposited';c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null); end if;
        elsif pack->>'kind'='none' and m->'bankItem' is not null and m->'bankItem'<>'null'::jsonb
          and not (tx.status='pending' and coalesce((m->>'provisionalReference')::boolean,false)) then
          if settled_evidence_date is not null and resume_from_prior_clear then
            -- Loss of cheque-detail enrichment is not evidence that an already
            -- matured cheque became unsettled. Keep the cleared state and expose
            -- a diagnostic warning until structured details return.
            phase:='cleared';
            m:=(m-'settlementReopenReason')||jsonb_build_object('warning','details_unavailable_after_clear');
            c:=c||jsonb_build_object('status','נפרע','clearedDate',coalesce(nullif(c->>'clearedDate',''),settled_evidence_date::text));
          else
            m:=(m-'settlementReopenReason')||jsonb_build_object('warning','details_unavailable');
            if c->>'status'='נפרע' then phase:='deposited';c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null); end if;
          end if;
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
          phase:='missing';m:=(m-'settlementReopenReason')||jsonb_build_object('warning','changed');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif tx.last_seen_at=new.snapshot_at and pack->>'kind'='valid'
          and netunim_internal.check_bank_number(c->>'checkNumber')<>'' and not number_confirmed then
          phase:='deposited';m:=(m-'settlementReopenReason')||jsonb_build_object('warning','number_ambiguous');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif phase='missing' and tx.presence_state='present' and tx.last_seen_at=new.snapshot_at then
          m:=m-'warning';
          if settled_evidence_date is not null and resume_from_prior_clear then
            -- Reappearance of the same claimed deposit restores the already-proven
            -- cleared state immediately; it does not start a new clearing window.
            phase:='cleared';m:=m-'settlementReopenReason';
            c:=c||jsonb_build_object('status','נפרע','clearedDate',settled_evidence_date::text);
          else phase:='deposited'; end if;
        elsif tx.status='completed' and tx.presence_state='present' and tx.last_seen_at=new.snapshot_at then
          if m->>'completedSeenDate' is null then m:=m||jsonb_build_object('completedSeenDate',(new.snapshot_at at time zone 'Asia/Jerusalem')::date); end if;
          clearafter:=netunim_internal.check_bank_clear_after(greatest(txday,(m->>'completedSeenDate')::date));
          m:=m||jsonb_build_object('clearAfter',clearafter);
          if clearafter is null then m:=m||jsonb_build_object('warning','calendar');
          elsif m->>'warning' in ('calendar','possible_return','details_unavailable','details_unavailable_after_clear','number_ambiguous') then m:=m-'warning'; end if;
          if settled_evidence_date is not null and resume_from_prior_clear and not (m ? 'warning') then
            phase:='cleared';m:=m-'settlementReopenReason';
            c:=c||jsonb_build_object('status','נפרע','clearedDate',settled_evidence_date::text);
          elsif clearafter is not null and (new.snapshot_at at time zone 'Asia/Jerusalem')::date>=clearafter
            and new.coverage_from<=txday and new.coverage_to>=(new.snapshot_at at time zone 'Asia/Jerusalem')::date
            and (number_confirmed or c->>'bankReview'=m->>'eventId') and not (c->'bankMatch' ? 'warning')
            and m->'bankItem' is not distinct from c->'bankMatch'->'bankItem' and coalesce((c->'bankMatch'->>'provisional')::boolean,false)=false
            and phase='deposited' then
            phase:='cleared';settled_evidence_date:=(new.snapshot_at at time zone 'Asia/Jerusalem')::date;
            m:=(m-'settlementReopenReason')||jsonb_build_object('settledEvidenceDate',settled_evidence_date);
            c:=c||jsonb_build_object('status','נפרע','clearedDate',settled_evidence_date::text);
          end if;
        end if;
        if tx.last_seen_at=new.snapshot_at then
          m:=m||jsonb_build_object('autoConfirmed',number_confirmed and phase in ('deposited','cleared') and not (m ? 'warning'));
        elsif phase not in ('deposited','cleared') or m ? 'warning' then m:=m-'autoConfirmed'; end if;
        event:=m->>'eventId';
        if coalesce((m->>'autoConfirmed')::boolean,false) is distinct from coalesce((c->'bankMatch'->>'autoConfirmed')::boolean,false) or phase is distinct from c->'bankMatch'->>'phase' or m->>'warning' is distinct from c->'bankMatch'->>'warning'
          or m->'remainder' is distinct from c->'bankMatch'->'remainder'
          or m->'bankItem' is distinct from c->'bankMatch'->'bankItem' or m->'provisional' is distinct from c->'bankMatch'->'provisional'
          or m->'provisionalReference' is distinct from c->'bankMatch'->'provisionalReference' then
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
      and netunim_internal.check_bank_date(c->>'dueDate') between new.coverage_from and (new.snapshot_at at time zone 'Asia/Jerusalem')::date-1
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

-- Keep the trigger implementation private after replacement.
revoke all on function netunim_internal.reconcile_check_bank_snapshot() from public,anon,authenticated;

commit;
