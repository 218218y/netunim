"""An actual controlling worker rejects another deployment's module bytes."""
from browser_harness import BrowserSession, ROOT

for app in ['orders', 'kupa']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-release-fence', instrument=False, service_worker=True) as browser:
        assert browser.evaluate("""(async()=>{
          await import('./assets/js/main.js').then(m=>m.appReady);
          await navigator.serviceWorker.ready;
          if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
          localStorage.setItem('release-test-preference','preserved');return true;
        })()""")
        site = browser.tmp/'site'
        module = site/'assets/js/shared/spreadsheet-store.js'
        original = module.read_text(encoding='utf-8')
        headers = site/'_headers'
        header_text = headers.read_text(encoding='utf-8')
        headers.write_text('\n'.join('  X-Netunim-Release: future-release' if 'X-Netunim-Release:' in line else line for line in header_text.splitlines())+'\n', encoding='utf-8')
        module.write_text(original+'\nexport const FUTURE_INCOMPATIBLE=true;\n', encoding='utf-8')
        result = browser.evaluate("""(async()=>{
          const online=await fetch('./assets/js/shared/spreadsheet-store.js',{cache:'no-store'});
          const current=online.headers.get('X-Netunim-Release');
          const body=await online.text();
          return {body,current,preference:localStorage.getItem('release-test-preference')};
        })()""")
        assert result['body'] == original, result
        assert result['current'] != 'future-release', result
        assert result['preference'] == 'preserved'
        browser.call('Network.enable')
        offline = {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1, 'connectionType': 'none'}
        browser.call('Network.emulateNetworkConditions', offline)
        assert browser.evaluate("fetch('./assets/js/shared/spreadsheet-store.js').then(r=>r.text())") == original
        print('PASS', app, 'native release fence retains current module through mixed network and offline')
