"""Uninstrumented production ESM, actual SW/offline reload and Web Locks.

Only public DOM, browser storage and the small exported appReady lifecycle API
are used. All data and cloud endpoints live in a disposable local test origin.
"""
from browser_harness import BrowserSession, ROOT
import json
from pwa_upgrade import test_worker_upgrade


def ready(browser):
    return browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")


fixtures = {
    'kupa': {
        'kupa.supabase.session.v1': {'access_token':'test', 'expires_at':4102444800},
        'kupa.browser.state.v1': {'revision':3, 'savedAt':'2026-08-27T12:00:00Z', 'state':{
            'version':4, 'businessName':'PWA fixture', 'cash':[{'id':'PWA-CASH','date':'2026-08-27','description':'PWA cash recovery','amount':75}],
            'checks':[], 'credits':[], 'expenses':[], 'cards':[]}},
        'kupa.cloud.pending.local.v1': {'baseRevision':3,'generation':2,'savedAt':'2026-08-27T12:00:00Z',
            'snapshot':{'version':4,'businessName':'PWA fixture','cash':[{'id':'PWA-CASH','date':'2026-08-27','description':'PWA cash recovery','amount':75}],
                        'credits':[],'expenses':[],'cards':[]}},
    },
    'orders': {
        'orders.management.state.v1': {'version':4,'businessName':'PWA fixture','suppliers':[{'id':'PWA-S','name':'PWA supplier recovery','active':True}],
                                      'transactions':[], 'checks':[], 'notes':[]},
        'orders.supabase.pending.v1': {'pending':True,'updatedAt':'2026-08-27T12:00:00Z'},
    },
}

for label, fixture in fixtures.items():
    with BrowserSession(ROOT/f'netunim-{label}/site', label+'-pwa', instrument=False, service_worker=True) as browser:
        assert ready(browser)
        browser.ws.settimeout(20)
        installed = browser.evaluate("""(async()=>{
          await navigator.serviceWorker.ready;
          if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));
          const names=await caches.keys(), cache=await caches.open(names.find(n=>n.includes('app-shell')));
          const keys=(await cache.keys()).map(r=>new URL(r.url).pathname);
          return {keys,globals:['render','saveState','openModal','KUPA_SUPABASE_CONFIG','ORDER_SUPABASE_CONFIG'].filter(n=>Object.hasOwn(window,n))};
        })()""")
        assets=['/'+p.relative_to(browser.tmp/'site').as_posix() for p in (browser.tmp/'site/assets').rglob('*.js')]
        assert set(assets).issubset(installed['keys']), (label, installed)
        assert installed['globals']==[], installed

        # Seed once on the next navigation. Subsequent reloads have no seeding:
        # they must use the real recovery path and keep pending intact.
        source='for(const [key,value]of Object.entries('+json.dumps(fixture)+'))localStorage.setItem(key,JSON.stringify(value));'
        ident=browser.call('Page.addScriptToEvaluateOnNewDocument',{'source':source})['result']['identifier']
        browser.call('Network.enable')
        network={'offline':True,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1,'connectionType':'none'}
        response=browser.call('Network.emulateNetworkConditions',network)
        assert 'error' not in response,response
        response=browser.call('Network.overrideNetworkState',network)
        assert 'error' not in response,response
        browser._navigate()
        browser.call('Page.removeScriptToEvaluateOnNewDocument',{'identifier':ident})
        browser.call('Network.overrideNetworkState',network)
        assert ready(browser)
        assert browser.evaluate("fetch('/offline-probe',{cache:'no-store'}).then(()=>false,()=>true)")
        for reload_number in range(2):
            if reload_number:
                browser._navigate()
                browser.call('Network.overrideNetworkState',network)
                assert ready(browser)
            result=browser.evaluate("""(()=>{
              const label="""+json.dumps(label)+""";
              if(label==='kupa')document.querySelector('[data-page="cash"]').click();
              return {offline:!navigator.onLine,controlled:!!navigator.serviceWorker.controller,
                recovered:document.body.textContent.includes(label==='kupa'?'PWA cash recovery':'PWA supplier recovery'),
                pending:!!localStorage.getItem(label==='kupa'?'kupa.cloud.pending.local.v1':'orders.supabase.pending.v1')};
            })()""")
            assert all(result.values()), (label,reload_number,result)

        before=browser.evaluate('JSON.stringify({...localStorage})')
        with browser.second_tab():
            blocked=browser.evaluate("""(()=>{
              const guard=document.querySelector('#tabWriterGuard');
              return guard?!guard.hidden:document.querySelector('#connectTitle').textContent.includes('בלשונית אחרת');
            })()""")
            assert blocked, label+' second tab must be read-only'
        assert browser.evaluate('JSON.stringify({...localStorage})')==before, label+' secondary tab changed storage'
        keys=browser.evaluate('(async()=>{const out=[];for(const n of await caches.keys())for(const r of await (await caches.open(n)).keys())out.push(new URL(r.url).pathname);return out})()')
        assert not any('/rest/' in k or k.endswith('.json') for k in keys), keys
        errors=browser.drain_serious_errors()
        # Programmatic navigation with pending work deliberately invokes the
        # unload guard without a trusted gesture. Chrome refuses that dialog;
        # local snapshots and pending must still survive (asserted above).
        errors=[e for e in errors if not e.startswith("Blocked attempt to show a 'beforeunload' confirmation panel")]
        assert not errors,errors
        print('PASS',label,'native ESM,',len(assets),'cached modules, offline reload/recovery, pending, second-tab guard')
    test_worker_upgrade(label, fixture)
