"""Search/summary parity through actual input, filter, year and edit events."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site', 'supplier-search') as browser:
    result = browser.evaluate("""(async()=>{
      state=normalizeState({suppliers:[{id:'S',name:'Office Supplier',active:true}],transactions:[
        {id:'A',supplierId:'S',sequence:1,action:'Office Supplies',debit:100,note:'ציוד',supplied:false,yearEnd:2025},
        {id:'B',supplierId:'S',sequence:2,action:'Other Goods',debit:20,supplied:false},
      ]});
      const head=await mainStorageV2.cloudState();
      await mainStorageV2.replaceLocalAuthoritativeState(state,{boundaryId:'supplier-search-fixture',expectedSeq:head.seq});
      currentSupplierId='S';currentView='supplier';supplierYearView='all';filterMode='all';searchText='';renderSupplier();
      const visible=()=>[...document.querySelectorAll('tbody tr[data-tx-id]')].filter(row=>!row.hidden).map(row=>row.dataset.txId);
      const summary=()=>document.querySelector('[data-supplier-summary="debit"]').textContent;
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const query=async value=>{
        const input=document.querySelector('.supplier-search');input.value=value;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        const deadline=performance.now()+2000;
        do{await frame()}while(searchText!==value&&performance.now()<deadline);
        if(searchText!==value)throw Error('deferred input did not commit');
        return JSON.stringify({rows:visible(),summary:summary()});
      };
      // Single-supplier search excludes the supplier's own name, as does its DOM index.
      const reference=await query('office');
      if(JSON.parse(reference).rows.join()!=='A')throw Error('lowercase search failed: '+reference+' '+document.querySelector('.supplier-year-select')?.value+' '+JSON.stringify([...document.querySelectorAll('tbody tr[data-tx-id]')].map(row=>({id:row.dataset.txId,search:row.dataset.search,hidden:row.hidden}))));
      if(!summary().includes('100'))throw Error('summary includes a hidden row');
      for(const value of ['Office','OFFICE',' office '])if(await query(value)!==reference)throw Error('case/summary mismatch');
      const filter=document.querySelector('[data-action="filter-mode-2"]');filter.click();await frame();
      if(await query('OFFICE')!==reference)throw Error('filter rerender changed search');
      const year=document.querySelector('.supplier-year-select');year.value='2025';year.dispatchEvent(new Event('change',{bubbles:true}));await frame();
      if(await query('office')!==reference)throw Error('year rerender changed search');
      const note=document.querySelector('tr[data-tx-id="A"] .col-note input');
      await query('ציוד');note.value='English NOTE';note.dispatchEvent(new Event('blur',{bubbles:true}));await frame();
      if(visible().length)throw Error('edited search index is stale');
      if(await query('english')!==await query('ENGLISH')||visible().join()!=='A')throw Error('edited note search/summary mismatch');
      const resetYear=document.querySelector('.supplier-year-select');resetYear.value='all';resetYear.dispatchEvent(new Event('change',{bubbles:true}));await frame();
      await query('');if(visible().length!==2)throw Error('empty query did not restore rows');
      const input=document.querySelector('.supplier-search');input.value='office';input.dispatchEvent(new Event('input',{bubbles:true}));
      if(state.transactions[0].action!=='Office Supplies'||state.transactions[0].note!=='English NOTE')throw Error('search changed business data');
      await mainStorageV2.flush();return true;
    })()""")
    assert result is True
    assert not browser.drain_serious_errors()
    print('PASS supplier search case/summary parity, Hebrew, filter/year rerenders, edited rows and empty input')
    bounded = browser.evaluate("""(async()=>{
      await new Promise(resolve=>setTimeout(resolve,150));
      state=normalizeState({suppliers:[{id:'S',name:'Loaded search',active:true}],
        transactions:Array.from({length:1000},(_,i)=>({id:'L'+i,supplierId:'S',sequence:i+1,
          action:i===999?'TARGET-END':'ordinary row '+i,debit:1,credit:0,note:''}))});
      currentSupplierId='S';currentView='supplier';supplierYearView='all';filterMode='all';searchText='';
      renderSupplier();
      const before=JSON.stringify(state),input=document.querySelector('.supplier-search');input.focus();
      const table=document.querySelector('.supplier-data-table'),head=table.tHead;
      let hiddenWrites=0;
      const observer=new MutationObserver(records=>{hiddenWrites+=records.length});
      observer.observe(table,{attributes:true,subtree:true,attributeFilter:['hidden']});
      const query=async value=>{
        input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
        const deadline=performance.now()+3000;
        while(searchText!==value&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
        if(searchText!==value)throw Error('loaded input did not settle');
      };
      await query('TARGET-END');
      const rows=()=>[...document.querySelectorAll('.supplier-data-table tbody tr[data-tx-id]')];
      if(rows().length!==1||rows()[0].dataset.txId!=='L999')throw Error('search retained unmatched DOM rows');
      const match=rows()[0];
      await query('target-end');
      if(rows()[0]!==match)throw Error('equivalent query replaced a surviving result row');
      if(document.activeElement!==input||document.querySelector('.supplier-data-table')!==table||table.tHead!==head)
        throw Error('search replaced its editor or surrounding table');
      observer.disconnect();
      toggleSupplierBulkMode();
      document.getElementById('supplierBulkAll').checked=true;
      document.getElementById('supplierBulkAll').dispatchEvent(new Event('change',{bubbles:true}));
      if([...supplierBulkSelected].join()!=='L999')throw Error('filtered bulk selection included an unmatched row');
      toggleSupplierBulkMode();
      // The toolbar can change for bulk mode, so use the owning presentation
      // command for the remaining read-only result transitions.
      filterSupplierSearch('');
      if(rows().length!==1000)throw Error('clearing search lost transactions');
      filterSupplierSearch('no-such-transaction');
      if(rows().length)throw Error('empty search kept transaction rows');
      observer.disconnect();
      if(hiddenWrites)throw Error('search wrote hidden on unmatched rows: '+hiddenWrites);
      if(JSON.stringify(state)!==before)throw Error('presentation changed business data');
      return {rows:1000,matched:1,hiddenWrites,cleared:true,bulk:true,stableEditor:true};
    })()""", timeout=30)
    assert bounded['hiddenWrites'] == 0 and bounded['cleared'] and bounded['bulk'], bounded
    assert not browser.drain_serious_errors()
    print('PASS loaded supplier search projects matching rows, stable editor, full clear/empty/bulk parity;', bounded)
