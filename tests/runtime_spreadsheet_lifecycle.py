"""Workbook connection lifecycle and atomic failures against Chromium IndexedDB."""
from browser_harness import BrowserSession, ROOT

for app in ['orders', 'kupa']:
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-workbook-lifecycle', instrument=False) as browser:
        result = browser.evaluate("""(async()=>{
          const {createSpreadsheetStore}=await import('./assets/js/shared/spreadsheet-store.js');
          const {createSpreadsheetSync}=await import('./assets/js/shared/spreadsheet-sync.js');
          let native,opens=0,fault=null;
          const factory={open(...args){
            opens++;const request=indexedDB.open(...args);
            request.addEventListener('success',()=>{
              native=request.result;const transaction=native.transaction.bind(native);
              native.transaction=(...args)=>{
                const tx=transaction(...args);
                if(args[1]==='readwrite'&&fault){
                  const kind=fault;fault=null;
                  const objectStore=tx.objectStore.bind(tx);
                  tx.objectStore=name=>{
                    const store=objectStore(name);
                    if(kind==='throw'&&name==='drafts')store.delete=()=>{throw new DOMException('quota','QuotaExceededError')};
                    if(kind==='abort'&&name==='documents'){
                      const put=store.put.bind(store);
                      store.put=(...values)=>{const r=put(...values);r.addEventListener('success',()=>tx.abort());return r};
                    }
                    return store;
                  };
                }
                return tx;
              };
            });return request;
          }};
          const store=createSpreadsheetStore({indexedDB:factory}),key='A:orders:main',patch={rowId:'r',columnId:'c',value:'draft'};
          await store.commit(key,{value:'before'});await store.journal(key,[patch]);
          native.close();
          let saved=await store.load(key);
          if(opens!==2||saved.record.value!=='before'||saved.drafts[0].value!=='draft')throw Error('close/reopen lost draft');
          native.close();native.dispatchEvent(new Event('close'));
          await store.load(key);if(opens!==3)throw Error('forced close did not invalidate cache');
          for(const kind of ['throw','abort']){
            fault=kind;let accepted=false;
            try{await store.commit(key,{value:kind});accepted=true}catch{}
            saved=await store.load(key);
            if(accepted||saved.record.value!=='before'||saved.drafts[0].value!=='draft')throw Error('partial write survived '+kind);
          }
          const sync=createSpreadsheetSync({domain:'orders',account:()=> 'A',enabled:()=>false,store});
          // A separate valid namespace tests the real sync's visible recovery state.
          await store.commit('A:orders:main',null);await store.commit('B:orders:main',null);
          await sync.open();const book=sync.model.state.notesSheet;
          book.rows.push({id:'r',sheetId:book.sheets[0].id,cells:{},createdAt:'',updatedAt:''});
          sync.changed(null);await sync.flush({send:false});
          book.rows[0].cells[book.columns[0].id]='recoverable';
          sync.changed({rowId:'r',columnId:book.columns[0].id,value:'recoverable',updatedAt:''});
          fault='throw';if(await sync.flush({send:false})!==false||sync.status!=='error')throw Error('failed save not visible');
          sync.pagehide();await new Promise(resolve=>setTimeout(resolve,20));
          const recovered=createSpreadsheetSync({domain:'orders',account:()=> 'A',enabled:()=>false,store});
          await recovered.open();
          if(recovered.model.state.notesSheet.rows[0].cells[book.columns[0].id]!=='recoverable')throw Error('failed save draft not recoverable');
          const beforeUpgrade=opens;
          const upgraded=await new Promise((resolve,reject)=>{const r=indexedDB.open('netunim-spreadsheets',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
          try{await store.load(key);throw Error('upgrade reused obsolete connection')}catch(error){if(error.message!=='indexed_db_reload_required')throw error}
          if(opens!==beforeUpgrade)throw Error('upgrade started an automatic reopen loop');
          upgraded.close();return true;
        })()""")
        assert result
        assert not browser.drain_serious_errors()
        print('PASS', app, 'workbook close/reopen, atomic abort/quota, visible recovery and versionchange', flush=True)
