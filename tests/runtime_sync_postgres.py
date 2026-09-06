"""Real v5 RPC/ledger + isolated Chromium A/B lost-ACK matrix.
HTTP fault: commit A's request, withhold ACK, let B commit, close A's socket.
The browser transport retries the same operation, receiving the current DB head.
"""
import http.server
import json
import socket
import threading
from urllib.parse import urlparse, parse_qs
from browser_harness import BrowserSession, ROOT, _free_port
from isolated_sync_postgres import IsolatedPostgres, OWNER, quote

class FaultProxy:
    def __init__(self,db):
        self.db=db;self.accepted=threading.Event();self.release=threading.Event();self.armed=False;self.calls=[];self.errors=[];self.lock=threading.Lock()
    def post(self,name,body):
        with self.lock:
            lose=self.armed and name.startswith('save_')
            if lose:self.armed=False
        result=self.db.rpc(name,body)
        with self.lock:self.calls.append({'name':name,'operation':body.get('p_operation_id'),'result':result})
        if lose:
            self.accepted.set()
            if not self.release.wait(15):raise RuntimeError('fixture ACK release timed out')
            return None
        return result

class SyncBrowser(BrowserSession):
    def __init__(self,site,label,proxy):
        super().__init__(site,label);self.proxy=proxy
    def _prepare_site(self):
        super()._prepare_site()
        (self.tmp/'site/supabase/config.js').write_text("export const supabaseConfig=Object.freeze({url:location.origin,publishableKey:'fixture-only'});",encoding='utf8')
    def _start_server(self):
        directory=str(self.tmp/'site');proxy=self.proxy
        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self,*args,**kwargs):super().__init__(*args,directory=directory,**kwargs)
            def log_message(self,*args):pass
            def reply(self,value,status=200):
                data=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            def do_POST(self):
                try:
                    body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))));result=proxy.post(self.path.rsplit('/',1)[-1],body)
                    if result is None:
                        self.close_connection=True;self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                    self.reply(result)
                except Exception as exc:
                    message=str(exc);proxy.errors.append(message);self.reply({'code':'PT409' if 'revision_conflict' in message else 'PT422','message':message},409 if 'revision_conflict' in message else 422)
            def do_GET(self):
                if self.path.startswith('/rest/v1/'):
                    parsed=urlparse(self.path);table=parsed.path.rsplit('/',1)[-1];document=parse_qs(parsed.query).get('document_name',['eq.main'])[0].removeprefix('eq.')
                    try:row=proxy.db.head(table,document);self.reply([row] if row else [])
                    except ValueError:self.reply([])
                    return
                super().do_GET()
        self.httpd=http.server.ThreadingHTTPServer(('127.0.0.1',_free_port()),Handler)
        self.http_thread=threading.Thread(target=self.httpd.serve_forever,daemon=True);self.http_thread.start();self.url=f'http://127.0.0.1:{self.httpd.server_port}/index.html'

def run(db,app,checks,same,index):
    # Each scenario resets business rows and the ledger only in this disposable cluster.
    db.sql('truncate public.order_management_documents,public.kupa_documents,public.shared_checks_documents,public.finance_sync_documents,netunim_internal.document_sync_operations cascade;')
    proxy=FaultProxy(db)
    with SyncBrowser(ROOT/f'netunim-{app}/site',f'{app}-ack-A-{index}',proxy) as a, SyncBrowser(ROOT/f'netunim-{app}/site',f'{app}-ack-B-{index}',proxy) as b:
        prepare='prepareCloudState' if app=='orders' else 'prepareKupaCloudState'
        initial=a.evaluate("normalizeState({businessName:'fixture',notes:[{id:'X',content:'base'},{id:'Y',content:'other'}],checks:[{id:'X',amount:10,name:'base'},{id:'Y',amount:20,name:'other'}]})")
        if checks:
            table='shared_checks_documents';doc='main';rpc='save_shared_checks_document_v5';state={'version':1,'checks':initial['checks'],'bankEvents':[]};extra={'p_deleted_check_ids':[]}
        else:
            table='order_management_documents' if app=='orders' else 'kupa_documents';doc='suppliers' if app=='orders' else 'main';rpc='save_order_management_document_v5' if app=='orders' else 'save_kupa_document_v5';state=a.evaluate(prepare+'('+json.dumps(initial)+')');extra={'p_delete_intents':{}}
        db.rpc(rpc,{'p_document_name':doc,'p_expected_revision':0,'p_state':state,'p_operation_id':'fixture-seed','p_audit':{},**extra})
        db.sql('update public.'+table+' set revision=10 where owner_id='+quote(OWNER)+' and document_name='+quote(doc))
        for browser in (a,b):
            setup="state=normalizeState("+json.dumps(initial)+");primaryTab=true;reportError=()=>{};Object.defineProperty(navigator,'onLine',{value:true,configurable:true});"
            if app=='orders':setup+="saveSession({access_token:'fixture',expires_at:9999999999});localStorage.setItem(CLOUD_AUTO_KEY,'1');cloudRevision=10;lastCloudState=prepareCloudState(state);cloudConflictBlocked=false;cloudSaveRequested=false;checksCloudRevision=10;checksCloudBase=clone(state.checks);"
            else:setup+="storeSupaSession({access_token:'fixture',expires_at:9999999999});connectionMode='supabase';backendReady=true;dbRevision=10;lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(state));sharedChecksRevision=10;sharedChecksBase=clone(state.checks);cloudConflictPending=false;"
            browser.evaluate('(()=>{'+setup+'return true})()')
        proxy.armed=True
        if checks:
            field='amount';collection='checks';n=11;newer=15;other=99
            generation='checksGeneration' if app=='orders' else 'sharedChecksGeneration';mark='markChecksPending' if app=='orders' else 'markSharedChecksPending';get='getChecksPending' if app=='orders' else 'getSharedChecksPending'
            stage=f"{generation}++;{mark}(state.checks);"
            save='saveSharedChecksToCloud(\'\')'
        else:
            field='content';collection='notes';n='N';newer='N+1';other='B';get='getCloudPending'
            if app=='orders':stage="localGeneration++;markCloudPending(prepareCloudState(state));";save="requestCloudSave('')"
            else:stage="localGeneration++;stageCloudPendingLocal(prepareKupaCloudState(state),'',dbRevision,lastSavedCloudState(),localGeneration);";save="persistSupabaseState(prepareKupaCloudState(state),'',localGeneration)"
        a.evaluate(f"(()=>{{state.{collection}[0].{field}={json.dumps(n)};{stage}window.ackRun={save};window.ackRun.catch(e=>window.ackError=String(e));return true}})()")
        assert proxy.accepted.wait(10),('A did not reach PostgreSQL',proxy.errors,a.evaluate("({errors:window.ackError,storage:{...localStorage},session:loadSession(),checksSession,online:navigator.onLine})"))
        accepted=db.head(table,doc);assert accepted['revision']==11
        a.evaluate(f"(async()=>{{state.{collection}[0].{field}={json.dumps(newer)};{stage}return !!(await {get}())}})()")
        # B reads the committed head, then writes independently in its own browser.
        remote=accepted['state'];remote[collection][0 if same else 1][field]=other
        if checks:bsave='rpcSaveSharedChecks('+json.dumps(remote['checks'])+",11,'fixture-B',[],{})"
        else:bsave=('rpcSave' if app=='orders' else 'rpcSaveCloud')+'('+json.dumps(remote)+",11,'fixture-B',{}, {})"
        result=b.evaluate('(async()=>{const result=await '+bsave+';return result.row})()');assert result['revision']==12,result
        proxy.release.set()
        done=a.evaluate(f"(async()=>{{const ok=await window.ackRun;return {{ok,pending:await {get}()}}}})()",timeout=20)
        head=db.head(table,doc)
        replay=[c for c in proxy.calls if c['result'].get('operation_replayed')]
        assert replay and replay[0]['result']['operation_revision']==11 and replay[0]['result']['revision']==12,proxy.calls
        if same:
            assert head['revision']==12 and head['state'][collection][0][field]==other,(head,done)
            assert done['pending']['conflict']['items'][0]['baseRevision']==11,done
            assert done['pending']['snapshot'][0][field]==newer if checks else done['pending']['snapshot'][collection][0][field]==newer
            # A fresh storage reader still sees the conflict; another save cannot issue a write.
            before=len(proxy.calls);a.evaluate('(async()=>{await '+save+';return true})()');assert len(proxy.calls)==before
        else:
            # Kupa schedules the next poll; explicitly join that pending generation.
            if not checks and app=='kupa' and done['pending']:
                a.evaluate("(async()=>{await reconcileCloudPending();return true})()")
                head=db.head(table,doc)
            assert head['state'][collection][0][field]==newer and head['state'][collection][1][field]==other,(head,done)
        print('PASS real PostgreSQL/HTTP lost-ACK',app,'checks' if checks else 'document','conflict' if same else 'disjoint merge',flush=True)

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--case',type=int);args=parser.parse_args()
    with IsolatedPostgres() as db:
        db.sql((ROOT/'tests/finance_fencing_server.sql').read_text(encoding='utf8'))
        for index,(app,checks,same) in enumerate((a,c,s) for a in ('orders','kupa') for c in (False,True) for s in (True,False)):
            if args.case is None or args.case==index:run(db,app,checks,same,index)
