"""Production local V2 -> account V2 transfer with real browser IndexedDB."""
from browser_harness import BrowserSession, ROOT
from browser_legacy_write_guard import install_business_v1_write_guard


with BrowserSession(ROOT/'netunim-orders/site','orders-v2-owner-transfer',auto_navigate=False) as browser:
    install_business_v1_write_guard(browser)
    browser._navigate()
    result=browser.evaluate("""(async()=>{
      await appReady;
      if(!storageShadow.primaryReady||!sharedChecksV2.primaryReady)throw Error('local V2 birth missing');
      const note={id:'transfer-note',content:'durable local note'};
      state.notes.push(note);
      storagePersistence.scheduleSave('transfer fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}],surface:'test.owner-transfer'});
      await storageShadow.commitPromise;
      const check={id:'transfer-check',amount:123};state.checks.push(check);
      await sharedChecksV2.persist([{type:'put',collection:'checks',id:check.id,mode:'insert',index:state.checks.length-1,record:check}],{surface:'test.owner-transfer'}).committed;
      let main=null,checks=null;
      cloudAuth.loadSession=()=>({user:{id:'fixture-account'},access_token:'fixture'});
      cloudTransport.readCloud=async()=>main;
      cloudTransport.readSharedChecksCloud=async()=>checks;
      cloudTransport.rpcSave=async(snapshot,expectedRevision,operationId)=>{
        if(main||expectedRevision!==0)throw Error('unexpected Main overwrite');
        main={revision:1,state:structuredClone(snapshot),operationId};return {r:{ok:true},row:structuredClone(main)};
      };
      cloudTransport.rpcSaveV2=cloudTransport.rpcSave;
      cloudTransport.rpcSaveSharedChecks=async(rows,expectedRevision,operationId)=>{
        if(checks||expectedRevision!==0)throw Error('unexpected Shared overwrite');
        checks={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]},operationId};return {r:{ok:true},row:structuredClone(checks)};
      };
      cloudTransport.rpcSaveSharedChecksV2=cloudTransport.rpcSaveSharedChecks;
      const transfer=await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:'fixture-account',intent:'upload-local'});
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const marker=await createStorageJournalDb().readCutover('orders:fixture-account');
      return {owner:storageOwner.current(),revision:transfer.mainRevision,sharedRevision:transfer.sharedRevision,
        marker:marker?.version,mainNote:main?.state?.notes?.find(row=>row.id===note.id)?.content,
        sharedCheck:checks?.state?.checks?.find(row=>row.id===check.id)?.amount,
        visibleNote:state.notes.find(row=>row.id===note.id)?.content,visibleCheck:state.checks.find(row=>row.id===check.id)?.amount,
        legacyWrites:window.__legacyWrites};
    })()""",timeout=60)
    assert result=={'owner':'fixture-account','revision':1,'sharedRevision':1,'marker':2,
                    'mainNote':'durable local note','sharedCheck':123,
                    'visibleNote':'durable local note','visibleCheck':123,'legacyWrites':[]},result
    browser._navigate()
    recovered=browser.evaluate("""(async()=>{await appReady;return {
      owner:storageOwner.current(),note:state.notes.find(row=>row.id==='transfer-note')?.content,
      check:state.checks.find(row=>row.id==='transfer-check')?.amount,
      mainReady:storageShadow.primaryReady,sharedReady:sharedChecksV2.primaryReady,
      legacyWrites:window.__legacyWrites
    }})()""")
    assert recovered=={'owner':'fixture-account','note':'durable local note','check':123,'mainReady':True,'sharedReady':True,'legacyWrites':[]},recovered
    assert not browser.drain_serious_errors()
    print('PASS Orders production local V2 -> account V2 transfer with Main and Shared data after restart')


with BrowserSession(ROOT/'netunim-kupa/site','kupa-v2-owner-transfer',auto_navigate=False) as browser:
    install_business_v1_write_guard(browser)
    browser._navigate()
    result=browser.evaluate("""(async()=>{
      await appReady;
      if(!storageShadow.primaryReady||!sharedChecksV2.primaryReady)throw Error('local V2 birth missing');
      const note={id:'transfer-note',content:'durable local note'};
      state.notes.push(note);
      await storagePersistence.saveState('transfer fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}],surface:'test.owner-transfer'});
      await storageShadow.commitPromise;
      const check={id:'transfer-check',amount:123};state.checks.push(check);
      await sharedChecksV2.persist([{type:'put',collection:'checks',id:check.id,mode:'insert',index:state.checks.length-1,record:check}],{surface:'test.owner-transfer'}).committed;
      let main=null,checks=null;
      cloudAuth.loadSupaSession=()=>({user:{id:'fixture-account'},access_token:'fixture'});
      cloudTransport.readSupabaseDocument=async()=>main;
      cloudTransport.readSharedChecksDocument=async()=>checks;
      syncDocument.rpcSaveCloud=async(snapshot,expectedRevision,operationId)=>{
        if(main||expectedRevision!==0)throw Error('unexpected Main overwrite');
        main={revision:1,state:structuredClone(snapshot),operationId};return {r:{ok:true},row:structuredClone(main)};
      };
      syncDocument.rpcSaveCloudV2=syncDocument.rpcSaveCloud;
      cloudTransport.rpcSaveSharedChecks=async(rows,expectedRevision,operationId)=>{
        if(checks||expectedRevision!==0)throw Error('unexpected Shared overwrite');
        checks={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]},operationId};return {r:{ok:true},row:structuredClone(checks)};
      };
      cloudTransport.rpcSaveSharedChecksV2=cloudTransport.rpcSaveSharedChecks;
      const transfer=await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:'fixture-account',intent:'upload-local'});
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const marker=await createStorageJournalDb().readCutover('kupa:fixture-account');
      return {owner:storageOwner.current(),revision:transfer.mainRevision,sharedRevision:transfer.sharedRevision,
        marker:marker?.version,mainNote:main?.state?.notes?.find(row=>row.id===note.id)?.content,
        sharedCheck:checks?.state?.checks?.find(row=>row.id===check.id)?.amount,
        visibleNote:state.notes.find(row=>row.id===note.id)?.content,visibleCheck:state.checks.find(row=>row.id===check.id)?.amount,
        legacyWrites:window.__legacyWrites};
    })()""",timeout=60)
    assert result=={'owner':'fixture-account','revision':1,'sharedRevision':1,'marker':2,
                    'mainNote':'durable local note','sharedCheck':123,
                    'visibleNote':'durable local note','visibleCheck':123,'legacyWrites':[]},result
    browser._navigate()
    recovered=browser.evaluate("""(async()=>{await appReady;return {
      owner:storageOwner.current(),note:state.notes.find(row=>row.id==='transfer-note')?.content,
      check:state.checks.find(row=>row.id==='transfer-check')?.amount,
      mainReady:storageShadow.primaryReady,sharedReady:sharedChecksV2.primaryReady,
      legacyWrites:window.__legacyWrites
    }})()""")
    assert recovered=={'owner':'fixture-account','note':'durable local note','check':123,'mainReady':True,'sharedReady':True,'legacyWrites':[]},recovered
    assert not browser.drain_serious_errors()
    print('PASS Kupa production local V2 -> account V2 transfer with Main and Shared data after restart')
