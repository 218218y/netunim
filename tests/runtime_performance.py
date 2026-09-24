"""Representative large-list measurements and side-effect/listener regressions."""
from browser_harness import LegacyBrowserSession as BrowserSession, ROOT
import json
import os
from pathlib import Path

report={}

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
        report[label+'-table']=measurements
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
        metrics.clearPerformance();const times=[];
        for(let i=1;i<=10;i++){const start=performance.now();setCreditSearch('Purchase 24'.slice(0,i));times.push(performance.now()-start)}
        results.search={ms:Math.round(Math.max(...times)),times:times.map(Math.round),metrics:metrics.performanceSummary()};
        setCreditSearch('Purchase');const first=document.querySelector('[data-credit-search-id]')?.dataset.creditSearchId;
        document.querySelector('[data-action="credit-details-page"][data-click-arg1="1"]').click();
        results.pagination={changed:first!==document.querySelector('[data-credit-search-id]')?.dataset.creditSearchId,rows:document.querySelectorAll('[data-credit-search-id]').length,focused:document.activeElement?.dataset.action==='credit-details-page'};
        metrics.clearPerformance();let start=performance.now();uiGlobalSearch.open();uiGlobalSearch.renderResults('Purchase');
        results.globalCold={ms:Math.round(performance.now()-start),metrics:metrics.performanceSummary()};uiGlobalSearch.close();
        metrics.clearPerformance();start=performance.now();uiGlobalSearch.open();uiGlobalSearch.renderResults('Purchase 2');
        results.globalWarm={ms:Math.round(performance.now()-start),metrics:metrics.performanceSummary()};uiGlobalSearch.close();
        // Same data and UI keys: navigation preserves the exact DOM and does no derivation.
        setPage('cash');const cash=document.getElementById('content').firstChild;
        setPage('notes');metrics.clearPerformance();setPage('cash');
        results.warm={same:cash===document.getElementById('content').firstChild,metrics:metrics.performanceSummary()};
      }finally{metrics.configurePerformance(false);metrics.clearPerformance()}
      return results;
    })()""",timeout=60)
    for view in ['dashboard','bank','credit','search']:
        assert finance[view]['ms']<10000,finance  # catastrophe guard; collect CI baseline first
    assert finance['credit']['metrics']['finance:compute:credit-detail']['count']==1,finance
    assert not any(key.startswith('finance:compute:') or key.startswith('selector:compute:') for key in finance['search']['metrics']),finance
    assert finance['search']['ms']<600,finance
    assert finance['pagination']['changed'] and finance['pagination']['focused'] and 0<finance['pagination']['rows']<=150,finance
    assert finance['globalWarm']['metrics']=={},finance
    assert finance['dashboard']['metrics']['finance:compute:cashflow']['count']==2,finance
    assert finance['warm']['same'] and not finance['warm']['metrics'],finance
    assert not browser.drain_serious_errors()
    print('PASS finance: 1000 credit + 2000 bank rows, single detail derivation, two account forecasts, warm DOM identity;',json.dumps(finance))
    report['finance']=finance

with BrowserSession(ROOT/'netunim-orders/site','orders-domain-performance') as browser:
    domains=browser.evaluate("""(async()=>{
      const metrics=await import('./assets/js/shared/runtime-performance.js'),results={};
      metrics.configurePerformance(true);
      try{
        for(const count of [1000,5000]){
          state=normalizeState({suppliers:[{id:'S',name:'Supplier'}],transactions:[],notes:[{id:'N',content:'note'}],
            customerDebts:Array.from({length:count},(_,i)=>({id:'D'+i,customerName:'Customer '+i,amount:100+i})),
            serviceCalls:Array.from({length:count},(_,i)=>({id:'SV'+i,customerName:'Service '+i,openedAt:'2026-09-01'})),
            inventoryItems:Array.from({length:count},(_,i)=>({id:'I'+i,name:'Item '+String(i).padStart(5,'0'),category:'Category',active:true})),
            inventoryEvents:Array.from({length:count},(_,i)=>({id:'E'+i,itemId:'I'+i,type:'opening',quantity:10,location:'מחסן קטן'})),
            warehouseOrders:Array.from({length:count},(_,i)=>({id:'W'+i,customerName:'Order '+i,status:'ordered'}))});
          domainRevisions.touchAll();customerFilter='all';warehouseTab='stock';inventoryGrouping='category';inventoryLocation='';
          for(const view of ['customers','service','warehouse']){
            metrics.clearPerformance();let start=performance.now();switchView(view);const cold=performance.now()-start;
            metrics.clearPerformance();start=performance.now();render();const warm=performance.now()-start;
            results[count+':'+view]={coldMs:Math.round(cold),warmMs:Math.round(warm),rows:document.querySelectorAll(view==='service'?'.service-card':view==='customers'?'.customer-table tbody tr':'[data-stock-bulk-id]').length,metrics:metrics.performanceSummary()};
          }
          // Exercise real delegated pagination, then search must reset to page 1.
          switchView('customers');document.querySelector('[data-action="customer-results-page"][data-click-arg1="1"]').click();
          results[count+':page']={first:document.querySelector('[data-customer-bulk-id]').dataset.customerBulkId,total:state.customerDebts.length};
          // Global-search navigation must reveal a result outside the initial window.
          uiGlobalSearch.navigateItem({group:'customers',kind:'customer-debt',id:'D0'});
          results[count+':target']=!!document.querySelector('[data-customer-bulk-id="D0"]');
        }
        switchView('supplier');const supplier=document.getElementById('main').firstChild;
        switchView('service');domainRevisions.touch('notes');metrics.clearPerformance();switchView('supplier');
        results.warm={same:supplier===document.getElementById('main').firstChild,metrics:metrics.performanceSummary()};
        // Alert indicator refreshes should not clone finance or derive cashflow.
        uiAlertCenter.refreshIndicator();metrics.clearPerformance();for(let i=0;i<10;i++)uiAlertCenter.refreshIndicator();results.alerts=metrics.performanceSummary();
        metrics.clearPerformance();let started=performance.now();uiGlobalSearch.open();uiGlobalSearch.renderResults('Customer');results.globalCold={ms:Math.round(performance.now()-started),metrics:metrics.performanceSummary()};uiGlobalSearch.close();
        metrics.clearPerformance();started=performance.now();uiGlobalSearch.open();uiGlobalSearch.renderResults('Service');results.globalWarm={ms:Math.round(performance.now()-started),metrics:metrics.performanceSummary()};uiGlobalSearch.close();
        // A status toggle keeps unrelated cards and the surrounding DOM alive.
        switchView('service');const untouched=document.querySelector('[data-service-bulk-id="SV1"]'),host=document.getElementById('serviceSearchResults');
        toggleServiceFlag('SV0','sent');clearTimeout(saveTimer);saveTimer=null;
        results.servicePatch=untouched===document.querySelector('[data-service-bulk-id="SV1"]')&&host===document.getElementById('serviceSearchResults');
      }finally{metrics.configurePerformance(false);metrics.clearPerformance()}
      return results;
    })()""",timeout=60)
    for count in [1000,5000]:
        for view in ['customers','service','warehouse']:
            result=domains[f'{count}:{view}']
            assert 0<result['rows']<=150,result
            assert not any(key.startswith('selector:compute:') for key in result['metrics']),result
            assert result['coldMs']<2500 and result['warmMs']<1000,result
        assert domains[f'{count}:page']['total']==count,domains
        assert domains[f'{count}:target'],domains
    assert domains['warm']['same'],domains
    assert not any(key.startswith('finance:compute:') or key.startswith('selector:compute:orders-finance') for key in domains['warm']['metrics']),domains
    assert domains['alerts']=={},domains
    assert domains['globalWarm']['metrics']=={},domains
    assert domains['servicePatch'],domains
    assert not browser.drain_serious_errors()
    print('PASS Orders domain models: 1k/5k, bounded DOM, pagination targets, unrelated mutation keeps warm supplier, alert hits, service patch;',json.dumps(domains))
    report['orders-domains']=domains

    status=browser.evaluate("""(async()=>{
      const {createFinanceStatusView}=await import('./assets/js/domains/finance/status-view.js');
      const host=document.createElement('div');document.body.appendChild(host);
      host.innerHTML='<div data-finance-command><input data-input="status-search" value=""></div><section id="ordersBankSyncPanel"><input id="status-draft" value="initial"></section>';
      const input=host.querySelector('#status-draft');input.value='unsaved draft';input.focus();input.setSelectionRange(2,5);
      let data={kupa:{},bank:{}},rendered=data,full=0,settle;
      const view=createFinanceStatusView({ui:{currentView:'kupa'},currentSection:()=> 'bank',snapshot:()=>data,controller:{readSnapshot:()=>data},renderedData:()=>rendered,renderKupa:()=>{full++;rendered=data},headerContextMarkup:()=>'<div data-finance-command><input data-input="status-search" value=""></div>',bankSyncPanelMarkup:()=>'<section id="ordersBankSyncPanel"><input id="status-draft" value="initial"></section>'});
      const task=view.refreshFinanceOperation('bank',()=>new Promise(resolve=>{settle=resolve}));settle(true);await task;
      const stable=full===0&&document.getElementById('status-draft')===input&&input.value==='unsaved draft'&&document.activeElement===input&&input.selectionStart===2;
      const search=host.querySelector('[data-input="status-search"]');search.value='typing';search.focus();search.setSelectionRange(1,3);
      await view.refreshFinanceOperation('bank',async()=>true);
      const searchStable=document.activeElement===search&&search.value==='typing'&&search.selectionStart===1;
      await view.refreshFinanceOperation('bank',async()=>{data={kupa:{updated:true},bank:{}}});
      host.remove();return {stable,searchStable,full};
    })()""")
    assert status=={'stable':True,'searchStable':True,'full':1},status
    print('PASS finance status: no data render for ACK, draft/focus preserved, authoritative replacement renders once')

# Keep CI observations as an artifact. A baseline must come from the same runner
# class; desktop timing is not a portable CI budget. Work-count gates above are
# mandatory even before a timing baseline is supplied.
output=ROOT/'.work/performance/latest.json'
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps(report,indent=2),encoding='utf-8')
baseline_path=os.environ.get('NETUNIM_PERFORMANCE_BASELINE')
if baseline_path:
    baseline=json.loads(Path(baseline_path).read_text(encoding='utf-8'))
    def compare(current,previous,path=''):
        for key,value in current.items():
            before=previous.get(key)
            if isinstance(value,dict) and isinstance(before,dict):
                compare(value,before,path+'.'+key)
            elif (key.endswith('Ms') or key=='ms') and isinstance(value,(int,float)) and isinstance(before,(int,float)):
                assert value<=max(before*1.5,before+75),f'Performance regression {path}.{key}: {value} ms vs {before} ms'
    compare(report,baseline)
