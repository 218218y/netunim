begin;

alter table public.bank_transactions add column sender_account jsonb;

-- A sender account is a complete set of identifiers on a completed incoming
-- transfer. Keep the values as strings so leading zeroes survive.
alter table public.bank_transactions add constraint bank_transactions_sender_account_valid check (
  sender_account is null or (
    status='completed' and amount>0 and not cheque
    and nullif(check_details,'null'::jsonb) is null
    and nullif(credit_settlement_details,'null'::jsonb) is null
    and jsonb_typeof(sender_account)='object'
    and sender_account ?& array['bankNumber','branchNumber','accountNumber']
    and sender_account - array['bankNumber','branchNumber','accountNumber']='{}'::jsonb
    and jsonb_typeof(sender_account->'bankNumber')='string'
    and (sender_account->>'bankNumber') ~ '^[1-9][0-9]{0,2}$'
    and jsonb_typeof(sender_account->'branchNumber')='string'
    and (sender_account->>'branchNumber') ~ '^[0-9]{1,6}$'
    and (sender_account->>'branchNumber') ~ '[1-9]'
    and jsonb_typeof(sender_account->'accountNumber')='string'
    and (sender_account->>'accountNumber') ~ '^[0-9]{1,20}$'
    and (sender_account->>'accountNumber') ~ '[1-9]'
  )
);

-- Extend the single merge used by both fenced writers, with the resolved
-- archive identity and its usual update counts. Fail if the expected prior
-- definition has changed. Old clients and unavailable details retain evidence.
do $migration$
declare
  definition text := pg_get_functiondef('netunim_internal.merge_bank_transactions(text,text,jsonb)'::regprocedure);
  previous text[] := array[
    'cheque,check_details,credit_settlement_details)',
    $sql$r->'checkDetails',r->'creditSettlementDetails')$sql$,
    $sql$credit_settlement_details=coalesce(r->'creditSettlementDetails',b.credit_settlement_details),$sql$,
    $sql$or b.credit_settlement_details is distinct from coalesce(r->'creditSettlementDetails',b.credit_settlement_details)$sql$
  ];
  replacement text[] := array[
    'cheque,check_details,credit_settlement_details,sender_account)',
    $sql$r->'checkDetails',r->'creditSettlementDetails',nullif(r->'senderAccount','null'::jsonb))$sql$,
    $sql$credit_settlement_details=coalesce(r->'creditSettlementDetails',b.credit_settlement_details),
        sender_account=coalesce(nullif(r->'senderAccount','null'::jsonb),b.sender_account),$sql$,
    $sql$or b.credit_settlement_details is distinct from coalesce(r->'creditSettlementDetails',b.credit_settlement_details)
        or b.sender_account is distinct from coalesce(nullif(r->'senderAccount','null'::jsonb),b.sender_account)$sql$
  ];
begin
  for i in 1..array_length(previous,1) loop
    if length(definition)-length(replace(definition,previous[i],''))<>length(previous[i]) then
      raise exception 'Unexpected bank transaction merge definition (clause %)', i;
    end if;
    definition := replace(definition,previous[i],replacement[i]);
  end loop;
  execute definition;
end
$migration$;

commit;
