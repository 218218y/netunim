-- STAGING ONLY. Requires the v3 migration and a dedicated test owner.
-- Usage: psql -v owner_id='<dedicated-test-user-uuid>' -v samples=200 -f cloud_sync_v3_benchmark.sql
-- The transaction rolls back. Do not use a production project or production user.
\if :{?owner_id}
\else
  \echo 'owner_id is required; refusing to run'
  \quit
\endif
\if :{?samples}
\else
  \set samples 200
\endif

begin;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);
create temporary table sync_v3_latency(rpc text not null, elapsed_ms double precision not null) on commit drop;
create temporary table sync_v3_benchmark_settings(samples int not null) on commit drop;
insert into sync_v3_benchmark_settings values (:samples);

do $bench$
declare
  v_samples int;
  i int; v_started timestamptz; v_revision bigint; v_state jsonb; v_result record;
  v_bank jsonb; v_seq bigint; v_token text; v_batch jsonb; v_lease_token text:='sync-v3-benchmark-lease';
begin
  select samples into v_samples from sync_v3_benchmark_settings;
  for i in 1..v_samples loop
    select revision,state into v_revision,v_state from public.order_management_documents where owner_id=auth.uid() and document_name='suppliers';
    v_started:=clock_timestamp();
    select * into v_result from public.save_order_management_document_v3('suppliers',v_revision,jsonb_set(v_state,'{_syncV3Benchmark}',to_jsonb(i),true),'bench-orders-'||i::text);
    insert into sync_v3_latency values('save_order_management_document',extract(epoch from clock_timestamp()-v_started)*1000);

    select revision,state into v_revision,v_state from public.kupa_documents where owner_id=auth.uid() and document_name='main';
    v_started:=clock_timestamp();
    select * into v_result from public.save_kupa_document_v3('main',v_revision,jsonb_set(v_state,'{_syncV3Benchmark}',to_jsonb(i),true),'bench-kupa-'||i::text);
    insert into sync_v3_latency values('save_kupa_document',extract(epoch from clock_timestamp()-v_started)*1000);

    select revision,state into v_revision,v_state from public.finance_sync_documents where owner_id=auth.uid() and document_name='main';
    v_started:=clock_timestamp();
    select * into v_result from public.save_finance_sync_document_v3('main',v_revision,jsonb_set(v_state,'{_syncV3Benchmark}',to_jsonb(i),true),'bench-finance-'||i::text);
    insert into sync_v3_latency values('save_finance_sync_document',extract(epoch from clock_timestamp()-v_started)*1000);

    select revision,state into v_revision,v_state from public.shared_checks_documents where owner_id=auth.uid() and document_name='main';
    if jsonb_array_length(v_state->'checks')=0 then
      v_state:=jsonb_set(v_state,'{checks}',jsonb_build_array(jsonb_build_object(
        'id','sync-v3-benchmark-check','amount',0,'dueDate','2026-01-01','status','בקופה','_syncV3Benchmark',i
      )),true);
    else
      v_state:=jsonb_set(v_state,'{checks,0,_syncV3Benchmark}',to_jsonb(i),true);
    end if;
    v_started:=clock_timestamp();
    select * into v_result from public.save_shared_checks_document_v3('main',v_revision,v_state,'bench-checks-'||i::text);
    insert into sync_v3_latency values('save_shared_checks_document',extract(epoch from clock_timestamp()-v_started)*1000);

    select f.state->'bank',greatest(0,coalesce((k.state#>>'{bank,snapshotSeq}')::bigint,0))
    into v_bank,v_seq from public.finance_sync_documents f join public.kupa_documents k using(owner_id,document_name)
    where f.owner_id=auth.uid() and f.document_name='main';
    v_token:='sync-v3-benchmark-bank-'||i::text;
    v_started:=clock_timestamp();
    select * into v_result from public.save_bank_sync_snapshot('main',jsonb_set(v_bank,'{_syncV3Benchmark}',to_jsonb(i),true),v_token,v_seq);
    insert into sync_v3_latency values('save_bank_sync_snapshot',extract(epoch from clock_timestamp()-v_started)*1000);

    v_batch:=jsonb_build_array(jsonb_build_object(
      'mergeKey','sync-v3-benchmark-row','date','2026-01-02T10:00:00Z','processedDate','2026-01-02T10:00:00Z',
      'amount',1,'currency','ILS','description','sync-v3-benchmark','memo',i::text,'status','completed',
      'bankReference','sync-v3-benchmark-reference','bankSerial','0','cheque',false));
    v_started:=clock_timestamp();
    select * into v_result from public.merge_bank_transactions('sync-v3-benchmark','business',v_batch);
    insert into sync_v3_latency values('merge_bank_transactions',extract(epoch from clock_timestamp()-v_started)*1000);

    v_started:=clock_timestamp();
    select * into v_result from public.claim_finance_sync_lease('bank',v_lease_token,120);
    insert into sync_v3_latency values('claim_finance_sync_lease',extract(epoch from clock_timestamp()-v_started)*1000);
    v_started:=clock_timestamp();
    perform public.release_finance_sync_lease('bank',v_lease_token);
    insert into sync_v3_latency values('release_finance_sync_lease',extract(epoch from clock_timestamp()-v_started)*1000);
  end loop;
end
$bench$;

select rpc,
       count(*) as samples,
       round(percentile_cont(0.50) within group(order by elapsed_ms)::numeric,3) as p50_ms,
       round(percentile_cont(0.95) within group(order by elapsed_ms)::numeric,3) as p95_ms,
       round(percentile_cont(0.99) within group(order by elapsed_ms)::numeric,3) as p99_ms,
       round(max(elapsed_ms)::numeric,3) as max_ms,
       ceil(5*percentile_cont(0.99) within group(order by elapsed_ms))::int as minimum_5x_p99_ms
from sync_v3_latency
group by rpc
order by rpc;

rollback;
