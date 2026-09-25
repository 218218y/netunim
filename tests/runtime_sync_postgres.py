"""Browser V2 immutable flight and real PostgreSQL V6 after a lost ACK."""
import http.server
import json
import socket
import threading

from browser_harness import LegacyBrowserSession as BrowserSession, ROOT, _free_port, _RuntimeHTTPServer
from isolated_sync_postgres import IsolatedPostgres, OWNER, quote


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

            def do_POST(self):
                try:
                    body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
                    result = proxy.post(self.path.rsplit('/', 1)[-1], body)
                    if result is None:
                        self.close_connection = True
                        self.connection.shutdown(socket.SHUT_RDWR)
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
        owner = 'pg-v2-' + str(index)
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
        assert 'lost' in browser.evaluate('pgLost'), 'proxy did not withhold the first ACK'
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


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', type=int)
    args = parser.parse_args()
    cases = [('orders', False), ('kupa', False), ('orders', True), ('kupa', True)]
    with IsolatedPostgres(schema_files=sorted((ROOT / 'supabase/migrations').glob('*.sql'))) as database:
        for index, (app, shared) in enumerate(cases):
            if args.case is None or args.case == index:
                run(database, app, shared, index)
