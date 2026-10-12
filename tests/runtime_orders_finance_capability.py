"""Production Finance capability, native download resources and retained IDB data."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site', 'orders-finance-capability') as browser:
    result = browser.evaluate(r"""(async()=>{
      await appReady;syncDocument.stopPolling();finance.runtime.stop();
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
      const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
      const noop=()=>{},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
      const note={id:'finance-capability-retained',content:'independent durable content'};
      state.notes.push(note);
      scheduleSave('retained fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
      await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();
      const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:orders')),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
      localStorage.setItem('netunim_kupa_bank_bridge_token_v1','synthetic-download-fixture');
      const fetch=globalThis.fetch,createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL,createElement=document.createElement,click=HTMLAnchorElement.prototype.click;
      const set=globalThis.setTimeout,clear=globalThis.clearTimeout,toast=uiStatus.toast;
      const urls=new Set(),blobs=new Map(),anchors=[],callbacks=[],cleanupJobs=new Map(),calls=[];
      let failClick=false,outcome=null;
      URL.createObjectURL=blob=>{const url=createUrl(blob);urls.add(url);blobs.set(url,blob);return url};
      URL.revokeObjectURL=url=>{urls.delete(url);blobs.delete(url);revokeUrl(url)};
      document.createElement=function(tag,...args){const element=createElement.call(this,tag,...args);if(String(tag).toLowerCase()==='a')anchors.push(element);return element};
      HTMLAnchorElement.prototype.click=function(){if(failClick)throw Error('injected native click failure')};
      globalThis.setTimeout=(run,delay,...args)=>{const id=set(run,delay,...args);if(delay===1000){cleanupJobs.set(id,run);callbacks.push(run)}return id};
      globalThis.clearTimeout=id=>{cleanupJobs.delete(id);return clear(id)};
      uiStatus.toast=message=>outcome?.resolve(message);
      globalThis.fetch=async(url,options)=>{
        const path=new URL(String(url)).pathname;
        check(path==='/bank/diagnostics'||path==='/v2/credit/data-diagnostics','only synthetic local diagnostic requests are made');
        calls.push(path);
        return new Response(JSON.stringify({available:true,filename:'fixture.json',data:{version:1,fixture:'safe'},cardCount:1,transactionCount:1}),{headers:{'Content-Type':'application/json'}});
      };
      try{
        for(const kind of ['bank','credit']){
          failClick=true;outcome=gate();
          uiActions[kind==='bank'?'export-orders-bank-cheque-diagnostics':'export-orders-credit-data-diagnostics']({dataset:{}},{preventDefault:noop,stopPropagation:noop});
          check((await outcome.promise)==='injected native click failure',kind+': the original failure reaches the existing UI result');
          check(urls.size===0&&anchors.every(anchor=>!anchor.isConnected)&&cleanupJobs.size===0,kind+': failed click leaves no URL, anchor or cleanup timer');
        }
        failClick=false;
        for(const kind of ['bank','credit']){
          outcome=gate();
          uiActions[kind==='bank'?'export-orders-bank-cheque-diagnostics':'export-orders-credit-data-diagnostics']({dataset:{}},{preventDefault:noop,stopPropagation:noop});
          const message=await outcome.promise;
          check(!String(message).includes('failure'),kind+': successful synthetic export retains its normal UI outcome');
          const anchor=anchors.at(-1),payload=await blobs.get(anchor.href).text();
          check(anchor.download==='fixture.json'&&JSON.parse(payload).fixture==='safe',kind+': native Blob download preserves filename and JSON');
        }
        check(urls.size===2&&anchors.filter(anchor=>anchor.isConnected).length===2&&cleanupJobs.size===2,'successful exports have exactly two owned pending cleanups');
        check(finance.runtime.dispose()===true&&finance.runtime.dispose()===false,'production Finance disposal is idempotent');
        for(const run of callbacks)run();
        check(urls.size===0&&anchors.every(anchor=>!anchor.isConnected)&&cleanupJobs.size===0,'dispose cleans all resources and stale cleanup callbacks remain inert');
        const beforeCalls=calls.length;
        check(uiActions['refresh-orders-bank']({dataset:{}})===false&&uiActions['export-orders-credit-data-diagnostics']({dataset:{}})===false,'retained UI actions cannot enter disposed Finance');
        check(calls.length===beforeCalls,'disposed action cannot start another Bridge request');
        check(JSON.stringify(await db.load('local:orders'))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'Finance resource cleanup preserves independent Main and Shared IDB records byte-for-byte');
        const fresh=createStorageV2Runtime({app:'orders',owner:()=> 'local',primary:()=>true,mode:()=> 'primary',validate:noop});
        const recovered=await fresh.recover();
        check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content),'a fresh native journal runtime retains the original note ID/content');
      }finally{
        globalThis.fetch=fetch;URL.createObjectURL=createUrl;URL.revokeObjectURL=revokeUrl;document.createElement=createElement;HTMLAnchorElement.prototype.click=click;
        globalThis.setTimeout=set;globalThis.clearTimeout=clear;uiStatus.toast=toast;
      }
      return done;
    })()""", timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS production Orders Finance capability: {len(result)} assertions for native download failure/cleanup/disposal, closed actions and exact IDB recovery')
