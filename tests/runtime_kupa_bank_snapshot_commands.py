"""Production file-mode Bank commands own native Main durability without cloud writers."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-kupa/site','bank-file-snapshot-commands') as browser:
    result=browser.evaluate(r"""(async()=>{
      await appReady;financeAutomation.stop();syncDocument.stopCloudPolling();
      session.connectionMode='file';session.backendReady=true;
      const check=(ok,label)=>{if(!ok)throw Error(label)},stamp='2026-10-13T10:00:00.000Z';
      const note={id:'bank-command-note',content:'independent durable note',createdAt:stamp,updatedAt:stamp};state.notes.push(note);
      state.bank={...state.bank,currentBalance:100,source:'manual'};
      await storagePersistence.saveState('Bank command baseline',{domains:['notes','bank'],operations:[
        {type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note},
        {type:'set',field:'bank',value:state.bank},
      ]});await mainStorageV2.commitPromise;
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js'),db=createStorageJournalDb();
      const before=await db.load('local:kupa'),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
      const {payloadFromState}=await import('./assets/js/state/serialization.js');let file=JSON.stringify(payloadFromState(state,session.dbRevision));
      files.dataFileHandle={name:'synthetic-bank.json',getFile:async()=>({text:async()=>file}),createWritable:async()=>({write:async value=>{file=value},close:async()=>{}})};
      const originalFetch=globalThis.fetch;let patches=0,atomics=0,scans=0;
      cloudTransport.saveFinancePatch=()=>{patches++;throw Error('file mode invoked authenticated Finance writer')};
      cloudTransport.saveBankSyncSnapshot=()=>{atomics++;throw Error('file mode invoked atomic cloud writer')};
      localStorage.setItem('netunim_kupa_bank_bridge_token_v1','synthetic-pairing');
      globalThis.fetch=(url,options)=>{
        if(String(url).endsWith('/status'))return Promise.resolve(new Response(JSON.stringify({ok:true,bridgeVersion:74,configured:true})));
        if(String(url).includes('/balance')){scans++;return Promise.resolve(new Response(JSON.stringify({ok:true,fetchedAt:stamp,accounts:{business:{balance:500,accountId:'synthetic-account',transactions:[{id:'retained-bank-row',date:stamp,amount:12,description:'native fixture'}]}}})))}
        return originalFetch(url,options);
      };
      try{
        const saved=await bank.commands.refreshBankBalance();
        check(patches===0&&atomics===0,'file Bank attempted an authenticated cloud write');
        check(saved===true,'file Bank snapshot was not confirmed locally');
        const after=await db.load('local:kupa'),recovered=await mainStorageV2.recoverReadOnly();
        check(after.metadata.seq===before.metadata.seq+1,'file Bank did not commit one local operation');
        check(recovered.state.bank.currentBalance===500&&recovered.state.bank.feed.transactions[0].id==='retained-bank-row','local journal lost Bank identity or balance');
        check(recovered.state.notes.find(row=>row.id===note.id)?.content===note.content,'Bank save changed independent note');
        check(JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'file Bank changed Shared journal');
        check(scans===1,'file Bank repeated the provider scan');
        return {localDurability:true,cloudWritesAbsent:true,bankIdentityRetained:true,noteRetained:true,sharedRetained:true};
      }finally{globalThis.fetch=originalFetch;financeAutomation.stop()}
    })()""",timeout=45)
    assert result and all(result.values()),result
    assert not browser.drain_serious_errors()
    print('PASS production Bank file snapshot commands: '+str(result))
