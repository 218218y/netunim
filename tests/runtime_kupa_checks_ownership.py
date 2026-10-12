"""Checks resource ownership against native timers and both retained IDB journals."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-kupa/site', 'kupa-checks-ownership') as browser:
    result = browser.evaluate(r"""(async()=>{
      await appReady;financeAutomation.stop();syncDocument.stopCloudPolling();
      session.connectionMode='file';session.backendReady=true;
      const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
      const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
      const note={id:'checks-ownership-note',content:'independent retained content'};
      state.notes.push(note);
      await storagePersistence.saveState('retain note',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
      await mainStorageV2.commitPromise;
      const record={id:'checks-ownership-record',name:'retained check',amount:41,dueDate:'2026-10-12',status:'בקופה',account:'עסקי',note:'exact original content'};
      state.checks.push(record);
      await checks.commands.saveLocal('retain check',{operations:[{type:'put',collection:'checks',id:record.id,mode:'insert',index:state.checks.length-1,record}]});
      checks.runtime.cancelPending();await checks.runtime.drain();
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
      const {createSharedChecksStorageV2}=await import('./assets/js/shared/shared-checks-storage-v2.js');
      const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:kupa'));
      const persist=sharedChecksV2.persist,backup=storageBackup.backupSnapshotToComputer,held=gate();
      let backups=0;
      sharedChecksV2.persist=(...args)=>{const receipt=persist(...args);return {...receipt,committed:receipt.committed.then(()=>held.promise)}};
      storageBackup.backupSnapshotToComputer=async()=>{backups++};files.backupsDirHandle={};
      const row=state.checks.find(item=>item.id===record.id);row.note='accepted durable edit';
      const saving=checks.commands.saveLocal('held append',{operations:[{type:'put',collection:'checks',id:row.id,mode:'replace',record:row}]});
      await sharedChecksV2.commitPromise;
      check(checks.runtime.isPending(),'the accepted receipt belongs to Checks runtime');
      checks.runtime.cancelPending();let drained=false;
      const drain=checks.runtime.drain().then(()=>{drained=true});await Promise.resolve();
      check(!drained,'quiescence waits for the accepted append receipt');
      held.resolve();check(await saving===true,'cancellation preserves the accepted durable append');await drain;
      await new Promise(resolve=>setTimeout(resolve,20));
      check(backups===0,'a cancelled receipt cannot create a later backup wakeup');
      check(!checks.runtime.isPending(),'drain leaves no pending Checks work');
      check(['sharedChecksSaveTimer','sharedChecksSavePromise','sharedChecksPullPromise'].every(key=>!Object.hasOwn(checksSession,key)),'context has no Checks resource handles');
      const sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
      check(checks.runtime.dispose()&&!checks.runtime.dispose(),'disposal is idempotent');
      checks.actions['mark-deposited']({dataset:{clickArg0:record.id}});
      check(row.status==='בקופה','a retained UI action cannot mutate after disposal');
      check(await checks.commands.saveLocal('closed')===false,'closed capability rejects new appends');
      await checks.runtime.drain();
      check(JSON.stringify(await db.load('local:kupa'))===mainBefore,'Checks lifecycle preserves the entire raw Main journal');
      check(JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'disposal preserves the entire accepted Shared journal');
      const main=createStorageV2Runtime({app:'kupa',owner:()=> 'local',primary:()=>false,mode:()=> 'primary',validate:()=>{}});
      const restoredMain=await main.recoverReadOnly();
      const shared=createSharedChecksStorageV2({owner:()=> 'local',primary:()=>false}),restoredShared=await shared.recoverReadOnly();
      check(restoredMain.state.notes.some(item=>item.id===note.id&&item.content===note.content),'a fresh reader retains the same independent note');
      check(restoredShared.state.checks.some(item=>item.id===record.id&&item.note==='accepted durable edit'&&item.amount===41&&item.status==='בקופה'),'a fresh reader retains the accepted check content');
      sharedChecksV2.persist=persist;storageBackup.backupSnapshotToComputer=backup;files.backupsDirHandle=null;
      return done;
    })()""")
    assert len(result) == 13, result
    errors=browser.drain_serious_errors()
    assert not errors, errors
    print('PASS Kupa Checks ownership: native resource lifecycle and retained journals', len(result))
