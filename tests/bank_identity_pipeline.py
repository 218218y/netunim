"""Actual Bridge/protocol/SQL/readback chain in the disposable candidate database."""
import json
import subprocess
from browser_harness import ROOT


def run(db):
    fixture = ROOT / 'tests/bank_identity_pipeline_fixture.mjs'
    source = json.loads(subprocess.check_output(['node', str(fixture), 'source'], cwd=ROOT, encoding='utf8'))
    transactions = json.dumps(source['command']['p_transactions'], ensure_ascii=False).replace("'", "''")
    sql = r"""
begin;
do $test$
declare lease record; rows jsonb := '__TRANSACTIONS__'; original_ids bigint[]; current_ids bigint[];
  before_state jsonb;
begin
  perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
  delete from public.finance_sync_leases where owner_id=auth.uid() and lease_name='bank';
  select * into lease from public.claim_finance_sync_lease('bank','identity-pipeline',60);
  perform public.sync_bank_transactions_snapshot_v6('synthetic-account','business',rows,
    clock_timestamp(),'2026-10-01','2026-10-18',true,'bank','identity-pipeline',lease.fence_epoch);
  select array_agg(id order by bank_serial) into original_ids from public.bank_transactions
    where owner_id=auth.uid() and account_key='synthetic-account';
  if cardinality(original_ids)<>2 then raise exception 'identity_pipeline_lost_source_row'; end if;
  -- A reversed replay is the same two operations, with the same archive IDs.
  perform public.sync_bank_transactions_snapshot_v6('synthetic-account','business',jsonb_build_array(rows->1,rows->0),
    clock_timestamp(),'2026-10-01','2026-10-18',true,'bank','identity-pipeline',lease.fence_epoch);
  select array_agg(id order by bank_serial) into current_ids from public.bank_transactions
    where owner_id=auth.uid() and account_key='synthetic-account';
  if current_ids is distinct from original_ids then raise exception 'identity_pipeline_changed_archive_ids'; end if;
  select jsonb_build_object(
    'archive',(select jsonb_agg(to_jsonb(b) order by id) from public.bank_transactions b where owner_id=auth.uid() and account_key='synthetic-account'),
    'snapshot',(select to_jsonb(s) from public.bank_transaction_snapshots s where owner_id=auth.uid() and account_key='synthetic-account' and account_role='business'))
    into before_state;
  begin
    perform public.sync_bank_transactions_snapshot_v6('synthetic-account','business',jsonb_build_array(rows->0,rows->0),
      clock_timestamp(),'2026-10-01','2026-10-18',true,'bank','identity-pipeline',lease.fence_epoch);
    raise exception 'identity_pipeline_accepted_ambiguous_source';
  exception when sqlstate '22023' then
    if sqlerrm<>'bank_archive_ambiguous_source_identity' then raise; end if;
  end;
  if before_state is distinct from jsonb_build_object(
    'archive',(select jsonb_agg(to_jsonb(b) order by id) from public.bank_transactions b where owner_id=auth.uid() and account_key='synthetic-account'),
    'snapshot',(select to_jsonb(s) from public.bank_transaction_snapshots s where owner_id=auth.uid() and account_key='synthetic-account' and account_role='business')) then
    raise exception 'identity_pipeline_failed_write_changed_state';
  end if;
end
$test$;
select jsonb_build_object(
  'archive',(select jsonb_agg(to_jsonb(b) order by id desc) from public.bank_transactions b where owner_id=auth.uid() and account_key='synthetic-account'),
  'snapshot',(select to_jsonb(s) from public.bank_transaction_snapshots s where owner_id=auth.uid() and account_key='synthetic-account' and account_role='business'));
rollback;
""".replace('__TRANSACTIONS__', transactions)
    packet = json.loads(db.sql(sql))
    packet['source'] = source
    result = subprocess.run(['node', str(fixture), 'verify'], cwd=ROOT, input=json.dumps(packet),
                            encoding='utf8', capture_output=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    print(result.stdout.strip(), flush=True)
