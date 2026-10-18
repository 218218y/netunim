"""Independent browser profiles, real IDB outbox and HTTP incident registry.
The fixture registry tests transport/UI; PostgreSQL semantics have their own suite.
"""
import http.server
import json
import threading
from browser_harness import BrowserSession, ROOT, _free_port, _RuntimeHTTPServer

OWNER='11111111-1111-4111-8111-111111111111'


class Registry:
    def __init__(self):
        self.rows={}
        self.lock=threading.Lock()

    def call(self, name, body):
        with self.lock:
            if name=='list_active_sync_incidents_v1':
                return [row for row in self.rows.values() if row['resolved_at'] is None]
            if name=='mark_sync_incident_reviewed_v1':
                row=self.rows[body['p_incident_id']]
                assert row['report_version']==body['p_expected_report_version']
                row.update(resolved_at='2026-10-18T11:00:00Z',resolution_kind='operator_reviewed_unverified')
                return row
            value=body['p_incident']
            row=self.rows.get(value['incident_id'])
            if row is None or row['resolved_at'] is None and row['report_version']<value['report_version']:
                row={**value,'owner_id':OWNER,'first_reported_at':'2026-10-18T10:00:00Z','last_reported_at':'2026-10-18T10:00:00Z',
                     'resolved_at':None,'resolution_kind':None}
                if name=='resolve_sync_incident_v1':
                    row.update(resolved_at='2026-10-18T11:00:00Z',resolution_kind='clean_verified')
                self.rows[value['incident_id']]=row
            return row


class IncidentBrowser(BrowserSession):
    def __init__(self, app, registry):
        super().__init__(ROOT/f'netunim-{app}/site',app+'-sync-incidents',instrument=False)
        self.registry=registry

    def _start_server(self):
        registry=self.registry
        directory=str(self.tmp/'site')

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self,*args,**kwargs):
                super().__init__(*args,directory=directory,**kwargs)

            def log_message(self,*args):
                pass

            def do_POST(self):
                try:
                    body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
                    data=json.dumps(registry.call(self.path.rsplit('/',1)[-1],body)).encode()
                    self.send_response(200)
                except Exception as error:
                    data=json.dumps({'error':str(error)}).encode()
                    self.send_response(422)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.httpd=_RuntimeHTTPServer(('127.0.0.1',_free_port()),Handler)
        self.http_thread=threading.Thread(target=self.httpd.serve_forever,daemon=True)
        self.http_thread.start()
        self.url=f'http://127.0.0.1:{self.httpd.server_port}/index.html'


SETUP=r"""(async()=>{
  await (await import('./assets/js/main.js')).appReady;
  const {createSyncIncidentStore}=await import('./assets/js/shared/sync-incident-store.js');
  const {createSyncIncidentRegistry}=await import('./assets/js/shared/sync-incident-registry.js');
  const {createSyncIncidentMonitor}=await import('./assets/js/shared/sync-incident-monitor.js');
  const {createSyncIncidentUi}=await import('./assets/js/shared/sync-incident-ui.js');
  const site=__APP__;
  let time=0;
  globalThis.incidentSample={known:true,pending:true,blocked:true,conflict:true,epoch:'test-E',evidence:'journal',isCurrent:()=>true};
  const store=createSyncIncidentStore(),scope=()=>({owner:'11111111-1111-4111-8111-111111111111',epoch:1});
  const registry=createSyncIncidentRegistry({request:(path,options)=>fetch(path,options),accountScope:scope});
  const ui=createSyncIncidentUi({clientId:site+'-client',label:()=>site==='orders'?'Office':'Cash desk',saveLabel:()=>{},refresh:()=>monitor.wake(),review:row=>monitor.review(row),confirm:()=>true});
  const monitor=createSyncIncidentMonitor({site,clientId:site+'-client',deviceLabel:()=>site==='orders'?'Office':'Cash desk',accountScope:scope,primary:()=>true,
    domains:[{domain:site+'_main',read:async()=>globalThis.incidentSample}],store,registry,publish:state=>ui.update(state),now:()=>time,
    timers:{setTimeout:()=>0,clearTimeout:()=>{}}});
  globalThis.incidentFixture={monitor,store,registry,scope,ui,advance:ms=>{time+=ms}};
  await monitor.start();
  return monitor.view;
})()"""


def run():
    registry=Registry()
    with IncidentBrowser('orders',registry) as orders, IncidentBrowser('kupa',registry) as kupa:
        first=orders.evaluate(SETUP.replace('__APP__',json.dumps('orders')))
        first_id=first['incidents'][0]['incident_id']
        assert len(first['incidents'])==1
        second=kupa.evaluate(SETUP.replace('__APP__',json.dumps('kupa')))
        assert len(second['incidents'])==2
        assert kupa.evaluate("document.querySelectorAll('.sync-incidents')[1].textContent.includes('Office')")
        orders.evaluate('incidentFixture.monitor.stop();incidentFixture.ui.dispose();true')
        orders._navigate()
        restored=orders.evaluate(SETUP.replace('__APP__',json.dumps('orders')))
        assert any(row['incident_id']==first_id for row in restored['incidents'])
        assert len(registry.rows)==2, 'reload must reuse durable identity'
        # Native IDB serializes concurrent intents and receipts from two owners.
        assert orders.evaluate("""(async()=>{
          const {createSyncIncidentStore}=await import('./assets/js/shared/sync-incident-store.js');
          const other=createSyncIncidentStore();
          await Promise.all(Array.from({length:12},(_,n)=>(n%2?other:incidentFixture.store).update('atomic',v=>({...v,count:(v.count||0)+1}))));
          return (await other.update('atomic',v=>v)).count===12;
        })()""")
        # Closing UI does not resolve. A clean main closes only this profile's domain.
        assert kupa.evaluate("""(()=>{const f=incidentFixture;f.ui.open();const root=document.querySelectorAll('.sync-incidents')[1];root.querySelector('[data-incident-action=toggle]').click();return f.monitor.view.incidents.length===2})()""")
        resolved=orders.evaluate("""(async()=>{incidentSample={known:true,pending:false,verified:true,epoch:'test-E',evidence:'journal',isCurrent:()=>true};await incidentFixture.monitor.tick();return incidentFixture.monitor.view})()""")
        assert len(resolved['incidents'])==1 and resolved['incidents'][0]['site']=='kupa'
        assert len(kupa.evaluate('(async()=>{await incidentFixture.monitor.wake();return incidentFixture.monitor.view.incidents})()'))==1
        # A closed sheet's durable draft must be detected without opening its UI.
        assert orders.evaluate("""(async()=>{
          const {createSpreadsheetSync}=await import('./assets/js/shared/spreadsheet-sync.js');
          const {createSpreadsheetStore}=await import('./assets/js/shared/spreadsheet-store.js');
          const {createDefaultNotesSheet}=await import('./assets/js/shared/notes-sheet-model.js');
          const store=createSpreadsheetStore(),owner=incidentFixture.scope().owner,key=owner+':orders:main',base=createDefaultNotesSheet();
          await store.commit(key,{version:1,base,working:base,revision:1,flight:null,conflict:null});
          await store.journal(key,[{rowId:'R',columnId:'C',value:'pending'}]);
          const sync=createSpreadsheetSync({domain:'orders',account:()=>owner,enabled:()=>true,store});
          const sample=await sync.incidentSample();
          return sample.pending===true&&sync.status==='unloaded';
        })()""")
        assert not orders.drain_serious_errors()
        assert not kupa.drain_serious_errors()
    print('PASS independent orders/kupa profiles: cross-site warnings, durable reload, native IDB races, domain ACK isolation, UI acknowledgement and closed-sheet detection')


if __name__=='__main__':
    run()
