"""Real shared search first use is deferred, keyboard-bound and cached offline."""
from browser_harness import BrowserSession, ROOT
import json
import time

for app in ['kupa', 'orders']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-lazy-search', instrument=False,
                        service_worker=True, auto_navigate=False) as browser:
        browser.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'performance.setResourceTimingBufferSize(3000)'})
        browser._navigate()
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        setup = browser.evaluate("""(async()=>{
          const paths=()=>performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname);
          if(paths().some(path=>path.endsWith('/global-document-search.js')))throw Error('heavy search eagerly requested');
          await navigator.serviceWorker.ready;
          if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
          const cached=[];for(const key of await caches.keys())for(const row of await (await caches.open(key)).keys())cached.push(new URL(row.url).pathname);
          if(!cached.some(path=>path.endsWith('/global-document-search.js')))throw Error('offline search missing');
          return {deferred:true,cached:true};
        })()""", timeout=30)
        browser.call('Network.enable')
        offline = {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1, 'connectionType': 'none'}
        browser.call('Network.emulateNetworkConditions', offline)
        browser.call('Network.overrideNetworkState', offline)
        browser._navigate()
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        first_use = browser.evaluate("""(async()=>{
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));
          const backdrop=document.getElementById('globalSearchBackdrop');
          for(let attempt=0;attempt<160&&backdrop.getAttribute('aria-busy')==='true';attempt++)await new Promise(resolve=>setTimeout(resolve,25));
          if(backdrop.hidden||backdrop.getAttribute('aria-busy')==='true')throw Error('offline keyboard search did not open');
          document.getElementById('globalSearchFilterSite').click();
          const input=document.getElementById('globalSearchInput');input.value='lazy-no-match';input.dispatchEvent(new Event('input',{bubbles:true}));
          const requested=performance.getEntriesByType('resource').map(row=>new URL(row.name).pathname);
          if(!requested.some(path=>path.endsWith('/global-document-search.js')))throw Error('search implementation not requested on first use');
          if(requested.some(path=>path.includes('/assets/vendor/')))throw Error('viewer vendor requested for site search');
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          if(!backdrop.hidden)throw Error('loaded search did not close');
          document.getElementById('globalSearchButton').click();if(backdrop.hidden)throw Error('loaded trigger failed');
          document.getElementById('globalSearchClose').click();if(!backdrop.hidden)throw Error('loaded close failed');
          return {offline:!navigator.onLine,opened:true,closed:true,noVendor:true};
        })()""")
        assert first_use == {'offline': True, 'opened': True, 'closed': True, 'noVendor': True}, first_use
        held = browser.evaluate("""(async()=>{
          const {createLazyGlobalDocumentSearch}=await import('./assets/js/shared/lazy-global-document-search.js');
          let release,changed,created=0;const gate=new Promise(resolve=>{release=resolve});
          const owner=createLazyGlobalDocumentSearch({load:async()=>{await gate;return ()=>{created++;throw Error('stale view created')}},navigateItem:()=>false,
            subscribeAuthorization:callback=>{changed=callback;return ()=>{}}});
          const pending=owner.open();await Promise.resolve();changed();changed();release();
          const cancelled=await pending===false;owner.dispose();return {cancelled,created,hidden:document.getElementById('globalSearchBackdrop').hidden};
        })()""")
        assert held == {'cancelled': True, 'created': 0, 'hidden': True}, held
        assert not browser.drain_serious_errors()
        print('PASS', app, 'deferred shared search; offline keyboard/trigger first-use;', json.dumps({**setup, **first_use}), flush=True)

    # Native ESM retains a failed module URL for the life of the document.
    # Exercise the actual reload recovery button, not a fake retrying loader.
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-search-load-recovery', instrument=False,
                        auto_navigate=False) as browser:
        browser.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'performance.setResourceTimingBufferSize(3000)'})
        browser._navigate()
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        browser.call('Network.enable')
        browser.call('Network.setBlockedURLs', {'urls': ['*global-document-search.js']})
        failed = browser.evaluate(r"""(async()=>{
          document.getElementById('globalSearchButton').click();
          for(let i=0;i<120&&!document.querySelector('[data-search-load-reload]');i++)await new Promise(resolve=>setTimeout(resolve,25));
          const button=document.querySelector('[data-search-load-reload]'),text=document.getElementById('globalSearchResults').textContent;
          return {recovery:!!button,readable:/[\u0590-\u05ff]/.test(text)&&!/\?{3,}/.test(text),origin:performance.timeOrigin};
        })()""")
        assert failed['recovery'] and failed['readable'], failed
        browser.call('Network.setBlockedURLs', {'urls': []})
        browser.evaluate("setTimeout(()=>document.querySelector('[data-search-load-reload]').click(),0);true")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                state = browser.evaluate("({origin:performance.timeOrigin,ready:document.readyState})")
                if state['origin'] != failed['origin'] and state['ready'] == 'complete':
                    break
            except RuntimeError:
                pass  # The old execution context is expected to be destroyed.
            time.sleep(0.05)
        else:
            raise AssertionError('search recovery button did not reload the document')
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        recovered = browser.evaluate("""(async()=>{
          document.getElementById('globalSearchButton').click();
          for(let i=0;i<120&&document.getElementById('globalSearchBackdrop').getAttribute('aria-busy')==='true';i++)await new Promise(resolve=>setTimeout(resolve,25));
          return {visible:!document.getElementById('globalSearchBackdrop').hidden,retry:!!document.querySelector('[data-search-load-reload]'),requested:performance.getEntriesByType('resource').some(row=>row.name.endsWith('/global-document-search.js'))};
        })()""")
        assert recovered == {'visible': True, 'retry': False, 'requested': True}, recovered
        assert not browser.drain_serious_errors()
        print('PASS', app, 'native failed-module recovery through explicit document reload; readable Hebrew guidance', flush=True)
