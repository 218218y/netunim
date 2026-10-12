"""Production Bank actions/effects/disposal with native resources and retained IDB."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-kupa/site', 'kupa-bank-capability') as browser:
    result = browser.evaluate(r"""(async()=>{
      await appReady;financeAutomation.stop();syncDocument.stopCloudPolling();
      session.connectionMode='file';session.backendReady=true;
      const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
      const note={id:'bank-capability-note',content:'independent retained data'};state.notes.push(note);
      await storagePersistence.saveState('retained note',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
      await mainStorageV2.commitPromise;
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
      const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:kupa')),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
      localStorage.setItem('netunim_kupa_bank_bridge_token_v1','synthetic-pairing');
      const fetch=globalThis.fetch,create=URL.createObjectURL,revoke=URL.revokeObjectURL,element=document.createElement,click=HTMLAnchorElement.prototype.click;
      const set=globalThis.setTimeout,clear=globalThis.clearTimeout,toast=uiStatus.toast;
      const urls=new Set(),blobs=new Map(),anchors=[],callbacks=[],cleanupJobs=new Map();
      const entered=gate(),release=gate();let hold=false,fail=false,outcome=null,requests=0;
      URL.createObjectURL=blob=>{const url=create(blob);urls.add(url);blobs.set(url,blob);return url};
      URL.revokeObjectURL=url=>{urls.delete(url);blobs.delete(url);revoke(url)};
      document.createElement=function(tag,...args){const node=element.call(this,tag,...args);if(String(tag).toLowerCase()==='a')anchors.push(node);return node};
      HTMLAnchorElement.prototype.click=function(){if(fail)throw Error('injected native click failure')};
      globalThis.setTimeout=(run,delay,...args)=>{const id=set(run,delay,...args);if(delay===1000){cleanupJobs.set(id,run);callbacks.push(run)}return id};
      globalThis.clearTimeout=id=>{cleanupJobs.delete(id);return clear(id)};
      uiStatus.toast=message=>outcome?.resolve(message);
      globalThis.fetch=async(url)=>{
        check(new URL(String(url)).pathname==='/bank/diagnostics','only synthetic local diagnostic requests are made');requests++;
        if(hold){entered.resolve();await release.promise}
        return new Response(JSON.stringify({available:true,filename:'fixture.json',data:{version:1,fixture:'safe'},transactionCount:1}),{headers:{'Content-Type':'application/json'}});
      };
      try{
        fail=true;outcome=gate();
        uiActions['export-bank-cheque-diagnostics']({dataset:{}});
        check(await outcome.promise==='injected native click failure','the existing UI reports the original download failure');
        check(urls.size===0&&anchors.every(node=>!node.isConnected)&&cleanupJobs.size===0,'failed native download leaves no URL, anchor or cleanup deadline');
        fail=false;outcome=gate();uiActions['export-bank-cheque-diagnostics']({dataset:{}});await outcome.promise;
        const anchor=anchors.at(-1),payload=JSON.parse(await blobs.get(anchor.href).text());
        check(anchor.download==='fixture.json'&&payload.fixture==='safe','successful native JSON export retains filename and payload');
        check(urls.size===1&&cleanupJobs.size===1,'one successful export has one owned cleanup');
        hold=true;
        const pending=bank.commands.exportBankChequeDiagnostics();await entered.promise;
        uiActions['bank-search']({value:'retained',isConnected:true});
        const dom=document.getElementById('content').innerHTML;
        check(bank.runtime.dispose()===true&&bank.runtime.dispose()===false,'production Bank disposal is idempotent');
        check(urls.size===0&&anchors.every(node=>!node.isConnected)&&cleanupJobs.size===0,'disposal releases native pending download resources');
        let drained=false;const drain=bank.runtime.drain().then(()=>{drained=true});await Promise.resolve();check(!drained,'drain retains the started diagnostic request');
        release.resolve();check(await pending===false,'late diagnostic response cannot publish after disposal');await drain;
        for(const run of callbacks)run();await new Promise(resolve=>setTimeout(resolve,140));
        check(document.getElementById('content').innerHTML===dom,'cancelled search and late callbacks cannot repaint disposed Bank');
        const count=requests;
        check(uiActions['refresh-bank-from-hapoalim']({dataset:{}})===false&&uiActions['configure-bank-bridge']({dataset:{}})===false,'retained Bank actions are closed');
        check(uiActions['bank-search']({value:'closed'})===false&&ui.bankSearchValue==='retained','retained search cannot mutate disposed UI');
        check(await bank.commands.exportBankChequeDiagnostics()===false&&requests===count,'disposed commands cannot issue another Bridge request');
        check(JSON.stringify(await db.load('local:kupa'))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'resource cleanup preserves Main and Shared raw IDB records byte-for-byte');
        const fresh=createStorageV2Runtime({app:'kupa',owner:()=> 'local',primary:()=>true,mode:()=> 'primary',validate:()=>{}}),recovered=await fresh.recover();
        check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content),'fresh journal recovery retains the independent note ID/content');
      }finally{
        release.resolve();globalThis.fetch=fetch;URL.createObjectURL=create;URL.revokeObjectURL=revoke;document.createElement=element;HTMLAnchorElement.prototype.click=click;
        globalThis.setTimeout=set;globalThis.clearTimeout=clear;uiStatus.toast=toast;
      }
      return done;
    })()""", timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS production Kupa Bank capability: {len(result)} assertions for native download failure/disposal, closed actions and exact IDB recovery')
