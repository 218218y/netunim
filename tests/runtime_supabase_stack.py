"""Real GoTrue/PostgREST/Storage/pg_cron acceptance; no SQL RPC relay.

Run only in the required disposable Linux CI job. Browser profiles exercise the
production Auth, journal and business merge modules against the real HTTP API.
Only transport failures and synthetic image bytes are supplied by the fixture.
"""
import hashlib
import json
import secrets
import time
import uuid

from acceptance_safety import write_evidence
from browser_harness import BrowserSession, ROOT
from isolated_supabase import IsolatedSupabase


def js(value):
    return json.dumps(value, ensure_ascii=False)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class StackBrowser(BrowserSession):
    def __init__(self, stack, app, side):
        super().__init__(ROOT/f'netunim-{app}/site', app+'-full-stack-'+side,
                         instrument=False, native_incidents=True, supabase=stack)
        self.app = app

    def _prepare_site(self):
        super()._prepare_site()
        # Isolate production components from unrelated full-UI startup timers.
        # This is component integration, not a claim of full UI acceptance.
        (self.tmp/'site/index.html').write_text('<!doctype html><meta charset="utf-8"><title>Isolated component acceptance</title>', encoding='utf8')

    def auth(self, email=None, password=None):
        return self.evaluate('''(async()=>{
          const {createCloudAuth}=await import('./assets/js/cloud/auth.js');
          if('''+js(self.app)+'''==='orders')window.auth=createCloudAuth({session:{}});
          else {
            const {createStorageIndexedDb}=await import('./assets/js/storage/indexed-db.js');
            window.auth=createCloudAuth({session:{},...createStorageIndexedDb({}),
              supaProjectRef:()=> 'isolated',setCloudHeaderStatus:()=>{}});
            await auth.restoreSupaSession();
          }
          window.sessionRead=()=>auth.loadSession?.()||auth.loadSupaSession?.();
          window.request=(path,options)=>auth.supaFetch?auth.supaFetch(path,options):auth.supaRest(path,options);
          if('''+js(email)+''')await (auth.authPassword||auth.supaAuthPassword)('''+js(email)+','+js(password)+''');
          if(!auth.supaConfigured())throw Error('native Auth rejected local stack configuration');
          return {owner:sessionRead()?.user?.id,configured:auth.supaConfigured()};
        })()''', timeout=40)

    def setup(self, initialize=False):
        fixture = (ROOT/'tests/fixtures/rapid-profile-fields.mjs').read_text(encoding='utf8')
        fixture = fixture.replace('export async function', 'async function')
        return self.evaluate('(async()=>{'+fixture+';window.rapid=await createRapidProfile('
                             +js(self.app)+','+js(initialize)+');return rapid.state()})()', timeout=30)

    def rpc(self, name, body, *, wait=True):
        expression = "request('/rest/v1/rpc/"+name+"',{method:'POST',body:JSON.stringify("+js(body)+")}).then(async r=>{const value=await r.json();if(!r.ok)throw Error('RPC HTTP '+r.status+': '+JSON.stringify(value));return value})"
        if wait:
            value = self.evaluate(expression, timeout=40)
            # PostgREST represents RETURNS TABLE as a row array; the older SQL
            # fixture selected its single row directly. Preserve list RPCs.
            if isinstance(value, list) and name != 'list_incomplete_restore_groups_v5':
                assert len(value) == 1, ('single-row RPC', name, len(value))
                return value[0]
            return value
        return self.evaluate('window.upload='+expression+".catch(e=>({uncertain:true,code:e.code||e.name}));true")


def create_user(stack, index):
    email = f'acceptance-{index}-{secrets.token_hex(6)}@example.invalid'
    password = secrets.token_urlsafe(24)
    code, user = stack.request('/auth/v1/admin/users',
        {'email': email, 'password': password, 'email_confirm': True}, token=stack.service)
    assert code in (200, 201), ('synthetic user creation', code)
    code, session = stack.request('/auth/v1/token?grant_type=password', {'email': email, 'password': password})
    assert code == 200 and session['user']['id'] == user['id'], ('real password grant', code, session.get('error_code'))
    return {'id': user['id'], 'email': email, 'password': password, 'token': session['access_token']}


def head(stack, user, table, document):
    code, rows = stack.request('/rest/v1/'+table+'?document_name=eq.'+document+'&select=state,revision', token=user['token'])
    assert code == 200 and len(rows) == 1, ('PostgREST head', code, len(rows))
    return rows[0]


def run_app(stack, app, owner, foreign):
    table = 'order_management_documents' if app == 'orders' else 'kupa_documents'
    document = 'suppliers' if app == 'orders' else 'main'
    rpc = 'save_order_management_document_v6' if app == 'orders' else 'save_kupa_document_v6'
    def body(flight):
        return {'p_document_name': document, 'p_expected_revision': flight['baseRevision'],
                'p_state': flight['snapshot'], 'p_operation_id': flight['operationId'],
                'p_delete_intents': {}, 'p_audit': {}}
    with StackBrowser(stack, app, 'A') as a, StackBrowser(stack, app, 'B') as b:
        assert a.auth(owner['email'], owner['password'])['owner'] == owner['id']
        assert b.auth(owner['email'], owner['password'])['owner'] == owner['id']
        first = a.setup(True)
        assert b.setup(True)['state'] == first['state']
        base = first['cloud']['base']['state']
        seed = {'p_document_name': document, 'p_expected_revision': 0, 'p_state': base,
                'p_operation_id': app+'-seed', 'p_delete_intents': {}, 'p_audit': {}}
        assert a.rpc(rpc, seed)['revision'] == 1
        # Same revision-10 fixture used by the existing real two-profile suite.
        stack.sql(f"update public.{table} set revision=10 where owner_id='{owner['id']}' and document_name='{document}';")
        code, _ = stack.request('/rest/v1/rpc/'+rpc, {**seed, 'p_operation_id': app+'-foreign-seed'}, token=foreign['token'])
        assert code == 200
        foreign_before = head(stack, foreign, table, document)
        # Direct API probes cannot reveal or modify the other owner's document.
        code, rows = stack.request('/rest/v1/'+table+f"?owner_id=eq.{owner['id']}&select=*", token=foreign['token'])
        assert code == 200 and rows == []
        code, _ = stack.request('/rest/v1/'+table+f"?owner_id=eq.{owner['id']}", {'state': {'forged': True}},
                                token=foreign['token'], method='PATCH')
        assert code in (200, 204, 401, 403)  # RLS may hide rows rather than raise.
        assert head(stack, owner, table, document) == {'state': base, 'revision': 10}
        code, _ = stack.request('/rest/v1/rpc/'+rpc, seed)
        assert code in (401, 403)
        # Shared Checks use a separate real head, preserved throughout Main sync.
        shared = {'version': 1, 'checks': [], 'bankEvents': []}
        if app == 'orders':
            assert a.rpc('save_shared_checks_document_v6', {'p_document_name': 'main', 'p_expected_revision': 0,
                'p_state': shared, 'p_operation_id': 'shared-seed', 'p_audit': {}, 'p_deleted_check_ids': []})['revision'] == 1
        shared_before = head(stack, owner, 'shared_checks_documents', 'main')
        a.call('Network.enable')
        offline = {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}
        assert 'error' not in a.call('Network.emulateNetworkConditions', offline)
        flight_a = a.evaluate('rapid.burst("A",5)')['flight']
        a.rpc(rpc, body(flight_a), wait=False)
        assert a.evaluate('upload', timeout=40)['uncertain']
        assert head(stack, owner, table, document)['revision'] == 10
        a.call('Network.emulateNetworkConditions', {**offline, 'offline': False})
        # A real HTTP 503 is injected at the transport boundary, before send.
        # The pending operation remains intact; no fake RPC receipt is provided.
        a.restart_process()
        assert a.auth()['owner'] == owner['id']
        assert a.setup()['cloud']['flight'] == flight_a
        a.call('Fetch.enable', {'patterns': [{'urlPattern': '*rest/v1/rpc/'+rpc, 'requestStage': 'Request'}]})
        a.rpc(rpc, body(flight_a), wait=False)
        paused = wait_pause(a)
        a.call('Fetch.fulfillRequest', {'requestId': paused['requestId'], 'responseCode': 503,
            'responseHeaders': [{'name': 'Content-Type', 'value': 'application/json'},
                                {'name': 'Access-Control-Allow-Origin', 'value': '*'}],
            'body': 'eyJtZXNzYWdlIjoic3ludGhldGljIHRyYW5zcG9ydCBmYWlsdXJlIn0='})
        assert a.evaluate('upload', timeout=40)['uncertain']
        assert a.evaluate('rapid.retry()') == flight_a
        a.restart_process()
        assert a.auth()['owner'] == owner['id']
        assert a.setup()['cloud']['flight'] == flight_a
        flight_b = b.evaluate('rapid.burst("B",5)')['flight']
        # Intercept the *response* after the actual GoTrue-authenticated
        # PostgREST transaction committed. Kill the owned browser before ACK.
        a.call('Fetch.enable', {'patterns': [{'urlPattern': '*rest/v1/rpc/'+rpc, 'requestStage': 'Response'}]})
        a.rpc(rpc, body(flight_a), wait=False)
        paused = wait_pause(a)
        assert paused['responseStatusCode'] == 200
        assert head(stack, owner, table, document)['revision'] == 11
        crash = a.restart_process(crash=True)
        assert a.auth()['owner'] == owner['id']
        assert a.setup()['cloud']['flight'] == flight_a
        merged = b.evaluate('rapid.reconcile('+js(head(stack, owner, table, document))+')')
        assert merged['conflicts'] == []
        receipt_b = b.rpc(rpc, body(merged['flight']))
        assert receipt_b['revision'] == 12
        b.evaluate('rapid.acknowledge('+js(merged['flight'])+',12)')
        receipt_a = a.rpc(rpc, body(a.evaluate('rapid.retry()')))
        assert receipt_a['operation_revision'] == 11 and receipt_a['revision'] == 12
        a.evaluate('rapid.acknowledge('+js(flight_a)+',11)')
        final = head(stack, owner, table, document)
        a.evaluate('rapid.adopt('+js(final)+')')
        snapshots = []
        for browser in (a, b):
            browser.restart_process()
            assert browser.auth()['owner'] == owner['id']
            current = browser.setup()
            assert current['state'] == final['state'] and current['cloud']['base']['revision'] == 12
            assert not current['cloud']['pending'] and current['cloud']['flight'] is None
            raw = browser.evaluate("(async()=>{const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const r=await createStorageJournalDb().load('rapid-profiles:"+app+"');return {checkpoint_seq:r.checkpoints.data.seq,journal_sequences:r.journal.map(x=>x.data.seq),metadata_seq:r.metadata.seq,base_checksum:r.bases.checksum,flight:r.flights}})()")
            assert raw['metadata_seq'] == current['seq'] and raw['flight'] is None
            snapshots.append({'state_sha256': digest(current['state']), 'revision': 12, 'persisted': raw})
        row = final['state']['transactions' if app == 'orders' else 'cash'][0]
        assert row['note'] == 'remote-5' and row['message' if app == 'orders' else 'description'] == 'local-5'
        assert len(final['state']['transactions' if app == 'orders' else 'cash']) == 1
        assert head(stack, foreign, table, document) == foreign_before
        assert head(stack, owner, 'shared_checks_documents', 'main') == shared_before
        # Actual token rotation, native session persistence and server logout.
        assert a.evaluate('''(async()=>{const before=sessionRead();const after=await (auth.refreshSession||auth.supaRefresh)();
          return before.refresh_token!==after.refresh_token&&before.user.id===after.user.id})()''', timeout=40)
        assert a.evaluate('''(async()=>{
          const session={...sessionRead(),access_token:'synthetic-invalid-access-token',expires_at:Math.floor(Date.now()/1000)+3600};
          (auth.saveSession||auth.storeSupaSession)(session,{refresh:true});
          const response=await request('''+js('/rest/v1/'+table+'?document_name=eq.'+document+'&select=revision')+''');
          return response.ok&&sessionRead().access_token!==session.access_token;
        })()''', timeout=40), 'native HTTP-401 refresh-and-retry did not recover'
        a.restart_process()
        assert a.auth()['owner'] == owner['id']
        assert a.evaluate('''(async()=>{const {supabaseConfig:c}=await import('./supabase/config.js');const s=sessionRead();
          const r=await fetch(c.url+'/auth/v1/logout',{method:'POST',headers:{apikey:c.publishableKey,Authorization:'Bearer '+s.access_token}});
          return r.ok})()''', timeout=40)
        assert a.evaluate('''(async()=>{try{await (auth.refreshSession||auth.supaRefresh)();return false}catch{return !sessionRead()}})()''', timeout=40)
        ledger = json.loads(stack.sql("select json_agg(r) from (select operation_id,applied_revision from netunim_internal.document_sync_operations "
            +f"where owner_id='{owner['id']}' and operation_id in ('{flight_a['operationId']}','{merged['flight']['operationId']}')) r;"))
        assert sorted(r['applied_revision'] for r in ledger) == [11, 12]
        return {'scenario': app+' native Auth + two profiles + real PostgREST', 'status': 'PASS',
                'offline': True, 'http_503': 'injected before send', 'lost_ack': 'real HTTP response withheld after DB commit',
                'hard_process_failure': crash['hard_process_failure'], 'restart_snapshots': snapshots,
                'operation_ledger': ledger, 'foreign_user_unchanged': True, 'shared_unchanged': True,
                'token_rotation_restart_logout': True, 'native_401_refresh_retry': True, 'financial_record_count': 1}


def wait_pause(browser):
    deadline = time.monotonic()+40
    while time.monotonic() < deadline:
        browser.call('Runtime.evaluate', {'expression': 'true'})
        for event in browser.events:
            if event.get('method') == 'Fetch.requestPaused':
                browser.events.remove(event)
                params = event['params']
                if params['request']['method'] != 'POST':
                    browser.call('Fetch.continueResponse' if 'responseStatusCode' in params else 'Fetch.continueRequest',
                                 {'requestId': params['requestId']})
                    continue
                return params
        time.sleep(.05)
    raise RuntimeError('the controlled HTTP interception did not pause')


def run_storage(stack, owner, foreign):
    with StackBrowser(stack, 'orders', 'storage') as browser:
        browser.auth(owner['email'], owner['password'])
        result = browser.evaluate('''(async()=>{
          const {createBankChequeImageStorage}=await import('./assets/js/shared/bank-cheque-images.js');
          const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
          const storage=createBankChequeImageStorage({supaFetch:request,ensureSession:()=>auth.ensureSession(),
            fetchBridgeImage:async()=>new Blob([bytes],{type:'image/png'})});
          const date=new Date().toISOString().slice(0,10),key='a'.repeat(64),transactions=[{date,checkDetails:{checkItems:[{imageFrontKey:key}]}}];
          const first=await storage.sync(transactions),second=await storage.sync(transactions);
          const blob=await storage.download(date,key),owned=await storage.listOwned(sessionRead().user.id);
          return {first,second,bytes:blob.size,expected:bytes.length,owned};
        })()''', timeout=60)
        assert result['first']['uploaded'] == 1 and result['second']['uploaded'] == 0, result
        assert result['bytes'] == result['expected'] and len(result['owned']) == 1
        path = result['owned'][0]['path']
        code, _ = stack.request('/storage/v1/object/bank-cheque-images/'+path, token=foreign['token'], raw=True)
        assert code in (400, 403, 404)
        code, rows = stack.request('/storage/v1/object/list/bank-cheque-images', {'prefix': owner['id']}, token=foreign['token'])
        assert code == 200 and rows == []
        foreign_target = path.replace('a'*64, 'b'*64)
        assert foreign_target != path
        code, _ = stack.request('/storage/v1/object/bank-cheque-images/'+foreign_target, b'forged', token=foreign['token'], content_type='image/png')
        assert code in (400, 403)
        # Deleting a hidden row may report an empty successful result. The owner
        # must still download its original object afterwards.
        stack.request('/storage/v1/object/bank-cheque-images', {'prefixes': [path]}, token=foreign['token'], method='DELETE')
        code, data = stack.request('/storage/v1/object/bank-cheque-images/'+path, token=owner['token'], raw=True)
        assert code == 200 and len(data) == result['expected']
        code, owned = stack.request('/storage/v1/object/list/bank-cheque-images', {'prefix': owner['id']}, token=owner['token'])
        assert code == 200 and len(owned) == 1
        return {'scenario': 'native cheque image module + real Storage/RLS', 'status': 'PASS',
                'image_source': 'synthetic PNG fixture; no Bridge/provider', 'object_path': path,
                'bytes': len(data), 'foreign_read_list_write_delete_denied': True, 'repeat_upload_deduplicated': True}


def run_restore(stack, owner, foreign):
    with StackBrowser(stack, 'orders', 'restore') as browser:
        browser.auth(owner['email'], owner['password'])
        before = head(stack, owner, 'order_management_documents', 'suppliers')
        shared_before = head(stack, owner, 'shared_checks_documents', 'main')
        restored = json.loads(json.dumps(before['state']))
        restored['transactions'][0]['note'] = 'restored synthetic backup'
        group = str(uuid.uuid4())
        payload = {'p_restore_group_id': group, 'p_app_site': 'orders', 'p_main_document_name': 'suppliers',
            'p_main_base_revision': before['revision'], 'p_main_state': restored, 'p_main_delete_intents': {},
            'p_checks_document_name': 'main', 'p_checks_base_revision': shared_before['revision'],
            'p_checks_state': shared_before['state'], 'p_checks_delete_ids': [],
            'p_main_operation_id': 'full-stack-restore-main', 'p_checks_operation_id': 'full-stack-restore-checks', 'p_audit': {}}
        browser.rpc('stage_restore_group_v6', payload)
        browser.restart_process(crash=True)
        assert browser.auth()['owner'] == owner['id']
        pending = browser.rpc('list_incomplete_restore_groups_v5', {})
        assert any(r['restore_group_id'] == group for r in pending)
        code, foreign_groups = stack.request('/rest/v1/rpc/list_incomplete_restore_groups_v5', {}, token=foreign['token'])
        assert code == 200 and all(r['restore_group_id'] != group for r in foreign_groups)
        code, _ = stack.request('/rest/v1/rpc/apply_restore_group_v6', {'p_restore_group_id': group}, token=foreign['token'])
        assert code >= 400
        browser.rpc('apply_restore_group_v6', {'p_restore_group_id': group})
        after = head(stack, owner, 'order_management_documents', 'suppliers')
        checks_after = head(stack, owner, 'shared_checks_documents', 'main')
        assert after['state'] == restored and after['revision'] == before['revision']+1
        browser.restart_process()
        assert browser.auth()['owner'] == owner['id']
        browser.rpc('apply_restore_group_v6', {'p_restore_group_id': group})
        assert head(stack, owner, 'order_management_documents', 'suppliers') == after
        assert head(stack, owner, 'shared_checks_documents', 'main') == checks_after
        assert browser.rpc('list_incomplete_restore_groups_v5', {}) == []
        return {'scenario': 'paired restore via real PostgREST, process restart and idempotent retry', 'status': 'PASS',
                'group': group, 'before_revision': before['revision'], 'after_revision': after['revision'],
                'main_sha256': digest(after['state']), 'shared_sha256': digest(checks_after['state']),
                'foreign_apply_denied': True, 'retry_did_not_increment': True}


def run_cron(stack, owner):
    catalog = json.loads(stack.sql("select json_agg(r) from (select jobname,schedule,command,active,username,database from cron.job order by jobname) r;"))
    expected = json.loads((ROOT/'supabase/retention-jobs.json').read_text(encoding='utf8'))
    # Validate production schedules, then execute each *original command* using
    # a separate temporary second-based schedule, observing real job_run_details.
    expected_jobs = expected['jobs'] if isinstance(expected, dict) else expected
    assert {r['jobname'] for r in catalog} == {r['jobname'] for r in expected_jobs}
    for actual in catalog:
        wanted = next(r for r in expected_jobs if r['jobname'] == actual['jobname'])
        assert all(actual[k] == wanted[k] for k in ('schedule', 'command', 'active', 'username', 'database'))
    stack.sql(f"""insert into public.order_management_periodic_backups(owner_id,document_name,revision,state,saved_at)
      values ('{owner['id']}','suppliers',1,'{{}}',now()-interval '400 days'),
             ('{owner['id']}','suppliers',2,'{{}}',now());
      insert into netunim_internal.document_sync_operations(owner_id,domain,document_name,operation_id,payload_sha256,applied_revision,created_at)
      select '{owner['id']}','orders','retention-fixture','old-'||i,repeat('a',64),i,now()-interval '800 days'+i*interval '1 second' from generate_series(1,101) i;""")
    runs = []
    for index, item in enumerate(catalog):
        name = stack.project+'-retention-'+str(index)
        command = item['command'].replace("'", "''")
        job = int(stack.sql(f"select cron.schedule('{name}','1 second','{command}');"))
        try:
            deadline = time.monotonic()+45
            while time.monotonic() < deadline:
                value = stack.sql(f"select coalesce(json_agg(r),'[]') from (select status,return_message from cron.job_run_details where jobid={job} and end_time is not null) r;")
                completed = json.loads(value)
                if completed:
                    assert all(r['status'] == 'succeeded' for r in completed), completed
                    runs.append({'original_job': item['jobname'], 'temporary_job_id': job, 'runs': completed})
                    break
                time.sleep(1)
            else:
                raise RuntimeError('real pg_cron execution was not observed')
        finally:
            stack.sql(f'select cron.unschedule({job});')
    assert stack.sql(f"select count(*) from public.order_management_periodic_backups where owner_id='{owner['id']}' and saved_at<now()-interval '365 days';") == '0'
    assert stack.sql("select count(*) from netunim_internal.document_sync_operations where document_name='retention-fixture';") == '100'
    assert stack.sql(f"select count(*) from public.order_management_periodic_backups where owner_id='{owner['id']}' and revision=2;") == '1'
    return {'scenario': 'real pg_cron retention schedules and timed executions', 'status': 'PASS',
            'catalog': catalog, 'executions': runs, 'expired_removed_recent_preserved': True}


def main():
    results = []
    try:
        with IsolatedSupabase() as stack:
            owner, foreign = create_user(stack, 1), create_user(stack, 2)
            for app in ('orders', 'kupa'):
                results.append(run_app(stack, app, owner, foreign))
                print('PASS', results[-1]['scenario'], flush=True)
            for run in (run_storage, run_restore):
                results.append(run(stack, owner, foreign))
                print('PASS', results[-1]['scenario'], flush=True)
            results.append(run_cron(stack, owner))
            results.append({'scenario': 'resource and destination attestation', 'status': 'PASS', **stack.evidence()})
    except Exception as error:
        write_evidence('full-supabase-stack', [*results, {'scenario': 'full service acceptance',
            'status': 'FAIL', 'error_type': type(error).__name__}])
        raise
    # Emit PASS only after scoped container/volume/profile cleanup succeeded.
    results.append({'scenario': 'scoped stack and browser cleanup', 'status': 'PASS'})
    write_evidence('full-supabase-stack', results)
    print('PASS full Supabase acceptance (real services; synthetic data only)', flush=True)


if __name__ == '__main__':
    main()
