"""Browser V2 immutable flight and real PostgreSQL V6 after a lost ACK."""
import http.server
import json
import socket
import threading
import hashlib
import urllib.parse

from browser_harness import BrowserSession, ROOT, _free_port, _RuntimeHTTPServer
from isolated_sync_postgres import IsolatedPostgres, OWNER, quote
from acceptance_safety import write_evidence


class FaultProxy:
    def __init__(self, db):
        self.db = db
        self.accepted = threading.Event()
        self.release = threading.Event()
        self.calls = []
        self.errors = []
        self.armed = True

    def post(self, name, body):
        lose = self.armed
        self.armed = False
        result = self.db.rpc(name, body)
        self.calls.append({'name': name, 'operation': body['p_operation_id'], 'result': result})
        if lose:
            self.accepted.set()
            if not self.release.wait(15):
                raise RuntimeError('fixture ACK release timed out')
            return None
        return result


class SyncBrowser(BrowserSession):
    def __init__(self, site, label, proxy):
        super().__init__(site, label)
        self.proxy = proxy

    def _start_server(self):
        directory = str(self.tmp / 'site')
        proxy = self.proxy

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=directory, **kwargs)

            def log_message(self, *args):
                pass

            def do_GET(self):
                parsed = urllib.parse.urlsplit(self.path)
                if parsed.path != '/fixture/head':
                    return super().do_GET()
                query = urllib.parse.parse_qs(parsed.query)
                data = json.dumps(proxy.db.head(query['table'][0], query['document'][0])).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                try:
                    body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
                    result = proxy.post(self.path.rsplit('/', 1)[-1], body)
                    if result is None:
                        # A bare connection reset can make Chrome transparently
                        # replay the POST and receive its idempotent receipt. Lose
                        # the ACK body after headers instead, so the caller must
                        # retain its immutable flight and explicitly reconcile.
                        self.close_connection = True
                        try:
                            self.send_response(200)
                            self.send_header('Content-Type', 'application/json')
                            self.send_header('Content-Length', '1')
                            self.end_headers()
                            self.wfile.flush()
                            self.connection.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass  # The hard-crash scenario already closed its client.
                        finally:
                            self.connection.close()
                        return
                    data = json.dumps(result, ensure_ascii=False).encode()
                    self.send_response(200)
                except Exception as error:
                    proxy.errors.append(str(error))
                    data = json.dumps({'message': str(error)}).encode()
                    self.send_response(422)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.httpd = _RuntimeHTTPServer(('127.0.0.1', _free_port()), Handler)
        self.http_thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.http_thread.start()
        self.url = f'http://127.0.0.1:{self.httpd.server_port}/index.html'


def js(source, **replacements):
    for key, value in replacements.items():
        source = source.replace('@@' + key + '@@', json.dumps(value, ensure_ascii=False))
    return source


def run(db, app, shared, index):
    db.sql('truncate public.order_management_documents,public.kupa_documents,'
           'public.shared_checks_documents,netunim_internal.document_sync_operations cascade;')
    proxy = FaultProxy(db)
    with SyncBrowser(ROOT / f'netunim-{app}/site', f'v2-pg-ack-{index}', proxy) as browser:
        initial = browser.evaluate("normalizeState({businessName:'fixture',notes:[{id:'X',content:'base'},"
                                   "{id:'Y',content:'other'}],checks:[{id:'X',amount:10,name:'base'},"
                                   "{id:'Y',amount:20,name:'other'}]})")
        if shared:
            table, document, rpc, collection, field = (
                'shared_checks_documents', 'main', 'save_shared_checks_document_v6', 'checks', 'amount')
            state = {'version': 1, 'checks': initial['checks'], 'bankEvents': []}
            intents = {'p_deleted_check_ids': []}
            first_value, second_value = 11, 99
        else:
            table = 'order_management_documents' if app == 'orders' else 'kupa_documents'
            document = 'suppliers' if app == 'orders' else 'main'
            rpc = 'save_order_management_document_v6' if app == 'orders' else 'save_kupa_document_v6'
            collection, field = 'notes', 'content'
            prepare = 'prepareCloudState' if app == 'orders' else 'prepareKupaCloudState'
            state = browser.evaluate(prepare + '(' + json.dumps(initial) + ')')
            intents = {'p_delete_intents': {}}
            first_value, second_value = 'A', 'B'

        seed = {'p_document_name': document, 'p_expected_revision': 0, 'p_state': state,
                'p_operation_id': 'fixture-seed', 'p_audit': {}, **intents}
        assert db.rpc(rpc, seed)['revision'] == 1
        db.sql('update public.' + table + ' set revision=10 where owner_id=' +
               quote(OWNER) + ' and document_name=' + quote(document))
        owner = 'pg-v2-' + str(index) + ':' + ('shared-checks' if shared else app)
        setup = js("""(async()=>{
          const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
          window.pgJournal=createStorageJournal({owner:@@owner@@,
            schema:{collections:[@@collection@@],fields:[]},
            validate:value=>{if(!Array.isArray(value[@@collection@@]))throw Error('invalid_fixture_state')}});
          await pgJournal.install(@@state@@);
          await pgJournal.setCloudBase(10,@@state@@,{ackSeq:0});
          return true;
        })()""", owner=owner, collection=collection, state=state)
        assert browser.evaluate(setup)
        start = js("""(async()=>{
          const record={...@@state@@[@@collection@@][0],[@@field@@]:@@first@@};
          const write=pgJournal.append([{type:'put',collection:@@collection@@,mode:'replace',id:record.id,record}]);
          await write.committed;
          window.pgFlight=await pgJournal.materializeFlight({operationId:@@operation@@,baseRevision:10});
          const body={p_document_name:@@document@@,p_expected_revision:10,p_state:pgFlight.snapshot,
            p_operation_id:pgFlight.operationId,p_audit:{},...@@intents@@};
          window.pgLost=fetch('/rest/v1/rpc/'+@@rpc@@,{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body)}).then(r=>r.json()).catch(error=>({lost:String(error)}));
          return {operationId:pgFlight.operationId,snapshot:pgFlight.snapshot};
        })()""", state=state, collection=collection, field=field, first=first_value,
                   operation='flight-A-' + str(index), document=document, intents=intents, rpc=rpc)
        flight = browser.evaluate(start)
        assert proxy.accepted.wait(10), ('A did not reach PostgreSQL', proxy.errors)
        accepted = db.head(table, document)
        assert accepted['revision'] == 11
        second = accepted['state']
        second[collection][1][field] = second_value
        assert db.rpc(rpc, {'p_document_name': document, 'p_expected_revision': 11,
                            'p_state': second, 'p_operation_id': 'fixture-B-' + str(index),
                            'p_audit': {}, **intents})['revision'] == 12
        proxy.release.set()
        lost = browser.evaluate('pgLost')
        assert 'lost' in lost, {'message': 'proxy did not withhold the first ACK', 'response': lost,
                                'calls': [{'operation': call['operation'], 'revision': call['result'].get('revision')} for call in proxy.calls],
                                'errors': proxy.errors}
        browser._navigate()
        resume = js("""(async()=>{
          const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
          window.pgJournal=createStorageJournal({owner:@@owner@@,
            schema:{collections:[@@collection@@],fields:[]},
            validate:value=>{if(!Array.isArray(value[@@collection@@]))throw Error('invalid_fixture_state')}});
          await pgJournal.open();
          const retry=await pgJournal.materializeFlight({operationId:'must-not-replace',baseRevision:10});
          const body={p_document_name:@@document@@,p_expected_revision:10,p_state:retry.snapshot,
            p_operation_id:retry.operationId,p_audit:{},...@@intents@@};
          const response=await fetch('/rest/v1/rpc/'+@@rpc@@,{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body)});
          if(!response.ok)throw Error('retry_http_'+response.status);
          const row=await response.json();
          await pgJournal.acknowledge(retry.operationId,row.operation_revision,retry.snapshot);
          return {retry,row,base:(await pgJournal.cloudState()).base.revision};
        })()""", owner=owner, collection=collection, document=document, intents=intents, rpc=rpc)
        result = browser.evaluate(resume)
        assert result['retry']['operationId'] == flight['operationId']
        assert result['retry']['snapshot'] == flight['snapshot']
        assert result['row']['operation_replayed'] and result['row']['operation_revision'] == 11
        assert result['row']['revision'] == 12 and result['base'] == 11
        assert db.head(table, document)['state'][collection][1][field] == second_value
        assert [call['operation'] for call in proxy.calls] == [flight['operationId'], flight['operationId']]
        print('PASS V2 browser/real PostgreSQL immutable lost ACK', app,
              'Shared Checks' if shared else 'Main', flush=True)


def run_two_profiles(db, app):
    """Actual HTTP/SQL, business merge and hard browser-process failure.

    The relay supplies only transport/fault injection. Production journals,
    normalization, validation and three-way merge execute in real Chromium.
    """
    db.sql('truncate public.order_management_documents,public.kupa_documents,'
           'public.shared_checks_documents,netunim_internal.document_sync_operations cascade;')
    proxy = FaultProxy(db)
    proxy.armed = False
    fixture = (ROOT/'tests/fixtures/rapid-profile-fields.mjs').read_text(encoding='utf8').replace('export async function', 'async function')
    def setup(browser, initialize=False):
        return browser.evaluate('(async()=>{'+fixture+';window.rapid=await createRapidProfile('
                                +json.dumps(app)+','+str(initialize).lower()+');return rapid.state()})()')
    table = 'order_management_documents' if app == 'orders' else 'kupa_documents'
    document = 'suppliers' if app == 'orders' else 'main'
    rpc = 'save_order_management_document_v6' if app == 'orders' else 'save_kupa_document_v6'
    def body(flight):
        return {'p_document_name': document, 'p_expected_revision': flight['baseRevision'],
                'p_state': flight['snapshot'], 'p_operation_id': flight['operationId'],
                'p_audit': {}, 'p_delete_intents': {}}
    def upload(browser, flight, *, wait=True):
        request = "fetch('/rest/v1/rpc/"+rpc+"',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify("+json.dumps(body(flight))+" )}).then(async r=>{const row=await r.json();if(!r.ok)throw Error(JSON.stringify(row));return row})"
        if wait:
            return browser.evaluate(request)
        return browser.evaluate('window.acceptanceRequest='+request+'.catch(e=>({lost:String(e)}));true')
    def head(browser):
        return browser.evaluate("fetch('/fixture/head?table="+table+'&document='+document+"').then(r=>r.json())")
    def digest(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    with SyncBrowser(ROOT/f'netunim-{app}/site', app+'-pg-two-A', proxy) as a, \
         SyncBrowser(ROOT/f'netunim-{app}/site', app+'-pg-two-B', proxy) as b:
        first = setup(a, True)
        assert setup(b, True)['state'] == first['state']
        base = first['cloud']['base']['state']
        seed = {'p_document_name': document, 'p_expected_revision': 0, 'p_state': base,
                'p_operation_id': 'two-profile-seed', 'p_audit': {}, 'p_delete_intents': {}}
        assert db.rpc(rpc, seed)['revision'] == 1
        db.sql('update public.'+table+' set revision=10 where owner_id='+quote(OWNER)+' and document_name='+quote(document))
        shared = {'version': 1, 'checks': [], 'bankEvents': []}
        db.rpc('save_shared_checks_document_v6', {'p_document_name': 'main', 'p_expected_revision': 0,
               'p_state': shared, 'p_operation_id': 'separate-shared', 'p_audit': {}, 'p_deleted_check_ids': []})
        shared_before = db.head('shared_checks_documents', 'main')

        # Actual browser offline transport fails, but its durable business edits
        # and immutable flight survive. B edits another field in the same record.
        a.call('Network.enable')
        offline = {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}
        assert 'error' not in a.call('Network.emulateNetworkConditions', offline)
        flight_a = a.evaluate('rapid.burst("A",5)')['flight']
        assert upload(a, flight_a, wait=False)
        assert 'lost' in a.evaluate('acceptanceRequest')
        assert proxy.calls == []
        assert a.evaluate('rapid.retry()') == flight_a
        a.call('Network.emulateNetworkConditions', {**offline, 'offline': False})
        flight_b = b.evaluate('rapid.burst("B",5)')['flight']

        proxy.armed = True
        upload(a, flight_a, wait=False)
        assert proxy.accepted.wait(10), proxy.errors
        assert db.head(table, document)['revision'] == 11
        crash = a.restart_process(crash=True)
        assert crash['previous_pid'] != crash['new_pid']
        after_crash = setup(a)
        assert after_crash['cloud']['flight'] == flight_a
        assert after_crash['cloud']['pending'] and after_crash['seq'] == 5
        merged = b.evaluate('rapid.reconcile('+json.dumps(head(b))+')')
        assert merged['conflicts'] == []
        receipt_b = upload(b, merged['flight'])
        assert receipt_b['revision'] == 12
        b.evaluate('rapid.acknowledge('+json.dumps(merged['flight'])+',12)')
        proxy.release.set()
        retry = a.evaluate('rapid.retry()')
        receipt_a = upload(a, retry)
        assert retry == flight_a
        assert receipt_a['operation_replayed'] and receipt_a['operation_revision'] == 11 and receipt_a['revision'] == 12
        a.evaluate('rapid.acknowledge('+json.dumps(retry)+',11)')
        final = head(a)
        a.evaluate('rapid.adopt('+json.dumps(final)+')')
        snapshots = []
        for browser in (a, b):
            browser.restart_process()
            current = setup(browser)
            assert current['state'] == final['state']
            assert current['cloud']['base']['revision'] == 12 and not current['cloud']['pending']
            assert current['cloud']['flight'] is None and current['cloud']['control'] is None
            row = current['state']['transactions' if app == 'orders' else 'cash'][0]
            assert row['note'] == 'remote-5'
            assert row['message' if app == 'orders' else 'description'] == 'local-5'
            snapshots.append({'seq': current['seq'], 'base': current['cloud']['base']['revision'], 'state_sha256': digest(current['state'])})
            raw = browser.evaluate("(async()=>{const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');const raw=await createStorageJournalDb().load('rapid-profiles:"+app+"');return {checkpoint_seq:raw.checkpoints.data.seq,journal_sequences:raw.journal.map(row=>row.data.seq),metadata_seq:raw.metadata.seq,base_checksum:raw.bases.checksum,flight:raw.flights}})()")
            assert raw['metadata_seq'] == current['seq'] and raw['flight'] is None
            snapshots[-1]['persisted'] = raw
        assert len(final['state']['transactions' if app == 'orders' else 'cash']) == 1
        assert db.head('shared_checks_documents', 'main') == shared_before
        operations = [call['operation'] for call in proxy.calls]
        assert operations.count(flight_a['operationId']) == 2
        assert operations.count(merged['flight']['operationId']) == 1
        ledger = json.loads(db.sql('select json_agg(r) from (select operation_id,applied_revision from netunim_internal.document_sync_operations where operation_id in ('
                                  +quote(flight_a['operationId'])+','+quote(merged['flight']['operationId'])+')) r').strip())
        assert sorted(row['applied_revision'] for row in ledger) == [11, 12], ledger

        # A genuine same-field conflict remains explicit across another process
        # restart; it must not silently publish either side as authority.
        local = a.evaluate('rapid.contradict("A")')
        remote = b.evaluate('rapid.contradict("B")')
        receipt = upload(b, remote)
        b.evaluate('rapid.acknowledge('+json.dumps(remote)+','+str(receipt['revision'])+')')
        conflict = a.evaluate('rapid.reconcile('+json.dumps(head(a))+')')
        assert len(conflict['conflicts']) == 1
        a.restart_process(crash=True)
        retained = setup(a)
        assert retained['cloud']['pending'] and retained['cloud']['control']['conflict']['kind'] == 'entity-conflict'
        assert retained['state']['transactions' if app == 'orders' else 'cash'][0]['note'] == 'contradiction-A'
        assert head(a)['state']['transactions' if app == 'orders' else 'cash'][0]['note'] == 'contradiction-B'
        assert db.head('shared_checks_documents', 'main') == shared_before
        evidence = {'scenario': app+' two real browser profiles / real PostgreSQL', 'status': 'PASS',
                    'offline_transport': True, 'hard_process_failures': 2,
                    'lost_ack': {'operation_id': flight_a['operationId'], 'operation_revision': receipt_a['operation_revision'], 'observed_head': receipt_a['revision']},
                    'restart_snapshots': snapshots, 'durable_conflict': retained['cloud']['control']['conflict']['kind'],
                    'operation_ledger': ledger,
                    'shared_head_unchanged': True, 'financial_record_count': 1}
        print('PASS', app, 'two real profiles/SQL: offline, hard crash after remote commit, lost ACK replay, merge, restart convergence and durable conflict', flush=True)
        return evidence


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', type=int)
    parser.add_argument('--two-profiles-only', action='store_true')
    parser.add_argument('--app', choices=('orders', 'kupa'))
    args = parser.parse_args()
    cases = [('orders', False), ('kupa', False), ('orders', True), ('kupa', True)]
    with IsolatedPostgres(schema_files=sorted((ROOT / 'supabase/migrations').glob('*.sql'))) as database:
        results = []
        if not args.two_profiles_only:
            for index, (app, shared) in enumerate(cases):
                if args.case is None or args.case == index:
                    run(database, app, shared, index)
                    results.append({'scenario': app+(' Shared' if shared else ' Main')+' immutable lost ACK', 'status': 'PASS'})
        if args.case is None:
            for app in ([args.app] if args.app else ('orders', 'kupa')):
                results.append(run_two_profiles(database, app))
        write_evidence('browser-postgres', results)
