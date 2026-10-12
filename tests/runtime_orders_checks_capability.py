"""Production Checks ownership, native timers, real journal retention and recovery."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site', 'orders-checks-capability') as browser:
    result = browser.evaluate(r"""(async()=>{
      await appReady;syncDocument.stopPolling();finance.runtime.stop();
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
      const {createSharedChecksV2Runtime}=await import('./assets/js/shared/shared-checks-v2-runtime.js');
      const {mergeSharedChecks}=await import('./assets/js/sync/checks-merge.js');
      const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
      const note={id:'checks-capability-note',content:'independent retained content'};
      state.notes.push(note);
      scheduleSave('retained note',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
      await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();
      const record={id:'checks-capability-record',name:'retained check',amount:25,dueDate:'2026-10-12',status:'בקופה',checkNumber:'73',note:'original content',account:'עסקי'};
      state.checks.push(record);
      checks.commands.scheduleSave('retained check',{operations:[{type:'put',collection:'checks',id:record.id,mode:'insert',index:state.checks.length-1,record}]});
      await sharedChecksV2.commitPromise;checks.runtime.cancelPending();await checks.runtime.drain();
      const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:orders')),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
      check(!Object.hasOwn(checksSession,'checksPullPromise')&&!Object.hasOwn(checksSession,'checksSavePromise'),'business context contains no Checks flight promises');
      check(checks.runtime.isPending()===false&&checksSession.checksCloudBusy===false,'owner and status agree after draining');
      let resolveConfirmation;const confirmation=new Promise(resolve=>{resolveConfirmation=resolve});
      const original=uiModal.confirmDialog;uiModal.confirmDialog=()=>confirmation;
      try{
        uiActions['delete-check']({dataset:{clickArg0:record.id}});
        uiActions['render-checks-search']({value:'retained',isConnected:true});
        check(ui.checkSearchValue==='retained','production search updates its query before the deferred render');
        const dom=document.getElementById('main').innerHTML;
        check(checks.runtime.dispose()===true&&checks.runtime.dispose()===false,'production Checks disposal is idempotent');
        resolveConfirmation(true);await new Promise(resolve=>setTimeout(resolve,140));
        check(state.checks.some(row=>row.id===record.id&&row.note===record.note),'late accepted confirmation cannot delete a retained check');
        check(document.getElementById('main').innerHTML===dom,'cancelled search and late confirmation cannot publish DOM after disposal');
        check(uiActions['mark-check-deposited']({dataset:{clickArg0:record.id}})===false,'retained mutating action is closed');
        check(uiActions['render-checks-search']({value:'closed'})===false&&ui.checkSearchValue==='retained','retained search action cannot change disposed state');
        check(await checks.commands.sync()===false&&await checks.commands.saveToCloud()===false,'disposed owner cannot start cloud work');
        await checks.runtime.drain();
        check(JSON.stringify(await db.load('local:orders'))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'resource disposal preserves independent Main and Shared journal records byte-for-byte');
        const freshMain=createStorageV2Runtime({app:'orders',owner:()=> 'local',primary:()=>true,mode:()=> 'primary',validate:()=>{}});
        const recovered=await freshMain.recover();
        check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content),'fresh Main recovery retains the same note identity and content');
        let sharedState;
        const freshShared=createSharedChecksV2Runtime({site:'orders',owner:()=> 'local',primary:()=>true,mode:()=> 'primary',
          readState:()=>({checks:[],bankEvents:[]}),applyState:next=>{sharedState=next},merge:mergeSharedChecks,
          readRemote:async()=>{throw Error('local recovery requested network')},rpc:async()=>{throw Error('local recovery attempted cloud write')}});
        await freshShared.recover();
        check(sharedState.checks.some(row=>row.id===record.id&&row.note===record.note&&row.status===record.status),'fresh Shared recovery retains the same check identity, content and status');
      }finally{uiModal.confirmDialog=original}
      return done;
    })()""", timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS production Orders Checks capability: {len(result)} assertions for ownership, disposal, native search/confirmation and exact IDB recovery')
