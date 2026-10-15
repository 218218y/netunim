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
