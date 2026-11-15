"""Actual RPC/trigger/history/restore tests on a disposable PostgreSQL cluster."""
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote


migration = ROOT/'supabase/migrations/20261115160000_finance_credit_history.sql'
with IsolatedPostgres(schema_files=[p for p in sorted(migration.parent.glob('*.sql')) if p.name < migration.name]) as db:
    db.auth_sql("select public.claim_finance_sync_lease('credit','history-test',120)")
    epoch = int(db.auth_sql("select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'").strip())
    def save(state, revision, operation, document='history-test'):
        return json.loads(db.auth_sql("select row_to_json(r) from public.save_finance_sync_document_v6("+quote(document)+","+
            str(revision)+','+quote(json.dumps(state))+"::jsonb,"+quote(operation)+",'{}','credit','history-test',"+str(epoch)+") r").strip())

    baseline={'bank':{'balance':10},'creditSync':{'version':4,'profiles':[]}}
    assert save(baseline,0,'baseline',document='pre-migration')['revision']==1
    db.migrate(migration.read_text(encoding='utf-8'))
    for later in sorted(migration.parent.glob('*.sql')):
        if later.name > migration.name: db.migrate(later.read_text(encoding='utf-8'))
    seeded=json.loads(db.auth_sql("select row_to_json(r) from public.read_finance_document_version('pre-migration',1) r").strip())
    assert seeded['state']==baseline, 'existing Finance head was not captured by migration'

    def rejected(state, revision, operation, message, document='history-test'):
        try:
            save(state, revision, operation, document)
        except RuntimeError as error:
            assert message in str(error), error
        else:
            raise AssertionError('unsafe write accepted: '+operation)

    tx = {'id':'A','status':'completed','type':'normal','processedDate':'2020-01-10T00:00:00Z',
          'date':'2020-01-01T00:00:00Z','originalAmount':-100,'originalCurrency':'ILS','chargedAmount':-100,'chargedCurrency':'ILS'}
    unknown = {**tx, 'id':'FX', 'processedDate':None, 'originalCurrency':'USD', 'chargedAmount':None}
    state = {'bank':{'balance':900},'creditSync':{'version':4,'profiles':[{'profileId':'P','provider':'max','accounts':[
        {'accountNumber':'C','months':[{'month':'2020-01','transactions':[tx]}],'unassignedTransactions':[unknown]}]}]}}
    first = save(state,0,'first')
    assert first['revision']==1
    deleted = json.loads(json.dumps(state)); deleted['creditSync']['profiles'][0]['accounts'][0]['months']=[]
    rejected(deleted,1,'delete-month','credit_history_regression')
    altered = json.loads(json.dumps(state));altered['creditSync']['profiles'][0]['accounts'][0]['months'][0]['transactions'][0]['chargedAmount']=-1
    rejected(altered,1,'change-amount','credit_history_regression')
    missing = json.loads(json.dumps(state));missing['creditSync']['profiles'][0]['accounts'][0]['unassignedTransactions']=[]
    rejected(missing,1,'delete-unassigned','credit_unassigned_regression')
    try:
        db.auth_sql("set local app.credit_restore='true';set local app.credit_history_bypass='true';select public.save_finance_sync_document_v6('history-test',1,"+
            quote(json.dumps(deleted))+"::jsonb,'fake-restore','{}','credit','history-test',"+str(epoch)+")")
    except RuntimeError as error:
        assert 'credit_history_regression' in str(error)
    else:
        raise AssertionError('caller metadata bypassed history protection')
    assigned=json.loads(json.dumps(state));account=assigned['creditSync']['profiles'][0]['accounts'][0]
    account['unassignedTransactions']=[];account['months'].append({'month':'2020-02','transactions':[{**unknown,'chargedAmount':-365,'processedDate':'2020-02-10T00:00:00Z'}]})
    assigned['bank']['balance']=950
    second=save(assigned,1,'assign')
    assert second['revision']==2
    duplicate=json.loads(json.dumps(assigned));duplicate['creditSync']['profiles'][0]['accounts'][0]['unassignedTransactions']=[unknown]
    rejected(duplicate,2,'double-placement','credit_duplicate_placement')
    rejected(duplicate,0,'initial-double-placement','credit_duplicate_placement',document='initial-duplicate')
    versions=json.loads(db.auth_sql("select json_agg(r) from public.list_finance_document_versions('history-test') r").strip())
    assert [row['revision'] for row in versions]==[2,1]
    preview=json.loads(db.auth_sql("select row_to_json(r) from public.read_finance_document_version('history-test',1) r").strip())
    assert preview['state']==state and len(preview['state_hash'])==64

    def restore(expected=2, operation='restore-original', reason='Verified original issuer data'):
        return json.loads(db.auth_sql("select row_to_json(r) from public.restore_finance_credit_version('history-test',1,"+
            str(expected)+','+quote(operation)+','+quote(reason)+",'history-test',"+str(epoch)+") r").strip())
    restored=restore()
    assert restored['revision']==3 and restored['state']['creditSync']==state['creditSync']
    assert restored['state']['bank']['balance']==950, 'restore rewound current bank data'
    replay=restore()
    assert replay['revision']==3 and replay['operation_replayed'] is True
    assert len(json.loads(db.auth_sql("select json_agg(r) from public.list_finance_document_versions('history-test') r").strip()))==3
    try:
        restore(reason='Different data correction intent')
    except RuntimeError as error:
        assert 'finance_restore_operation_reused' in str(error)
    else:
        raise AssertionError('restore operation id accepted a changed request')
    try:
        restore(2,'stale-restore')
    except RuntimeError as error:
        assert 'finance_restore_revision_conflict' in str(error)
    else:
        raise AssertionError('stale restore accepted')
    reset=json.loads(db.auth_sql("select row_to_json(r) from public.reset_finance_credit_with_backup('history-test','{\"version\":4,\"profiles\":[]}',3,'confirmed-reset','Confirmed account reset','history-test',"+str(epoch)+") r").strip())
    assert reset['revision']==4 and reset['state']['creditSync']['profiles']==[]
    assert reset['state']['bank']['balance']==950
    assert json.loads(db.auth_sql("select row_to_json(r) from public.read_finance_document_version('history-test',3) r").strip())['state']['creditSync']==state['creditSync']
    legacy={'bank':{'balance':950},'creditSync':{'profiles':[{'profileId':'P','provider':'max','accounts':[{'accountNumber':'C','txns':[unknown]}]}]}}
    assert save(legacy,4,'legacy-source')['revision']==5
    legacy_empty=json.loads(json.dumps(legacy));legacy_empty['creditSync']['profiles'][0]['accounts'][0]['txns']=[]
    rejected(legacy_empty,5,'legacy-loss','credit_unassigned_regression')
    today=db.sql("select to_char(current_timestamp at time zone 'Asia/Jerusalem','YYYY-MM-DD')").strip()
    same_day=json.loads(json.dumps(assigned));same_day['creditSync']['profiles'][0]['accounts'][0]={'accountNumber':'C',
        'months':[{'month':today[:7],'transactions':[{**tx,'processedDate':today+'T00:00:00Z'}]}],'unassignedTransactions':[unknown]}
    assert save(same_day,5,'same-day')['revision']==6
    same_day_empty=json.loads(json.dumps(same_day));same_day_empty['creditSync']['profiles'][0]['accounts'][0]['months']=[]
    rejected(same_day_empty,6,'same-day-loss','credit_history_regression')
    # Different old observations sharing source evidence must never reuse one
    # new candidate; sums and IDs alone cannot establish a one-to-one match.
    collision=json.loads(json.dumps(state));collision_account=collision['creditSync']['profiles'][0]['accounts'][0]
    collision_account['months']=[]
    collision_account['unassignedTransactions']=[unknown,{**unknown,'chargedAmount':-365}]
    assert save(collision,0,'collision-start',document='collision')['revision']==1
    fewer=json.loads(json.dumps(collision));fewer['creditSync']['profiles'][0]['accounts'][0]['unassignedTransactions']=[{**unknown,'chargedAmount':-365}]
    rejected(fewer,1,'reused-source','credit_unassigned_regression',document='collision')
    anonymous=json.loads(json.dumps(collision));anonymous['creditSync']['profiles'][0]['accounts'][0]['unassignedTransactions']=[{**unknown,'id':''}]*2
    assert save(anonymous,0,'anonymous-start',document='anonymous')['revision']==1
    fewer=json.loads(json.dumps(anonymous));fewer['creditSync']['profiles'][0]['accounts'][0]['unassignedTransactions'].pop()
    rejected(fewer,1,'anonymous-loss','credit_unassigned_regression',document='anonymous')
    alias=json.loads(json.dumps(state));alias['creditSync']['profiles'][0]['ownerLabel']='Owner'
    assert save(alias,0,'alias-start',document='alias')['revision']==1
    alias_new=json.loads(json.dumps(alias));alias_new['creditSync']['profiles'][0]['profileId']='new-P'
    rejected(alias_new,1,'unproved-alias','credit_history_regression',document='alias')
    ambiguous=json.loads(json.dumps(alias_new));ambiguous['creditSync']['profiles'][0]['profileId']='newer-P'
    ambiguous['creditSync']['profiles'].append({**ambiguous['creditSync']['profiles'][0],'profileId':'other-P'})
    rejected(ambiguous,1,'ambiguous-alias','credit_history_regression',document='alias')
    try:
        db.auth_sql("select public.restore_finance_credit_version('history-test',1,6,'stale-lease','Verified original issuer data','invalid-token',"+str(epoch)+")")
    except RuntimeError as error:
        assert 'stale_finance_sync_fence' in str(error)
    else:
        raise AssertionError('restore accepted a stale lease')
    try:
        db.auth_sql("update netunim_internal.finance_document_versions set state='{}'")
    except RuntimeError as error:
        assert 'permission denied' in str(error)
    else:
        raise AssertionError('application can overwrite immutable versions')
    try:
        db.auth_sql("insert into netunim_internal.finance_credit_restore_context values(pg_backend_pid(),txid_current(),auth.uid(),'Forged restore authority')")
    except RuntimeError as error:
        assert 'permission denied' in str(error)
    else:
        raise AssertionError('application can manufacture restore authority')
    other=db.sql("begin;set local role authenticated;set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';set local request.jwt.claim.role='authenticated';select count(*) from public.read_finance_document_version('history-test',1);commit;")
    assert other.strip()=='0', other
    db.sql("insert into auth.mfa_factors(user_id,status) values('11111111-1111-4111-8111-111111111111','verified')")
    for query in ("select * from public.list_finance_document_versions('history-test')",
                  "select * from public.read_finance_document_version('history-test',1)",
                  "select * from public.restore_finance_credit_version('history-test',1,6,'mfa-restore','Verified original issuer data','history-test',"+str(epoch)+")"):
        try:
            db.auth_sql(query)
        except RuntimeError as error:
            assert 'mfa_required' in str(error)
        else:
            raise AssertionError('financial history endpoint accepted AAL1 after MFA enrollment')
    assert db.auth_sql("set local request.jwt.claims='{\"aal\":\"aal2\"}';select count(*) from public.list_finance_document_versions('history-test')").strip()=='6'
    print('PASS Finance SQL: protected months/amounts/unassigned, verified assignment, immutable owner-scoped versions, Credit-only restore, stale conflict and idempotent replay')
