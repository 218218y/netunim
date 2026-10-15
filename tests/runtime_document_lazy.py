"""Native first-use/offline viewer loading, without importing the test facade."""
from browser_harness import BrowserSession, ROOT
import json


for app in ['kupa', 'orders']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-lazy-preview', instrument=False,
                        service_worker=True, auto_navigate=False) as browser:
        browser.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'performance.setResourceTimingBufferSize(3000)'})
        browser._navigate()
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        result = browser.evaluate("""(async()=>{
          const viewers=['pdf-search-viewer.js','docx-search-viewer.js','text-search-viewer.js','spreadsheet-search-viewer.js'];
          const requested=()=>performance.getEntriesByType('resource').map(entry=>new URL(entry.name).pathname);
          if(requested().some(path=>viewers.some(name=>path.endsWith('/'+name))))throw Error('viewer loaded during startup');
          await navigator.serviceWorker.ready;
          if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
          const keys=[];for(const name of await caches.keys())for(const request of await (await caches.open(name)).keys())keys.push(new URL(request.url).pathname);
          if(!viewers.every(name=>keys.some(path=>path.endsWith('/'+name))))throw Error('offline viewer missing from app shell');
          return {startupDeferred:true,offlineCached:true};
        })()""", timeout=30)
        browser.call('Network.enable')
        offline = {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1, 'connectionType': 'none'}
        browser.call('Network.emulateNetworkConditions', offline)
        browser.call('Network.overrideNetworkState', offline)
        first_use = browser.evaluate("""(async()=>{
          const {createDocumentPreviewModules}=await import('./assets/js/domains/documents/preview-modules.js');
          const host=document.createElement('div');document.body.append(host);
          const owner=createDocumentPreviewModules();
          const viewer=await owner.createTextSearchViewer({host,text:'offline needle',query:'needle'},()=>true);
          const shown=host.textContent.includes('offline needle'),matches=viewer.matchState().total;
          await viewer.destroy();const cleaned=host.childElementCount===0;
          // Import other first-party formats offline without activating their
          // separately lazy third-party runtimes or creating any worker/viewer.
          await Promise.all([import('./assets/js/domains/documents/pdf-search-viewer.js'),
            import('./assets/js/domains/documents/docx-search-viewer.js'),
            import('./assets/js/domains/documents/spreadsheet-search-viewer.js')]);
          const vendors=performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname.includes('/assets/vendor/'));
          host.remove();return {shown,matches,cleaned,vendorRequests:vendors.length};
        })()""")
        assert first_use == {'shown': True, 'matches': 1, 'cleaned': True, 'vendorRequests': 0}, first_use
        # Hold the application-module loader at the same boundary used in the
        # shell. Disposing/replacing the selection before release may not mount.
        held = browser.evaluate("""(async()=>{
          const {createDocumentPreviewModules}=await import('./assets/js/domains/documents/preview-modules.js');
          const implementation=await import('./assets/js/domains/documents/text-search-viewer.js');
          let release,active=true,started=0;const gate=new Promise(resolve=>{release=resolve}),host=document.createElement('div');
          const owner=createDocumentPreviewModules({load:{text:async()=>{started++;await gate;return implementation}}});
          const task=owner.createTextSearchViewer({host,text:'old account',query:''},()=>active);
          await Promise.resolve();active=false;host.textContent='replacement account';release();
          const stale=await task;return {started,cancelled:stale===null,isolated:host.textContent==='replacement account'};
        })()""")
        assert held == {'started': 1, 'cancelled': True, 'isolated': True}, held
        assert not browser.drain_serious_errors()
        print('PASS', app, 'deferred first-party viewers; native offline first use; no eager vendors; held loader scope;',
              json.dumps({**result, **first_use, **held}), flush=True)
