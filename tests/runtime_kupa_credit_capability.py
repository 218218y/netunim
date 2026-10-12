"""Production Credit actions/effects/disposal with native resources and retained IDB."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-kupa/site', 'kupa-credit-capability') as browser:
    result = browser.evaluate(r"""(async()=>{
      await appReady;financeAutomation.stop();syncDocument.stopCloudPolling();
      session.connectionMode='file';session.backendReady=true;
      const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)},gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
      const note={id:'credit-capability-note',content:'independent retained data'};state.notes.push(note);
      await storagePersistence.saveState('retained note',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
      await mainStorageV2.commitPromise;
      const record={id:'credit-capability-check',name:'retained check',amount:43,dueDate:'2026-10-12',status:'\u05d1\u05e7\u05d5\u05e4\u05d4',account:'\u05e2\u05e1\u05e7\u05d9',note:'same original content'};
      state.checks.push(record);
      await checks.commands.saveLocal('retain check',{operations:[{type:'put',collection:'checks',id:record.id,mode:'insert',index:state.checks.length-1,record}]});
      checks.runtime.cancelPending();await checks.runtime.drain();
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
      const {createSharedChecksStorageV2}=await import('./assets/js/shared/shared-checks-storage-v2.js');
      const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:kupa')),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
      localStorage.setItem('netunim_kupa_bank_bridge_token_v1','synthetic-pairing');
      const fetch=globalThis.fetch,create=URL.createObjectURL,revoke=URL.revokeObjectURL,element=document.createElement,click=HTMLAnchorElement.prototype.click;
      const set=globalThis.setTimeout,clear=globalThis.clearTimeout,toast=uiStatus.toast,modal=uiModal.modal;
      const forms=[],connections=[];
      uiModal.modal=(...args)=>{forms.push(args[3]);return modal(...args)};
      const urls=new Set(),blobs=new Map(),anchors=[],callbacks=[],cleanupJobs=new Map();
      const entered=gate(),release=gate();let hold=false,fail=false,outcome=null,requests=0;
      URL.createObjectURL=blob=>{const url=create(blob);urls.add(url);blobs.set(url,blob);return url};
      URL.revokeObjectURL=url=>{urls.delete(url);blobs.delete(url);revoke(url)};
      document.createElement=function(tag,...args){const node=element.call(this,tag,...args);if(String(tag).toLowerCase()==='a')anchors.push(node);return node};
      HTMLAnchorElement.prototype.click=function(){if(fail)throw Error('injected native click failure')};
      globalThis.setTimeout=(run,delay,...args)=>{const id=set(run,delay,...args);if(delay===1000){cleanupJobs.set(id,run);callbacks.push(run)}return id};
      globalThis.clearTimeout=id=>{cleanupJobs.delete(id);return clear(id)};
      uiStatus.toast=message=>outcome?.resolve(message);
      globalThis.fetch=async(url,options)=>{
        const path=new URL(String(url)).pathname;
        check(['/v2/credit/data-diagnostics','/v2/credit/profiles','/v2/credit/status'].includes(path),'only synthetic local Credit requests are made');requests++;
        if(path==='/v2/credit/profiles'){connections.push(JSON.parse(options.body));return new Response('{}')}
        if(path==='/v2/credit/status')return new Response(JSON.stringify({bridgeVersion:73,contractVersion:2,profiles:[]}));
        if(hold){entered.resolve();await release.promise}
        return new Response(JSON.stringify({available:true,filename:'fixture.json',data:{version:1,fixture:'safe'},cardCount:1}),{headers:{'Content-Type':'application/json'}});
      };
      try{
        credit.commands.openCreditConnectionModal();const first=forms.at(-1),oldSelect=document.getElementById('ccProvider');
        credit.commands.openCreditConnectionModal();const second=forms.at(-1);
        document.getElementById('ccProvider').value='amex';document.getElementById('ccProvider').dispatchEvent(new Event('change'));
        document.getElementById('ccId').value='001234567';document.getElementById('ccCard6').value='001234';document.getElementById('ccPassword').value=' secret ';
        check(await first()===false&&connections.length===0,'a replaced native form cannot submit a newer form');
        oldSelect.value='max';oldSelect.dispatchEvent(new Event('change'));
        check(!document.querySelector('.cc-id').hidden,'a replaced form listener cannot change the current provider fields');
        await second();
        check(connections.length===1&&connections[0].provider==='amex'&&connections[0].id==='001234567'&&connections[0].card6Digits==='001234'&&connections[0].password===' secret ','actual local Bridge wire input retains leading zeros and password spaces');
        check(await second()===false&&connections.length===1,'a closed native modal cannot resubmit its retained save callback');
        uiNavigation.setPage('credit');await credit.runtime.drain();
        check(ui.currentPage==='credit'&&document.getElementById('creditSyncPanel'),'actual Credit navigation uses the capability render and wakeup ports');
        uiActions['open-credit-card-order']();
        check(document.getElementById('creditCardOrderList'),'Credit capability owns the actual card-order dialog');
        uiModal.closeModal(true);
        credit.commands.openCreditConnectionModal();const retainedForm=forms.at(-1);
        fail=true;outcome=gate();
        uiActions['export-credit-data-diagnostics']({dataset:{}});
        check(await outcome.promise==='injected native click failure','the existing UI reports the original download failure');
        check(urls.size===0&&anchors.every(node=>!node.isConnected)&&cleanupJobs.size===0,'failed native download leaves no URL, anchor or cleanup deadline');
        fail=false;outcome=gate();uiActions['export-credit-data-diagnostics']({dataset:{}});await outcome.promise;
        const anchor=anchors.at(-1),payload=JSON.parse(await blobs.get(anchor.href).text());
        check(anchor.download==='fixture.json'&&payload.fixture==='safe','successful native JSON export retains filename and payload');
        check(urls.size===1&&cleanupJobs.size===1,'one successful export has one owned cleanup');
        hold=true;
        const pending=credit.commands.exportCreditDataDiagnostics();await entered.promise;
        uiActions['credit-search']({value:'retained',isConnected:true});
        const dom=document.getElementById('content').innerHTML;
        check(credit.runtime.dispose()===true&&credit.runtime.dispose()===false,'production Credit disposal is idempotent');
        check(await retainedForm()===false&&connections.length===1,'a retained native form cannot submit after Credit disposal');
        check(urls.size===0&&anchors.every(node=>!node.isConnected)&&cleanupJobs.size===0,'disposal releases native pending download resources');
        let drained=false;const drain=credit.runtime.drain().then(()=>{drained=true});await Promise.resolve();check(!drained,'drain retains the started diagnostic request');
        release.resolve();check(await pending===false,'late diagnostic response cannot publish after disposal');await drain;
        for(const run of callbacks)run();await new Promise(resolve=>setTimeout(resolve,140));
        check(document.getElementById('content').innerHTML===dom,'cancelled search and late callbacks cannot repaint disposed Credit');
        const count=requests;
        check(uiActions['refresh-credit-sync']({dataset:{}})===false&&uiActions['open-credit-connection']({dataset:{}})===false,'retained Credit actions are closed');
        check(uiActions['credit-search']({value:'closed'})===false&&ui.creditSearchValue==='retained','retained search cannot mutate disposed UI');
        check(await credit.commands.exportCreditDataDiagnostics()===false&&requests===count,'disposed commands cannot issue another Bridge request');
        check(uiActions['open-credit-card-order']()===false&&uiActions['credit-card-order-save']()===false,'retained card-order actions close with the Credit capability');
        check(JSON.stringify(await db.load('local:kupa'))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'resource cleanup preserves Main and Shared raw IDB records byte-for-byte');
        const fresh=createStorageV2Runtime({app:'kupa',owner:()=> 'local',primary:()=>false,mode:()=> 'primary',validate:()=>{}}),recovered=await fresh.recoverReadOnly();
        check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content),'fresh journal recovery retains the independent note ID/content');
        const shared=createSharedChecksStorageV2({owner:()=> 'local',primary:()=>false}),recoveredShared=await shared.recoverReadOnly();
        check(recoveredShared.state.checks.some(row=>row.id===record.id&&row.note===record.note&&row.amount===43),'fresh Shared recovery retains the original check ID/content');
      }finally{
        release.resolve();globalThis.fetch=fetch;URL.createObjectURL=create;URL.revokeObjectURL=revoke;document.createElement=element;HTMLAnchorElement.prototype.click=click;
        globalThis.setTimeout=set;globalThis.clearTimeout=clear;uiStatus.toast=toast;uiModal.modal=modal;
      }
      return done;
    })()""", timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS production Kupa Credit capability: {len(result)} assertions for native download failure/disposal, closed actions and exact IDB recovery')
