begin;
set local lock_timeout='2s';
set local statement_timeout='60s';

-- Append-only for application roles. No retention job removes financial versions.
create table netunim_internal.finance_document_versions (
  owner_id uuid not null,
  document_name text not null,
  revision bigint not null,
  state jsonb not null,
  state_hash text not null,
  captured_at timestamptz not null default clock_timestamp(),
  reason text not null,
  primary key(owner_id,document_name,revision)
);
alter table netunim_internal.finance_document_versions enable row level security;
revoke all on netunim_internal.finance_document_versions from public,anon,authenticated,service_role;

-- A caller-set GUC cannot authorize a destructive restore. Only the guarded
-- SECURITY DEFINER restore endpoint can insert this transaction-scoped proof.
create table netunim_internal.finance_credit_restore_context (
  backend_pid integer not null, transaction_id bigint not null, owner_id uuid not null,
  reason text not null, primary key(backend_pid,transaction_id,owner_id)
);
revoke all on netunim_internal.finance_credit_restore_context from public,anon,authenticated,service_role;

create table netunim_internal.finance_credit_restore_requests (
 owner_id uuid not null, document_name text not null, operation_id text not null,
 request_hash text not null, applied_revision bigint not null,
 primary key(owner_id,document_name,operation_id)
);
revoke all on netunim_internal.finance_credit_restore_requests from public,anon,authenticated,service_role;

create function netunim_internal.credit_financial_key(tx jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $f$
 select jsonb_build_array(coalesce(tx->>'id',''),tx->'type',tx->'status',tx->'processedDate',tx->'date',
   tx->'chargedAmount',tx->'chargedCurrency',tx->'originalAmount',tx->'originalCurrency',
   tx->'foreignTransaction',tx->'chargeAmountStatus',tx#>'{installments,number}',tx#>'{installments,total}',
   case when coalesce(tx->>'id','')='' then tx->'description' else null end)
$f$;

create function netunim_internal.credit_month_rows(account jsonb)
returns table(month text,tx jsonb) language sql immutable set search_path=pg_catalog as $f$
 select slice->>'month',item from jsonb_array_elements(coalesce(account->'months','[]')) slice
 cross join lateral jsonb_array_elements(coalesce(slice->'transactions','[]')) item
 union all
 select left(item->>'processedDate',7),item from jsonb_array_elements(coalesce(account->'txns','[]')) item
 where jsonb_array_length(coalesce(account->'months','[]'))=0
   and coalesce(item->>'processedDate','')<>'' and coalesce(item->>'status','completed')<>'pending'
$f$;

create function netunim_internal.credit_unassigned_rows(account jsonb)
returns setof jsonb language sql immutable set search_path=pg_catalog as $f$
 select value from jsonb_array_elements(coalesce(account->'unassignedTransactions','[]'))
 union all
 select value from jsonb_array_elements(coalesce(account->'txns','[]'))
 where jsonb_array_length(coalesce(account->'months','[]'))=0
 and not (account ? 'unassignedTransactions') and coalesce(value->>'processedDate','')=''
 and coalesce(value->>'status','completed')<>'pending'
$f$;

create function netunim_internal.credit_source_matches(old_tx jsonb,new_tx jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $f$
 select coalesce(old_tx->>'id','')<>'' and old_tx->>'id'=new_tx->>'id'
   and coalesce(old_tx->>'date','')<>'' and old_tx->>'date'=new_tx->>'date'
   and old_tx->>'originalAmount' is not null and coalesce(old_tx->>'originalCurrency','')<>''
   and old_tx->'originalAmount'=new_tx->'originalAmount' and old_tx->'originalCurrency'=new_tx->'originalCurrency'
   and old_tx#>'{installments,number}' is not distinct from new_tx#>'{installments,number}'
   and old_tx#>'{installments,total}' is not distinct from new_tx#>'{installments,total}'
   and (old_tx->>'chargedAmount' is null or
     old_tx->'chargedAmount'=new_tx->'chargedAmount' and old_tx->'chargedCurrency'=new_tx->'chargedCurrency')
$f$;

create function netunim_internal.guard_finance_credit_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $f$
declare p jsonb;a jsonb;n jsonb;r record;v_accounts jsonb;v_candidates jsonb;v_matches bigint[];v_consumed bigint[];
 v_day text:=to_char(current_timestamp at time zone 'Asia/Jerusalem','YYYY-MM-DD');
begin
 if exists(select 1 from netunim_internal.finance_credit_restore_context c
   where c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current() and c.owner_id=old.owner_id) then return new;end if;
 for p in select value from jsonb_array_elements(coalesce(new.state#>'{creditSync,profiles}','[]')) loop
  for a in select value from jsonb_array_elements(coalesce(p->'accounts','[]')) loop
   if exists(select 1 from netunim_internal.credit_unassigned_rows(a) source
     cross join lateral netunim_internal.credit_month_rows(a) assigned
     where netunim_internal.credit_source_matches(source,assigned.tx)) then
     raise exception 'credit_duplicate_placement' using errcode='23514';end if;
  end loop;
 end loop;
 if tg_op='INSERT' then return new;end if;
 for p in select value from jsonb_array_elements(coalesce(old.state#>'{creditSync,profiles}','[]')) loop
  for a in select value from jsonb_array_elements(coalesce(p->'accounts','[]')) loop
   -- Prefer exact profile identity. An import alias additionally needs the
   -- same explicit owner, issuer and card; suffix/amount alone never suffice.
   select jsonb_agg(account) into v_accounts from jsonb_array_elements(coalesce(new.state#>'{creditSync,profiles}','[]')) profile
     cross join lateral jsonb_array_elements(coalesce(profile->'accounts','[]')) account
     where account->>'accountNumber'=a->>'accountNumber' and profile->>'profileId'=p->>'profileId';
   if v_accounts is null then
    select jsonb_agg(account) into v_accounts from jsonb_array_elements(coalesce(new.state#>'{creditSync,profiles}','[]')) profile
      cross join lateral jsonb_array_elements(coalesce(profile->'accounts','[]')) account
      where account->>'accountNumber'=a->>'accountNumber' and profile->>'provider'=p->>'provider'
        and coalesce(p->>'ownerLabel','')<>'' and profile->>'ownerLabel'=p->>'ownerLabel';
   end if;
   n:=case when jsonb_array_length(v_accounts)=1 then v_accounts->0 else '{}'::jsonb end;
   if exists(
     (select month,netunim_internal.credit_financial_key(tx) from netunim_internal.credit_month_rows(a)
       where month<left(v_day,7) or coalesce(tx->>'status','completed')='completed' and left(tx->>'processedDate',10)<=v_day)
     except all
     (select month,netunim_internal.credit_financial_key(tx) from netunim_internal.credit_month_rows(n))
   ) then raise exception 'credit_history_regression' using errcode='23514';end if;
   select coalesce(jsonb_agg(jsonb_build_object('tx',tx,'assigned',assigned)),'[]') into v_candidates from (
     select value as tx,false as assigned from netunim_internal.credit_unassigned_rows(n) value
     union all select tx,true from netunim_internal.credit_month_rows(n)
   ) rows;
   v_consumed:=array[]::bigint[];
   for r in select netunim_internal.credit_financial_key(value) as key,count(*) as needed,(jsonb_agg(value)->0) as tx
     from netunim_internal.credit_unassigned_rows(a) value group by 1 loop
    select array_agg(position order by position) into v_matches
    from jsonb_array_elements(v_candidates) with ordinality candidates(value,position)
    where (not (value->>'assigned')::boolean and netunim_internal.credit_financial_key(value->'tx')=r.key)
      or netunim_internal.credit_source_matches(r.tx,value->'tx');
    if coalesce(cardinality(v_matches),0)<r.needed
      or coalesce(r.tx->>'id','')<>'' and cardinality(v_matches)<>r.needed
      or v_matches && v_consumed then
      raise exception 'credit_unassigned_regression' using errcode='23514';end if;
    v_consumed:=v_consumed||v_matches[1:r.needed];
   end loop;
  end loop;
 end loop;
 return new;
end $f$;
create trigger finance_credit_history_guard before insert or update on public.finance_sync_documents
for each row execute function netunim_internal.guard_finance_credit_history();

create function netunim_internal.capture_finance_document_version() returns trigger
language plpgsql security definer set search_path=pg_catalog,netunim_internal as $f$
declare v_reason text;
begin
 if tg_op='UPDATE' and new.state=old.state then return new;end if;
 select c.reason into v_reason from netunim_internal.finance_credit_restore_context c
 where c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current() and c.owner_id=new.owner_id;
 insert into netunim_internal.finance_document_versions(owner_id,document_name,revision,state,state_hash,reason)
 values(new.owner_id,new.document_name,new.revision,new.state,encode(sha256(convert_to(new.state::text,'UTF8')),'hex'),coalesce(v_reason,'finance-write'));
 return new;
end $f$;
create trigger finance_document_version_capture after insert or update on public.finance_sync_documents
for each row execute function netunim_internal.capture_finance_document_version();
insert into netunim_internal.finance_document_versions(owner_id,document_name,revision,state,state_hash,reason)
select owner_id,document_name,revision,state,encode(sha256(convert_to(state::text,'UTF8')),'hex'),'migration-baseline'
from public.finance_sync_documents;

create function public.list_finance_document_versions(p_document_name text,p_before_revision bigint default null)
returns table(revision bigint,state_hash text,captured_at timestamptz,reason text)
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $f$
begin
 perform netunim_internal.require_financial_mfa_v1();
 return query select v.revision,v.state_hash,v.captured_at,v.reason from netunim_internal.finance_document_versions v
 where v.owner_id=auth.uid() and v.document_name=p_document_name
 and (p_before_revision is null or v.revision<p_before_revision) order by v.revision desc limit 100;
end $f$;
create function public.read_finance_document_version(p_document_name text,p_revision bigint)
returns table(revision bigint,state jsonb,state_hash text)
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $f$
begin
 perform netunim_internal.require_financial_mfa_v1();
 return query select v.revision,v.state,v.state_hash from netunim_internal.finance_document_versions v
 where v.owner_id=auth.uid() and v.document_name=p_document_name and v.revision=p_revision;
end $f$;

-- Restore ONLY Credit; bank snapshots, Kupa and shared checks remain current.
-- The existing writer still owns revision, operation replay, MFA and lease fences.
create function netunim_internal.apply_finance_credit_correction(p_document_name text,p_credit_sync jsonb,p_expected_revision bigint,
 p_operation_id text,p_reason text,p_lease_token text,p_fence_epoch bigint,p_request_hash text)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $f$
declare v_current jsonb;v_revision bigint;v_request_hash text;v_receipt record;v_saved record;
begin
 perform netunim_internal.require_financial_mfa_v1();
 perform netunim_internal.assert_storage_writer_operation_fence_v2('finance-document-save','credit',p_lease_token,p_fence_epoch);
 if length(btrim(coalesce(p_reason,'')))<8 or length(p_reason)>500 then
   raise exception 'finance_restore_reason_required' using errcode='22023';end if;
 select d.state,d.revision into v_current,v_revision from public.finance_sync_documents d
 where d.owner_id=auth.uid() and d.document_name=p_document_name for update;
 v_request_hash:=p_request_hash;
 select * into v_receipt from netunim_internal.finance_credit_restore_requests r
 where r.owner_id=auth.uid() and r.document_name=p_document_name and r.operation_id=p_operation_id;
 if found then
   if v_receipt.request_hash<>v_request_hash then raise exception 'finance_restore_operation_reused' using errcode='23514';end if;
   return query select d.revision,d.updated_at,d.state,true,v_receipt.applied_revision from public.finance_sync_documents d
     where d.owner_id=auth.uid() and d.document_name=p_document_name;
   return;
 end if;
 if v_revision is distinct from p_expected_revision then raise exception 'finance_restore_revision_conflict' using errcode='40001';end if;
 insert into netunim_internal.finance_credit_restore_context values(pg_backend_pid(),txid_current(),auth.uid(),'credit-restore: '||p_reason);
 perform netunim_internal.enter_storage_writer_operation_v2('finance-document-save');
 select * into v_saved from netunim_internal.fenced_impl_save_finance_sync_document_v5(p_document_name,p_expected_revision,
   jsonb_set(v_current,'{creditSync}',p_credit_sync),p_operation_id,
   jsonb_build_object('source','credit-correction','reason',p_reason,'hash',v_request_hash));
 insert into netunim_internal.finance_credit_restore_requests values(auth.uid(),p_document_name,p_operation_id,v_request_hash,v_saved.operation_revision);
 return query select v_saved.revision,v_saved.updated_at,v_saved.state,v_saved.operation_replayed,v_saved.operation_revision;
 perform netunim_internal.leave_storage_writer_operation_v2('finance-document-save');
 delete from netunim_internal.finance_credit_restore_context where backend_pid=pg_backend_pid() and transaction_id=txid_current() and owner_id=auth.uid();
end $f$;

create function public.restore_finance_credit_version(p_document_name text,p_version bigint,p_expected_revision bigint,
 p_operation_id text,p_reason text,p_lease_token text,p_fence_epoch bigint)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $f$
declare v_target jsonb;v_hash text;
begin
 perform netunim_internal.require_financial_mfa_v1();
 select v.state,v.state_hash into v_target,v_hash from netunim_internal.finance_document_versions v
 where v.owner_id=auth.uid() and v.document_name=p_document_name and v.revision=p_version;
 if v_target is null then raise exception 'finance_version_not_found' using errcode='P0002';end if;
 if encode(sha256(convert_to(v_target::text,'UTF8')),'hex')<>v_hash then raise exception 'finance_version_hash_mismatch' using errcode='23514';end if;
 return query select * from netunim_internal.apply_finance_credit_correction(p_document_name,coalesce(v_target->'creditSync','{}'),p_expected_revision,
 p_operation_id,p_reason,p_lease_token,p_fence_epoch,encode(sha256(convert_to(jsonb_build_array('restore',p_version,p_expected_revision,p_reason)::text,'UTF8')),'hex'));
end $f$;

create function public.reset_finance_credit_with_backup(p_document_name text,p_credit_sync jsonb,p_expected_revision bigint,
 p_operation_id text,p_reason text,p_lease_token text,p_fence_epoch bigint)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $f$
begin
 perform netunim_internal.require_financial_mfa_v1();
 if jsonb_typeof(p_credit_sync) is distinct from 'object' or jsonb_typeof(p_credit_sync->'profiles') is distinct from 'array'
   or jsonb_array_length(p_credit_sync->'profiles')<>0 then raise exception 'invalid_credit_reset' using errcode='22023';end if;
 return query select * from netunim_internal.apply_finance_credit_correction(p_document_name,p_credit_sync,p_expected_revision,
 p_operation_id,p_reason,p_lease_token,p_fence_epoch,encode(sha256(convert_to(jsonb_build_array('reset',p_credit_sync,p_expected_revision,p_reason)::text,'UTF8')),'hex'));
end $f$;

revoke all on function netunim_internal.credit_financial_key(jsonb),netunim_internal.credit_month_rows(jsonb),
 netunim_internal.credit_source_matches(jsonb,jsonb),netunim_internal.credit_unassigned_rows(jsonb),netunim_internal.guard_finance_credit_history(),
 netunim_internal.capture_finance_document_version(),netunim_internal.apply_finance_credit_correction(text,jsonb,bigint,text,text,text,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.list_finance_document_versions(text,bigint),public.read_finance_document_version(text,bigint),
 public.restore_finance_credit_version(text,bigint,bigint,text,text,text,bigint),public.reset_finance_credit_with_backup(text,jsonb,bigint,text,text,text,bigint) from public,anon;
grant execute on function public.list_finance_document_versions(text,bigint),public.read_finance_document_version(text,bigint),
 public.restore_finance_credit_version(text,bigint,bigint,text,text,text,bigint),public.reset_finance_credit_with_backup(text,jsonb,bigint,text,text,text,bigint) to authenticated;
commit;
