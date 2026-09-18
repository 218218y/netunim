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

# Measure real finance views independently of the simpler Cash/Supplier tables.
# Absolute times are baseline observations; deterministic work-count gates catch
# duplicate calculations without depending on the speed of the CI machine.
with BrowserSession(ROOT/'netunim-kupa/site','kupa-finance-performance') as browser:
    finance=browser.evaluate("""(async()=>{
      const metrics=await import('./assets/js/shared/runtime-performance.js');
      const ref=todayISO(),future=addMonthsISO(ref,1),mappings={};
      const accounts=Array.from({length:4},(_,card)=>{
        const accountNumber=String(1000+card);mappings['perf:'+accountNumber]={included:true,hidden:false,account:card%2?'ביתי':'עסקי'};
        return {accountNumber,pendingStatus:'success',txns:Array.from({length:250},(_,i)=>({id:card+'-'+i,description:'Purchase '+i,status:'completed',transactionDate:ref,processedDate:future,chargedAmount:-(i%100+1),chargedCurrency:'ILS'}))};
      });
      const transactions=Array.from({length:1000},(_,i)=>({id:'B'+i,date:ref,description:'Transfer '+i,amount:i%2?100:-100}));
      state=normalizeState({credits:[],checks:[{id:'C',name:'Check',amount:300,dueDate:future,status:'בקופה'}],expenses:[{id:'E',description:'Rent',active:true,recurring:true,amount:500,date:future,account:'עסקי'}],
        bank:{currentBalance:100000,asOfDate:ref,feed:{accountNumber:'123',syncedAt:ref,balance:100000,transactions},homeFeed:{accountNumber:'456',syncedAt:ref,balance:50000,transactions}},
        creditSync:{profiles:[{profileId:'perf',provider:'max',defaultAccount:'עסקי',accounts}],cardMappings:mappings}});
      backendReady=false;const results={};metrics.configurePerformance(true);
      try{
        for(const page of ['dashboard','bank','credit']){
          currentPage=page;metrics.clearPerformance();const start=performance.now();render();
          results[page]={ms:Math.round(performance.now()-start),metrics:metrics.performanceSummary()};
        }
        metrics.clearPerformance();const start=performance.now();setCreditSearch('Purchase 24');
        results.search={ms:Math.round(performance.now()-start),metrics:metrics.performanceSummary()};
        // Same data and UI keys: navigation preserves the exact DOM and does no derivation.
        setPage('cash');const cash=document.getElementById('content').firstChild;
        setPage('notes');metrics.clearPerformance();setPage('cash');
        results.warm={same:cash===document.getElementById('content').firstChild,metrics:metrics.performanceSummary()};
      }finally{metrics.configurePerformance(false);metrics.clearPerformance()}
      return results;
    })()""",timeout=60)
    for view in ['dashboard','bank','credit','search']:
        assert finance[view]['ms']<10000,finance  # catastrophe guard; collect CI baseline first
    for view in ['credit','search']:
        assert finance[view]['metrics']['finance:compute:credit-detail']['count']==1,finance
    assert finance['dashboard']['metrics']['finance:compute:cashflow']['count']==2,finance
    assert finance['warm']['same'] and not finance['warm']['metrics'],finance
    assert not browser.drain_serious_errors()
    print('PASS finance: 1000 credit + 2000 bank rows, single detail derivation, two account forecasts, warm DOM identity;',json.dumps(finance))
