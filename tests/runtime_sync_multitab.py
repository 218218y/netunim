import json

from browser_harness import BrowserSession, ROOT


site = ROOT / "netunim-orders/site"
passed = False
try:
    with BrowserSession(site, "orders-sync-multitab", instrument=False) as browser:
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        browser.evaluate("""(()=>{
          localStorage.setItem('orders.google-calendar.connection.v1',JSON.stringify({known:true,autoConnect:true,accountId:'remembered@example.com'}));
          localStorage.setItem('orders.supabase.session.v1',JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600}));
          return true;
        })()""")
        with browser.second_tab():
            result = browser.evaluate("""(async()=>{
              await new Promise(resolve=>setTimeout(resolve,250));
              return {
                secondaryGuard:document.querySelector('#tabWriterGuard')?.hidden===false,
                calendarBackendRequests:performance.getEntriesByType('resource').filter(entry=>String(entry.name).includes('/functions/v1/google-calendar-oauth')).length,
                dataApiRequests:performance.getEntriesByType('resource').filter(entry=>String(entry.name).includes('/rest/v1/')).length,
              };
            })()""")
            print("orders-secondary", json.dumps(result, ensure_ascii=False))
            passed = result == {"secondaryGuard": True, "calendarBackendRequests": 0, "dataApiRequests": 0}
except Exception as exc:
    print("orders-sync-multitab FAIL", exc)

raise SystemExit(0 if passed else 1)
