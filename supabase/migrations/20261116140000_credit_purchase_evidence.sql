begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
-- Existing private-function privileges and the v6 writer/restore fences remain in force.
create or replace function netunim_internal.credit_financial_key(tx jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $f$
 select jsonb_build_array(coalesce(nullif(tx->>'id',''),tx->>'identifier',''),tx->'type',tx->'status',tx->'processedDate',tx->'date',
 tx->'chargedAmount',tx->'chargedCurrency',tx->'originalAmount',tx->'originalCurrency',
 tx->'foreignTransaction',tx->'chargeAmountStatus',tx#>'{installments,number}',tx#>'{installments,total}',
 tx->'description',tx->'transactionDate',tx->'transactionTime')
$f$;
create or replace function netunim_internal.credit_source_evidence(old_tx jsonb,new_tx jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $f$
 select coalesce(nullif(old_tx->>'id',''),old_tx->>'identifier','')=coalesce(nullif(new_tx->>'id',''),new_tx->>'identifier','')
 and coalesce(old_tx->>'date','')<>'' and old_tx->>'date'=new_tx->>'date'
 and coalesce(old_tx->'transactionDate','null'::jsonb) is not distinct from coalesce(new_tx->'transactionDate','null'::jsonb)

 and coalesce(old_tx->>'description','')=coalesce(new_tx->>'description','')
 and coalesce(old_tx->>'transactionTime','')=coalesce(new_tx->>'transactionTime','')
 and old_tx->>'originalAmount' is not null and coalesce(old_tx->>'originalCurrency','')<>''
 and old_tx->'originalAmount'=new_tx->'originalAmount' and old_tx->'originalCurrency'=new_tx->'originalCurrency'
 and old_tx#>'{installments,number}' is not distinct from new_tx#>'{installments,number}'
 and old_tx#>'{installments,total}' is not distinct from new_tx#>'{installments,total}'
 and (old_tx->>'chargedAmount' is null or old_tx->'chargedAmount'=new_tx->'chargedAmount' and old_tx->'chargedCurrency'=new_tx->'chargedCurrency')
$f$;
create or replace function netunim_internal.credit_amount_enrichment(old_tx jsonb,new_tx jsonb) returns boolean
language sql immutable set search_path=pg_catalog,netunim_internal as $f$
 select coalesce(nullif(old_tx->>'id',''),old_tx->>'identifier','')<>'' and old_tx->>'status'='completed' and new_tx->>'status'='completed'
 and old_tx->>'chargedAmount' is null and old_tx->>'chargeAmountStatus'='missing' and new_tx->>'chargeAmountStatus'='reported'
 and jsonb_typeof(new_tx->'chargedAmount')='number' and old_tx->'processedDate' is not distinct from new_tx->'processedDate'
 and old_tx->'type' is not distinct from new_tx->'type' and old_tx->'foreignTransaction' is not distinct from new_tx->'foreignTransaction'
 and netunim_internal.credit_source_evidence(old_tx,new_tx)
 and netunim_internal.credit_financial_key(old_tx)=netunim_internal.credit_financial_key(new_tx || jsonb_build_object(
 'chargedAmount',old_tx->'chargedAmount','chargedCurrency',old_tx->'chargedCurrency','chargeAmountStatus',old_tx->'chargeAmountStatus'))
$f$;
commit;
