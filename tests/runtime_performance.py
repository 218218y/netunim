"""Representative large-list measurements and side-effect/listener regressions."""
from browser_harness import BrowserSession, ROOT
import json


def root_listeners(browser, selector):
    response=browser.call('Runtime.evaluate',{'expression':f'document.querySelector({json.dumps(selector)})'})
    ident=response['result']['result']['objectId']
    try:
        listeners=browser.call('DOMDebugger.getEventListeners',{'objectId':ident})['result']['listeners']
        return sorted((x['type'],x['useCapture'],x['passive'],x['once']) for x in listeners)
    finally:
        browser.call('Runtime.releaseObject',{'objectId':ident})


fixtures={
 'kupa':"""
 state=normalizeState({version:4,cash:Array.from({length:1000},(_,i)=>({id:'C'+i,date:'2026-08-27',description:'Cash '+i,amount:i})),checks:[],credits:[],expenses:[],cards:[]});
 backendReady=true;currentPage='cash';render();
 """,
 'orders':"""
 state=normalizeState({suppliers:[{id:'S',name:'Performance',active:true}],transactions:Array.from({length:1000},(_,i)=>({id:'T'+i,supplierId:'S',sequence:i+1,action:'Transaction '+i,debit:i,credit:0}))});
 currentSupplierId='S';currentView='supplier';render();
 """,
}
for label,setup in fixtures.items():
    with BrowserSession(ROOT/f'netunim-{label}/site',label+'-performance') as browser:
        browser.evaluate('(()=>{'+setup+'return true})()')
        selector='#content' if label=='kupa' else '#main'
        listeners=root_listeners(browser,selector)
        measurements=browser.evaluate("""(()=>{
          const times=[],originalWrite=Storage.prototype.setItem,originalFetch=window.fetch;
          let writes=0,requests=0;
          Storage.prototype.setItem=function(...args){writes++;return originalWrite.apply(this,args)};
          window.fetch=(...args)=>{requests++;return originalFetch(...args)};
          try{for(let i=0;i<8;i++){const start=performance.now();render();times.push(performance.now()-start)}}
          finally{Storage.prototype.setItem=originalWrite;window.fetch=originalFetch}
          return {maxMs:Math.round(Math.max(...times)),meanMs:Math.round(times.reduce((a,b)=>a+b)/times.length),writes,requests,rows:document.querySelectorAll('tbody tr').length};
        })()""")
        assert root_listeners(browser,selector)==listeners, label+' accumulated delegated listeners'
        assert measurements['writes']==0 and measurements['requests']==0, measurements
        assert measurements['rows']>=1000,measurements
        # Deliberately generous: catch a pathological algorithm, not CI noise.
        assert measurements['maxMs']<5000,measurements
        assert not browser.drain_serious_errors()
        print('PASS',label,'1000-row render x8; stable listeners; no storage/RPC writes;',json.dumps(measurements))
