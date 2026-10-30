"""Real Chromium install/lazy/offline recovery with stale CDN release headers."""
from functools import partial
import json
import re
from urllib.parse import urlparse,parse_qs
from browser_harness import BrowserSession,ROOT,_QuietHandler
from pwa_upgrade import wait_for_worker_control

for app in ['orders','kupa']:
    with BrowserSession(ROOT/f'netunim-{app}/site',app+'-cdn-release',instrument=False,service_worker=True,auto_navigate=False) as browser:
        observed=[]
        stale={'/assets/app.css','/assets/js/shared/spreadsheet-store.js','/assets/vendor/pdfjs/build/pdf.mjs'}
        expected=re.search(r"const CACHE='([^']+)'",(browser.tmp/'site/service-worker.js').read_text(encoding='utf-8'))[1]
        vendor_hashes=json.loads(re.search(r'const VENDOR_HASHES=(\{[\s\S]*?\});',(browser.tmp/'site/service-worker.js').read_text(encoding='utf-8'))[1])
        class StaleEdgeHeaders(_QuietHandler):
            release=expected
            responses=observed
            def send_header(self,name,value):
                parsed=urlparse(self.path)
                if name.lower()=='x-netunim-release' and parsed.path in stale:
                    query=parse_qs(parsed.query)
                    bound=query.get('__netunim_release')==[self.release] or query.get('__netunim_vendor')==[vendor_hashes.get('.'+parsed.path)]
                    if not bound:value='older-edge-release'
                    if '/assets/vendor/' in parsed.path:value='different-deployment-release'
                    self.responses.append({'path':parsed.path,'bound':bound,'release':value})
                super().send_header(name,value)
        browser.httpd.RequestHandlerClass=partial(StaleEdgeHeaders,directory=str(browser.tmp/'site'))
        browser._navigate()
        assert browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        wait_for_worker_control(browser)
        paths=sorted(stale)
        result=browser.evaluate("""(async()=>{
          const paths="""+json.dumps(paths)+""",results=[];
          for(const path of paths){const response=await fetch(path);results.push({path,release:response.headers.get('X-Netunim-Release'),body:await response.text()})}
          const names=await caches.keys(),name=names.find(value=>value.includes('app-shell')),cache=await caches.open(name),keys=(await cache.keys()).map(value=>value.url);
          return {name,results,canonicalKeys:keys.every(value=>!new URL(value).search),cached:await Promise.all(paths.map(async path=>!!await cache.match(path)))};
        })()""")
        assert result['name']==expected and result['canonicalKeys'] and all(result['cached']),result
        for row in result['results']:
            assert row['release']==expected,{'path':row['path'],'release':row['release']}
            assert row['body']==(browser.tmp/'site'/row['path'].lstrip('/')).read_bytes().decode('utf-8'),row['path']
        assert any(not row['bound'] for row in observed),'fixture did not expose stale unversioned responses'
        assert all(any(row['bound'] and row['path']==path for row in observed) for path in paths),observed
        browser.call('Network.enable')
        browser.call('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1,'connectionType':'none'})
        offline=browser.evaluate("""(async()=>{const rows=[];for(const path of """+json.dumps(paths)+"""){const response=await fetch(path);rows.push({path,release:response.headers.get('X-Netunim-Release'),body:await response.text()})}return rows})()""")
        assert offline==result['results'],app+' lost canonical offline assets after CDN recovery'
        assert not browser.drain_serious_errors()
        print('PASS',app,'stale CDN headers: native install, canonical cache, lazy runtime and offline bytes',flush=True)
