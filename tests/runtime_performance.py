"""Representative large-list measurements and side-effect/listener regressions."""
from browser_harness import BrowserSession, ROOT
import json

RENDER_SAMPLES = 8
MAX_RENDER_MS = 1000
MAX_RENDER_P95_MS = 600
# Runtime.evaluate is one synchronous CDP request containing every sample.
# Its transport deadline must cover the allowed per-render contract plus setup.
MEASUREMENT_TIMEOUT_SECONDS = RENDER_SAMPLES * MAX_RENDER_MS / 1000 + 5


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
        measurement_script="""(()=>{
          const times=[],originalWrite=Storage.prototype.setItem,originalFetch=window.fetch;
          let writes=0,requests=0;
          Storage.prototype.setItem=function(...args){writes++;return originalWrite.apply(this,args)};
          window.fetch=(...args)=>{requests++;return originalFetch(...args)};
          try{for(let i=0;i<RENDER_SAMPLES;i++){const start=performance.now();render();times.push(performance.now()-start)}}
          finally{Storage.prototype.setItem=originalWrite;window.fetch=originalFetch}
          times.sort((a,b)=>a-b);
          return {maxMs:Math.round(Math.max(...times)),p95Ms:Math.round(times[Math.ceil(times.length*.95)-1]),meanMs:Math.round(times.reduce((a,b)=>a+b)/times.length),writes,requests,rows:document.querySelectorAll('tbody tr').length};
        })()""".replace('RENDER_SAMPLES',str(RENDER_SAMPLES))
        measurements=browser.evaluate(measurement_script,timeout=MEASUREMENT_TIMEOUT_SECONDS)
        assert root_listeners(browser,selector)==listeners, label+' accumulated delegated listeners'
        assert measurements['writes']==0 and measurements['requests']==0, measurements
        assert measurements['rows']>=1000,measurements
        # Measured baseline is 80-220 ms on the development machine; allow CI headroom.
        assert measurements['maxMs']<MAX_RENDER_MS,measurements
        assert measurements['p95Ms']<MAX_RENDER_P95_MS,measurements
        assert not browser.drain_serious_errors()
        print('PASS',label,f'1000-row render x{RENDER_SAMPLES}; stable listeners; no storage/RPC writes;',json.dumps(measurements))
        if label == 'orders':
            inline=browser.evaluate("""(async()=>{
              const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              await frame();
              const table=document.querySelector('#main table'),untouched=document.querySelector('tr[data-tx-id="T900"]'),wrap=document.querySelector('.supplier-table-panel .table-wrap');
              wrap.scrollTop=100;await frame();const scroll=wrap.scrollTop,times=[],paints=[];
              for(let i=0;i<8;i++){
                const start=performance.now();setInlineTri('T10','signed',i%2===0);times.push(performance.now()-start);
                clearTimeout(saveTimer);saveTimer=null;await frame();paints.push(performance.now()-start);
              }
              const local=loadLocal();
              const stable=table===document.querySelector('#main table')&&untouched===document.querySelector('tr[data-tx-id="T900"]');
              const preservedScroll=Math.abs(scroll-wrap.scrollTop)<2,durable=local.transactions.find(t=>t.id==='T10').signed===state.transactions.find(t=>t.id==='T10').signed;
              // A status change that removes a filtered row still updates the structure and totals.
              state.transactions[10].supplied=false;filterMode='pending';renderSupplier();
              setInlineTri('T10','supplied',true);clearTimeout(saveTimer);saveTimer=null;
              const removed=!document.querySelector('tr[data-tx-id="T10"]');
              // A closed-year carry row disappears when its workflow completes.
              filterMode='all';state.transactions[0].yearEnd=2025;state.transactions[0].invoiceReceived=true;state.transactions[0].signed=true;state.transactions[0].supplied=false;
              renderSupplier();const carryWasVisible=!!document.querySelector('tr[data-tx-id="T0"]');
              setInlineTri('T0','supplied',true);clearTimeout(saveTimer);saveTimer=null;
              times.sort((a,b)=>a-b);paints.sort((a,b)=>a-b);
              return {stable,preservedScroll,durable,removed,carryRemoved:carryWasVisible&&!document.querySelector('tr[data-tx-id="T0"]'),p95ActionMs:Math.round(times[7]),p95PaintOpportunityMs:Math.round(paints[7])};
            })()""",timeout=20)
            assert all(inline[key] for key in ['stable','preservedScroll','durable','removed','carryRemoved']),inline
            assert inline['p95ActionMs']<250,inline
            assert not browser.drain_serious_errors()
            print('PASS orders inline status: stable DOM/scroll, immediate verified snapshot, filter/archive invalidation;',json.dumps(inline))
