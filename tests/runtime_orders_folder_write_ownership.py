"""Production folder writer with native OPFS streams and exact retained IDB heads.

Only permission responses and stream-close timing are controlled; file creation,
contents, backup verification and recovery use the actual browser implementations.
"""
from browser_harness import BrowserSession, ROOT

with BrowserSession(ROOT/'netunim-orders/site','orders-folder-write-ownership') as browser:
    result=browser.evaluate(r"""(async()=>{
      await appReady;finance.runtime.stop();syncDocument.stopPolling();
      const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
      const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
      const note={id:'folder-owner-note',content:'original retained note'};
      const record={id:'folder-owner-check',name:'retained check',amount:47,dueDate:'2026-10-12',status:'בקופה',account:'עסקי',note:'original retained check'};
      state.notes.push(note);
      storagePersistence.scheduleSave('retained note',{domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]});
      await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending();await storagePersistence.runtime.drain();
      state.checks.push(record);checks.commands.scheduleSave('retained check',{operations:[{type:'put',collection:'checks',id:record.id,mode:'insert',index:state.checks.length-1,record}]});
      checks.runtime.cancelPending();await checks.runtime.drain();await sharedChecksV2.commitPromise;
      const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
      const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
      const {createSharedChecksStorageV2}=await import('./assets/js/shared/shared-checks-storage-v2.js');
      const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:orders')),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
      const root=await navigator.storage.getDirectory();
      const a=await root.getDirectoryHandle('working-target-A',{create:true}),b=await root.getDirectoryHandle('working-target-B',{create:true});
      const bdata=await b.getDirectoryHandle('data',{create:true}),protectedFile=await bdata.getFileHandle('orders-data.json',{create:true});
      const protectedText=JSON.stringify({version:4,businessName:'independent B',notes:[{id:'B-note',content:'independent B content'}]});
      const stream=await protectedFile.createWritable();await stream.write(protectedText);await stream.close();
      const payload=name=>({version:4,businessName:name,notes:[{id:note.id,content:name}]});
      const contents=async file=>JSON.parse(await (await file.getFile()).text());
      const names=async dir=>{const entries=[];for await(const [name] of dir.entries())entries.push(name);return entries};
      let query=async()=> 'granted',hold=false,entered=gate(),release=gate(),calls=0,active=0,maxActive=0;
      const target={queryPermission:()=>query(),requestPermission:async()=> 'granted',
        getDirectoryHandle:async(name,options)=>{
          const dir=await a.getDirectoryHandle(name,options);if(name!=='data')return dir;
          return {getFileHandle:async(filename,fileOptions)=>{
            const file=await dir.getFileHandle(filename,fileOptions);
            return {getFile:()=>file.getFile(),createWritable:async()=>{
              const writable=await file.createWritable();calls++;active++;maxActive=Math.max(maxActive,active);
              return {write:value=>writable.write(value),close:async()=>{
                if(hold){entered.resolve();await release.promise}
                await writable.close();active--;
              }};
            }};
          }};
        }};
      const targetB={queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getDirectoryHandle:(...args)=>b.getDirectoryHandle(...args)};
      const toast=uiStatus.toast,toasts=[];uiStatus.toast=message=>toasts.push(message);
      try{
        storageFiles.selectDirectory(target);const permissionEntered=gate(),permissionRelease=gate();
        query=()=>{permissionEntered.resolve();return permissionRelease.promise};
        const stale=storageFiles.writeStateSnapshotToFolder(payload('old A'),true);await permissionEntered.promise;
        storageFiles.selectDirectory(targetB);files.dirPermission='prompt';permissionRelease.resolve('granted');
        check(await stale===false&&files.dirPermission==='prompt','a held old permission cannot grant the newly selected folder');
        check(await (await protectedFile.getFile()).text()===protectedText&&(await names(b)).join(',')==='data','old preflight preserves the independent native B file and creates no backup');
        storageFiles.selectDirectory(target);const uiEntered=gate(),uiRelease=gate();query=()=>{uiEntered.resolve();return uiRelease.promise};
        const oldUi=uiFolders.backupToFolder();await uiEntered.promise;storageFiles.selectDirectory(targetB);files.dirPermission='prompt';uiRelease.resolve('granted');await oldUi;
        check(!toasts.length&&calls===0&&files.dirPermission==='prompt','production folder UI suppresses old completion and never writes the newer selection');
        query=async()=> 'granted';storageFiles.selectDirectory(target);hold=true;entered=gate();release=gate();
        const input=payload('detached A input'),accepted=storageFiles.writeStateSnapshotToFolder(input,true);await entered.promise;
        input.businessName='mutated caller input';storageFiles.selectDirectory(targetB);files.dirPermission='prompt';hold=false;release.resolve();
        check(await accepted===true,'a started native working-file stream finishes after folder replacement');
        const adata=await a.getDirectoryHandle('data'),afile=await adata.getFileHandle('orders-data.json'),abackups=await a.getDirectoryHandle('backups');
        check((await contents(afile)).businessName==='detached A input','native working-file verification uses the detached submission input');
        const backupNames=(await names(abackups)).filter(name=>name.startsWith('orders-backup_'));
        check(backupNames.length===1&&(await contents(await abackups.getFileHandle(backupNames[0]))).businessName==='detached A input','the forced safety copy stays in the original native target');
        check(await (await protectedFile.getFile()).text()===protectedText&&files.dirPermission==='prompt','old stream completion cannot overwrite B contents or permission status');
        storageFiles.selectDirectory(target);await storageFiles.refreshDirPermission();hold=true;entered=gate();release=gate();const before=calls;
        const mirror=storageFiles.writeStateToFolder();await entered.promise;
        const safety=storageFiles.writeStateSnapshotToFolder(payload('explicit restore safety'),true);
        for(let i=0;i<35;i++)await Promise.resolve();check(calls===before+1,'explicit restore snapshot waits behind the native mirror stream');
        hold=false;release.resolve();check((await Promise.all([mirror,safety])).every(Boolean),'both serialized working-file receipts complete');await storageFiles.runtime.drain();
        storageBackup.runtime.cancelPending();await storageBackup.runtime.drain();
        check(maxActive===1&&(await contents(afile)).businessName==='explicit restore safety','native working-file streams never overlap and retain the final FIFO snapshot');
        const heldQueryEntered=gate(),heldQueryRelease=gate();query=()=>{heldQueryEntered.resolve();return heldQueryRelease.promise};files.dirPermission='prompt';
        const oldSelection=storageFiles.captureSelection(),permission=storageFiles.refreshDirPermission();await heldQueryEntered.promise;
        storageFiles.runtime.cancelPending();let drained=false;const permissionDrain=storageFiles.runtime.drain().then(()=>{drained=true});
        await Promise.resolve();check(!drained&&!oldSelection(),'quiescence invalidates UI completion and awaits accepted permission preflight');
        heldQueryRelease.resolve('granted');check(await permission===false,'a pre-quiescence permission result is discarded');await permissionDrain;
        check(files.dirPermission==='prompt','discarded preflight leaves permission status unchanged');
        query=async()=> 'granted';hold=true;entered=gate();release=gate();
        const final=storageFiles.writeStateSnapshotToFolder(payload('accepted before disposal'),true);await entered.promise;
        check(storageFiles.runtime.dispose()&&!storageFiles.runtime.dispose(),'working-file disposal is idempotent');
        drained=false;const finalDrain=storageFiles.runtime.drain().then(()=>{drained=true});await Promise.resolve();check(!drained,'disposal drain awaits an already started native stream');
        hold=false;release.resolve();check(await final===true,'disposal completes verification and safety backup of accepted file work');await finalDrain;
        check((await contents(afile)).businessName==='accepted before disposal'&&await storageFiles.writeStateSnapshotToFolder(payload('late'))===false,'closed writer preserves accepted contents and rejects late commands');
        check(['folderWritePrepared','folderWritePending','folderForceBackupPending','folderWritePromise'].every(key=>!Object.hasOwn(files,key)),'context holds no file preparation/queue/promise resources');
        check(JSON.stringify(await db.load('local:orders'))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'file ownership lifecycle leaves exact Main and Shared IDB records unchanged');
        const fresh=createStorageV2Runtime({app:'orders',owner:()=> 'local',primary:()=>false,mode:()=> 'primary',validate:()=>{}}),recovered=await fresh.recoverReadOnly();
        const shared=createSharedChecksStorageV2({owner:()=> 'local',primary:()=>false}),recoveredShared=await shared.recoverReadOnly();
        check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content),'fresh Main recovery retains original note ID/content');
        check(recoveredShared.state.checks.some(row=>row.id===record.id&&row.note===record.note&&row.amount===47),'fresh Shared recovery retains original check ID/content');
      }finally{hold=false;release.resolve();storageFiles.runtime.dispose();storageBackup.runtime.cancelPending();await storageBackup.runtime.drain();uiStatus.toast=toast}
      return done;
    })()""",timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS Orders working-file ownership: {len(result)} native file and exact journal recovery assertions')
