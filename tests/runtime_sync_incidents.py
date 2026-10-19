"""Independent browser profiles, real IDB outbox and HTTP incident registry.
The fixture registry tests transport/UI; PostgreSQL semantics have their own suite.
"""
import http.server
import json
import threading
import sys
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
        super().__init__(ROOT/f'netunim-{app}/site',app+'-sync-incidents',instrument=False,native_incidents=True)
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
  const ui=createSyncIncidentUi({clientId:site+'-client',label:()=>site==='orders'?'Office':'Cash desk',saveLabel:()=>{},refresh:()=>monitor.wake(),review:row=>monitor.review(row),confirmReview:()=>true});
  const monitor=createSyncIncidentMonitor({site,clientId:site+'-client',deviceLabel:()=>site==='orders'?'Office':'Cash desk',accountScope:scope,primary:()=>true,
    domains:[{domain:site+'_main',read:async()=>globalThis.incidentSample}],store,registry,publish:state=>ui.update(state),now:()=>time,
    timers:{setTimeout:()=>0,clearTimeout:()=>{}}});
  globalThis.incidentFixture={monitor,store,registry,scope,ui,advance:ms=>{time+=ms}};
  await monitor.start();
  return monitor.view;
})()"""


def check_visibility_and_settings(browser, app):
    assert browser.evaluate("""(async()=>{
      await (await import('./assets/js/main.js')).appReady;
      const {createSyncIncidentUi}=await import('./assets/js/shared/sync-incident-ui.js');
      let name='Office',refreshes=0;
      const healthy={status:'no_reported_incidents',incidents:[],localError:false};
      const ui=createSyncIncidentUi({clientId:'test',label:()=>name,saveLabel:value=>{name=value},refresh:async()=>{refreshes++}});
      const root=document.querySelector('.sync-incidents:last-child'),check=(ok,message)=>{if(!ok)throw Error(message)};
      try{
        ui.update(healthy);check(root.hidden,'named healthy device must not have a floating control');
        name='';ui.update(healthy);check(!root.hidden,'unnamed device needs a naming prompt');
        ui.open();root.querySelector('[data-incident-label]').value='Office';
        root.querySelector('[data-incident-action=label]').click();await Promise.resolve();await Promise.resolve();
        check(name==='Office'&&root.hidden,'saving the name must immediately hide the healthy control');
        ui.update({...healthy,status:'unavailable'});check(!root.hidden,'monitor read errors must remain visible');
        ui.update({...healthy,localError:true});check(!root.hidden,'report errors must remain visible');
        ui.open();ui.update(healthy);check(root.hidden,'recovery hides even an opened floating control');
        ui.update({...healthy,status:'signed_out'});check(root.hidden,'signed out floating control stays hidden');
        check(refreshes===1,'naming must not duplicate refresh requests');
      }finally{ui.dispose()}
      const container=document.createElement('div');document.body.append(container);
      const settings=createSyncIncidentUi({container,inline:true,clientId:'test',label:()=>name,saveLabel:value=>{name=value},refresh:async()=>{}});
      try{
        settings.update({...healthy,status:'signed_out'});check(!container.firstChild.hidden,'settings remain available before login');
        const input=container.querySelector('[data-incident-label]');name='Updated office';settings.update(healthy);
        check(input.value===name,'an unchanged input follows the saved device name');
        input.value='Unsaved draft';input.focus();input.setSelectionRange(2,6);settings.update({...healthy,localError:true});
        check(container.querySelector('[data-incident-label]')===input&&input.value==='Unsaved draft'&&document.activeElement===input&&input.selectionStart===2&&input.selectionEnd===6,'polling must preserve the inline draft, focus and caret');
      }finally{settings.dispose();container.remove()}
      return true;
    })()""")
    selector = '[data-view="settings"]' if app == 'orders' else '[data-page="settings"]'
    assert browser.evaluate("""(async()=>{
      document.querySelector(__SELECTOR__).click();
      for(let n=0;n<100&&!document.querySelector('[data-sync-incident-settings] .sync-incidents');n++)await new Promise(resolve=>setTimeout(resolve,20));
      const root=document.querySelector('[data-sync-incident-settings] .sync-incidents');
      if(!root||root.hidden||getComputedStyle(root).position==='fixed')throw Error('settings must contain the inline device controls');
      const input=root.querySelector('[data-incident-label]');input.value='Settings office';root.querySelector('[data-incident-action=label]').click();
      await Promise.resolve();
      return localStorage.getItem('netunim.sync.device-label.v1')==='Settings office'&&!root.hidden;
    })()""".replace('__SELECTOR__', json.dumps(selector)))


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
        # A queued resolve must re-read native IDB inside the network slot.
        # Exercise every durable path without opening the sheet UI.
        assert orders.evaluate("""(async()=>{
          const {createSpreadsheetSync}=await import('./assets/js/shared/spreadsheet-sync.js');
          const {createSpreadsheetStore}=await import('./assets/js/shared/spreadsheet-store.js');
          const {createDefaultNotesSheet}=await import('./assets/js/shared/notes-sheet-model.js');
          const {createCloudAuth}=await import('./assets/js/cloud/auth.js?sheet-confirmation');
          const {createSyncIncidentRegistry}=await import('./assets/js/shared/sync-incident-registry.js');
          const owner=incidentFixture.scope().owner,key=owner+':orders:main',base=createDefaultNotesSheet();
          const store=createSpreadsheetStore(),writer=createSpreadsheetStore(),record={version:1,base,working:base,revision:1,flight:null,conflict:null};
          const auth=createCloudAuth({}),fetchBefore=globalThis.fetch;
          // Match the real site's session key, without depending on its literal spelling.
          auth.saveSession({user:{id:owner},access_token:'test',expires_at:9999999999});
          let release,entered,dispatched=0;
          const scope=auth.getAccountScope(),registry=createSyncIncidentRegistry({request:auth.supaFetch,accountScope:auth.getAccountScope});
          const row={...incidentFixture.monitor.view.incidents[0],incident_id:crypto.randomUUID(),client_instance_id:'sheet',site:'orders',domain:'orders_sheet',scope_epoch:'spreadsheet-v1',report_version:2};
          const sync=createSpreadsheetSync({domain:'orders',account:()=>owner,enabled:()=>true,store});
          try{
            for(const mode of ['commit','journal','emergency']){
              await store.commit(key,record);store.saveEmergency(key,[]);
              const sample=await sync.incidentSample();if(!await sample.confirmCurrent())throw Error('clean proof absent');
              const held=new Promise(resolve=>{release=resolve}),entry=new Promise(resolve=>{entered=resolve});
              globalThis.fetch=(url,options)=>{
                if(String(url).endsWith('/hold')){entered();return held.then(()=>new Response('{}'))}
                dispatched++;return Promise.resolve(new Response(JSON.stringify({...row,owner_id:owner,resolved_at:'2026-10-19T10:00:00Z',resolution_kind:'clean_verified'})));
              };
              const blocker=auth.supaFetch('/rest/v1/hold');await entry;
              const pending=registry.resolve(row,scope,sample.isCurrent,sample.withRequestScope).then(()=>false,error=>error.message==='sync_incident_observation_changed');
              if(mode==='commit')await writer.commit(key,{...record,flight:{operationId:'new'}});
              if(mode==='journal')await writer.journal(key,[{rowId:'R',columnId:'C',value:'new'}]);
              if(mode==='emergency')writer.saveEmergency(key,[{rowId:'R',columnId:'C',value:'new'}]);
              if(await sample.confirmCurrent())throw Error('stale proof accepted: '+mode);
              release();await blocker;if(!await pending)throw Error('stale resolve dispatched: '+mode);
            }
            if(dispatched!==0)throw Error('unexpected resolve fetch');
            await store.commit(key,record);store.saveEmergency(key,[]);
            const sample=await sync.incidentSample();await registry.resolve(row,scope,sample.isCurrent,sample.withRequestScope);
            return dispatched===1;
          }finally{globalThis.fetch=fetchBefore;release?.()}
        })()""")
        # Preserve the actual input node, draft, focus and caret through polling.
        assert kupa.evaluate("""(()=>{
          const f=incidentFixture;f.ui.open();const root=document.querySelectorAll('.sync-incidents')[1],input=root.querySelector('[data-incident-label]');
          input.value='Office draft';input.focus();input.setSelectionRange(3,7);
          f.ui.update({...f.monitor.view,localError:true});
          return root.querySelector('[data-incident-label]')===input&&input.value==='Office draft'&&document.activeElement===input&&input.selectionStart===3&&input.selectionEnd===7;
        })()""")
        # An independent JS realm shares the native workbook DB.
        assert orders.evaluate("""(async()=>{
          const {createSpreadsheetSync}=await import('./assets/js/shared/spreadsheet-sync.js');
          const {createSpreadsheetStore}=await import('./assets/js/shared/spreadsheet-store.js');
          const store=createSpreadsheetStore(),key=incidentFixture.scope().owner+':orders:main';
          const saved=await store.load(key);await store.commit(key,{...saved.record,flight:null});store.saveEmergency(key,[]);
          globalThis.closedSheetProof=await createSpreadsheetSync({domain:'orders',account:()=>incidentFixture.scope().owner,enabled:()=>true,store}).incidentSample();
          return await closedSheetProof.confirmCurrent();
        })()""")
        with orders.second_tab():
            assert orders.evaluate("""(async()=>{
              const {createSpreadsheetStore}=await import('./assets/js/shared/spreadsheet-store.js');
              const store=createSpreadsheetStore();
              await store.journal('11111111-1111-4111-8111-111111111111:orders:main',[{rowId:'R',columnId:'C',value:'from another tab'}]);return true;
            })()""")
            assert not orders.drain_serious_errors()
        assert orders.evaluate("""(async()=>{
          let sent=false;try{await closedSheetProof.withRequestScope(()=>{sent=true;return Promise.resolve()})}catch(error){if(error.message!=='sync_incident_observation_changed')throw error}
          return !sent&&!await closedSheetProof.confirmCurrent();
        })()""")
        check_visibility_and_settings(orders, 'orders')
        check_visibility_and_settings(kupa, 'kupa')
        assert not orders.drain_serious_errors()
        assert not kupa.drain_serious_errors()
    print('PASS independent orders/kupa profiles: cross-site warnings, durable reload, native IDB races, domain ACK isolation, UI acknowledgement and closed-sheet detection')


if __name__=='__main__':
    if '--ui-only' in sys.argv:
        for app in ('orders', 'kupa'):
            with IncidentBrowser(app, Registry()) as browser:
                check_visibility_and_settings(browser, app)
        print('PASS sync incident visibility and settings in both applications')
    else:
        run()
