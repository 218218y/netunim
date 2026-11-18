"""Real browser disclosure and responsive layout with synthetic MAX warnings."""
import base64
from browser_harness import BrowserSession, ROOT

for app in ('kupa', 'orders'):
    with BrowserSession(ROOT / f'netunim-{app}/site', app+'-credit-diagnostics') as browser:
        for width in (390, 1280):
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
            module='credit/presentation.js' if app=='kupa' else 'finance/credit-status-view.js'
            expression=r"""(async()=>{
              const check=(ok,message)=>{if(!ok)throw Error(message)},module=await import('/assets/js/domains/__MODULE__');
              const at='2026-11-17T04:58:51Z',errors=Array.from({length:22},(_,i)=>({provider:'max',profileId:'P'+Math.floor(i/11),
                code:'CREDIT_PROVIDER_SCHEMA_ERROR',severity:'warning',tier:'forecast',component:'forecast_transactions',
                month:'2027-'+String(i%11+1).padStart(2,'0'),message:'בדוק אם זמין עדכון למחבר',at,
                diagnosticFingerprint:String(i).padStart(16,'0')}));
              document.getElementById('diagnostic-fixture')?.remove();
              const host=document.createElement('section');host.id='diagnostic-fixture';host.dir='rtl';
              host.style.cssText='position:fixed;inset:0;z-index:999999;background:white;padding:16px;overflow:auto;box-sizing:border-box';
              host.innerHTML=__RENDER__;document.body.append(host);
              const detail=host.querySelector('details'),summary=detail?.querySelector('summary');
              check(detail&&summary&&!detail.open,'missing collapsed evidence');
              check(host.textContent.includes('תחזית MAX חלקית'),'missing partial forecast explanation');
              check(!host.textContent.includes('בדוק אם זמין עדכון למחבר'),'misleading update advice');
              check(detail.querySelectorAll('small').length===22,'lost original monthly evidence');
              check(!detail.querySelector('small').checkVisibility(),'evidence always visible');
              check(host.scrollWidth<=host.clientWidth,'collapsed diagnostics overflow viewport');
              summary.focus();return true;
            })()"""
            render=("module.creditSyncDiagnosticsMarkup({}, {sync:{syncedAt:at,errors}})" if app=='kupa' else
                    "module.creditDiagnostics({kupa:{creditSync:{version:4,syncedAt:at,errors}},creditLastSyncAt:at})")
            assert browser.evaluate(expression.replace('__MODULE__',module).replace('__RENDER__',render))
            path=ROOT/'.work/screenshots'/f'{app}-credit-diagnostics-{width}-closed.png'
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(base64.b64decode(browser.call('Page.captureScreenshot',{'format':'png'})['result']['data']))
            browser.call('Input.dispatchKeyEvent',{'type':'keyDown','key':' ','code':'Space','windowsVirtualKeyCode':32})
            browser.call('Input.dispatchKeyEvent',{'type':'keyUp','key':' ','code':'Space','windowsVirtualKeyCode':32})
            assert browser.evaluate("(()=>{const h=document.getElementById('diagnostic-fixture'),d=h.querySelector('details');return d.open&&d.querySelector('small').checkVisibility()&&h.scrollWidth<=h.clientWidth})()")
            path=ROOT/'.work/screenshots'/f'{app}-credit-diagnostics-{width}.png'
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(base64.b64decode(browser.call('Page.captureScreenshot',{'format':'png'})['result']['data']))
        assert not browser.drain_serious_errors()
        print('PASS',app,'22 forecast observations retained; keyboard disclosure and narrow/wide layout')
