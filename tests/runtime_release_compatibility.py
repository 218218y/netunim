"""An actual controlling worker rejects another deployment's module bytes."""
from browser_harness import BrowserSession, ROOT
from pwa_upgrade import wait_for_worker_control
import json

for app in ['orders', 'kupa']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-release-fence', instrument=False, service_worker=True) as browser:
        assert browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        wait_for_worker_control(browser)
        assert browser.evaluate("""(async()=>{
          await import('./assets/js/main.js').then(m=>m.appReady);
          await navigator.serviceWorker.ready;
          if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
          localStorage.setItem('release-test-preference','preserved');return true;
        })()""")
        site = browser.tmp/'site'
        module = site/'assets/js/shared/spreadsheet-store.js'
        # Compare actual response bytes, preserving Windows checkout CRLFs.
        original = module.read_bytes().decode('utf-8')
        headers = site/'_headers'
        header_text = headers.read_text(encoding='utf-8')
        headers.write_text('\n'.join('  X-Netunim-Release: future-release' if 'X-Netunim-Release:' in line else line for line in header_text.splitlines())+'\n', encoding='utf-8')
        module.write_bytes((original+'\nexport const FUTURE_INCOMPATIBLE=true;\n').encode('utf-8'))
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

# A real script-evaluation failure must leave native evidence before cleanup.
# This owns a separate cold profile and never changes either product worker.
with BrowserSession(ROOT/'netunim-kupa/site', 'worker-error-evidence', instrument=False,
                    service_worker=True, auto_navigate=False) as browser:
    (browser.tmp/'site/service-worker.js').write_text("throw new Error('controlled_install_failure');",encoding='utf-8')
    (browser.tmp/'site/assets/app.js').write_text("navigator.serviceWorker.register('./service-worker.js').catch(()=>{});",encoding='utf-8')
    (browser.tmp/'site/index.html').write_text('<script defer src="./assets/app.js"></script>',encoding='utf-8')
    browser._navigate()
    try:
        wait_for_worker_control(browser,timeout=5)
        raise AssertionError('invalid worker unexpectedly installed')
    except RuntimeError as error:
        assert 'install error' in str(error), str(error)
        assert 'controlled_install_failure' in str(error), str(error)
    evidence=browser.save_worker_evidence('expected-script-failure')
    saved=json.loads(evidence.read_text(encoding='utf-8'))
    assert any(item['event'].get('method')=='ServiceWorker.workerErrorReported' for item in saved['events']), saved
    assert saved['states'] and saved['cache'] is not None, saved
    print('PASS native worker error, registration/cache state and timestamps survive isolated failing installation')
