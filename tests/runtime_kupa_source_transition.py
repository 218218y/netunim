"""Production Kupa source switching with native OPFS and retained IDB journals."""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-kupa/site', 'kupa-source-transition') as browser:
    result = browser.evaluate(r"""(async()=>{
      await appReady;financeAutomation.stop();syncDocument.stopCloudPolling();
      const check=(ok,message)=>{if(!ok)throw Error(message)};
      const {payloadFromState}=await import('./assets/js/state/serialization.js');
      const {DATA_FILE,STORAGE_PREF_KEY}=await import('./assets/js/state/constants.js');
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
      const note={id:'source-transition-retained',content:'retained native note'};state.notes.push(note);
      await storagePersistence.saveState('source fixture',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
      await mainStorageV2.commitPromise;
      const opfs=await navigator.storage.getDirectory(),a=await opfs.getDirectoryHandle('source-A',{create:true}),b=await opfs.getDirectoryHandle('source-B',{create:true});
      const write=async(root,value)=>{const data=await root.getDirectoryHandle('data',{create:true}),file=await data.getFileHandle(DATA_FILE,{create:true});const stream=await file.createWritable();await stream.write(value);await stream.close();return file};
      await write(a,JSON.stringify(payloadFromState(state,7)));await uiFolders.connectDirectory(a);
      storageBackup.runtime.cancelPending();await storageBackup.runtime.drain();
      const db=createStorageJournalDb(),main=JSON.stringify(await db.load('local:kupa')),shared=JSON.stringify(await db.load('local:shared-checks'));
      const before={files:{...files},state:JSON.stringify(state),mode:session.connectionMode,revision:session.dbRevision,server:JSON.stringify(session.serverInfo),preference:localStorage.getItem(STORAGE_PREF_KEY)};
      const malformed=await write(b,'{broken native JSON');
      for(const operation of [()=>uiFolders.connectDirectory(b),()=>uiFolders.connectDataFile(malformed)]){
        let failed=false;try{await operation()}catch{failed=true}check(failed,'malformed candidate was accepted');
        for(const [key,value] of Object.entries(before.files))check(files[key]===value,'candidate replaced '+key+' before validation');
        check(JSON.stringify(state)===before.state&&session.connectionMode===before.mode&&session.dbRevision===before.revision&&JSON.stringify(session.serverInfo)===before.server,'candidate changed visible source state');
        check(localStorage.getItem(STORAGE_PREF_KEY)===before.preference,'candidate changed preference');
        check(await (await storageIndexedDb.getRememberedHandle()).isSameEntry(a),'failed candidate replaced remembered source');
        check(JSON.stringify(await db.load('local:kupa'))===main&&JSON.stringify(await db.load('local:shared-checks'))===shared,'failed candidate changed journal authority');
      }
      const replacement=normalizeState({...structuredClone(state),notes:[...state.notes,{id:'source-B-note',content:'accepted candidate'}]});
      await write(b,JSON.stringify(payloadFromState(replacement,12)));await uiFolders.connectDirectory(b);
      check(await files.rootDirHandle.isSameEntry(b),'successful candidate root missing');
      check(await files.backupRootDirHandle.isSameEntry(b),'successful backup root missing');
      check(session.dbRevision===12&&state.notes.some(row=>row.id==='source-B-note'),'accepted source state missing');
      const fresh=createStorageV2Runtime({app:'kupa',owner:()=> 'local',primary:()=>false,mode:()=> 'primary',validate:()=>{}});
      const recovered=await fresh.recoverReadOnly();check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content)&&recovered.state.notes.some(row=>row.id==='source-B-note'),'fresh journal recovery lost source notes');
      storageBackup.runtime.cancelPending();await storageBackup.runtime.drain();
      return {nativeFileFailure:true,sourceRetained:true,journalsRetained:true,pairedImport:true,freshRecovery:true};
    })()""", timeout=40)
    assert result and all(result.values()), result
    assert not browser.drain_serious_errors()
    print('PASS Kupa native source preparation, retained failure state and journal recovery', result)
