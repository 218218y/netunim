"""Actual backup owners with native OPFS targets, timers and retained IDB journals."""
import json
from browser_harness import BrowserSession, ROOT

for app in ('kupa','orders'):
    with BrowserSession(ROOT/f'netunim-{app}/site',f'{app}-automatic-backup-ownership') as browser:
        result=browser.evaluate(r"""(async()=>{
          await appReady;const app=APP,kupa=app==='kupa';
          if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling();session.connectionMode='file';session.backendReady=true}
          else{finance.runtime.stop();syncDocument.stopPolling()}
          const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
          const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
          const note={id:'backup-owner-note',content:'independent original content'};
          const record={id:'backup-owner-check',name:'retained check',amount:47,dueDate:'2026-10-12',status:'בקופה',account:'עסקי',note:'same original check'};
          state.notes.push(note);
          const options={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]};
          if(kupa)await storagePersistence.saveState('retained note',options);else storagePersistence.scheduleSave('retained note',options);
          await mainStorageV2.commitPromise;storagePersistence.runtime.cancelPending?.();await storagePersistence.runtime.drain();
          state.checks.push(record);
          const checkOptions={operations:[{type:'put',collection:'checks',id:record.id,mode:'insert',index:state.checks.length-1,record}]};
          if(kupa)await checks.commands.saveLocal('retained check',checkOptions);else checks.commands.scheduleSave('retained check',checkOptions);
          checks.runtime.cancelPending();await checks.runtime.drain();await sharedChecksV2.commitPromise;
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
          const {createSharedChecksStorageV2}=await import('./assets/js/shared/shared-checks-storage-v2.js');
          const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load('local:'+app)),sharedBefore=JSON.stringify(await db.load('local:shared-checks'));
          const root=await navigator.storage.getDirectory();
          const a=await root.getDirectoryHandle('backup-target-A',{create:true}),b=await root.getDirectoryHandle('backup-target-B',{create:true}),c=await root.getDirectoryHandle('backup-target-C',{create:true});
          const backupDir=async dir=>kupa?dir:dir.getDirectoryHandle('backups',{create:true});
          const targetKey=kupa?'backupsDirHandle':'dirHandle',writerKey=kupa?'writeJsonHandle':'writeTextHandle';
          const set=globalThis.setTimeout,clear=globalThis.clearTimeout,writer=storageFiles[writerKey],oldTarget=files[targetKey];
          const jobs=new Map(),callbacks=[];let entered=gate(),release=gate(),hold=false,corrupt=false;
          const payload={version:4,notes:[{id:note.id,content:'captured backup input'}]};
          const queue=kupa?storageBackup.queueAutomaticBackup:storageBackup.queueAutomaticFolderBackup;
          const save=kupa?storageBackup.maybeCreateAutomaticBackup:storageBackup.maybeCreateAutomaticFolderBackup;
          const list=async dir=>{const entries=[];for await(const [name] of dir.entries())entries.push(name);return entries};
          const protectedName='kupa-backup-protected.json',bdir=await backupDir(b),protectedFile=await bdir.getFileHandle(protectedName,{create:true});
          const protectedText=JSON.stringify({retained:'independent B backup'}),stream=await protectedFile.createWritable();await stream.write(protectedText);await stream.close();
          globalThis.setTimeout=(run,delay,...args)=>{const id=set(run,delay,...args);if(delay===1000){jobs.set(id,run);callbacks.push(run)}return id};
          globalThis.clearTimeout=id=>{jobs.delete(id);return clear(id)};
          storageFiles[writerKey]=async(handle,value)=>{
            if(hold){entered.resolve();await release.promise}
            await writer(handle,value);
            if(corrupt)await writer(handle,kupa?{corrupted:true}:JSON.stringify({corrupted:true}));
          };
          try{
            files[targetKey]=a;queue(payload,1000);check(jobs.size===1,'one native queued backup has one owned deadline');
            files[targetKey]=b;
            const [timer,run]=[...jobs.entries()][0];clear(timer);jobs.delete(timer);run();await storageBackup.runtime.drain();
            check((await list(bdir)).length===1&&await (await protectedFile.getFile()).text()===protectedText,'a delivered old-target callback cannot write into the new native folder');
            check((await list(await backupDir(a))).length===0,'an unstarted old-target backup is discarded');
            files[targetKey]=a;hold=true;entered=gate();release=gate();
            const accepted=save(payload);await entered.promise;payload.notes[0].content='mutation after capture';
            files[targetKey]=b;queue({version:4,notes:[{id:note.id,content:'new B obligation'}]},1000);
            release.resolve();const filename=await accepted;
            check(!!filename&&jobs.size===1,'an older native write cannot clear a newer queued backup');
            const afile=await (await backupDir(a)).getFileHandle(filename),written=JSON.parse(await (await afile.getFile()).text());
            check(written.notes[0].id===note.id&&written.notes[0].content==='captured backup input','started native writes retain the detached original snapshot and target');
            storageBackup.runtime.cancelPending();await storageBackup.runtime.drain();
            check(jobs.size===0,'quiescence cancels the newer native deadline');
            if(kupa){
              files[targetKey]=a;entered=gate();release=gate();corrupt=true;
              const failed=storageBackup.writeVerifiedBackup(protectedName,{version:4,notes:[]});await entered.promise;files[targetKey]=b;release.resolve();
              let rejected=false;try{await failed}catch(error){rejected=true}
              check(rejected&&!(await list(a)).includes(protectedName),'failed verification removes the originally allocated native backup');
              check(await (await protectedFile.getFile()).text()===protectedText,'failed verification preserves the independent same-named file in the newly selected folder');
              corrupt=false;
            }
            files[targetKey]=c;entered=gate();release=gate();
            const pending=save({version:4,notes:[{id:note.id,content:'accepted before disposal'}]});await entered.promise;
            check(storageBackup.runtime.dispose()&&!storageBackup.runtime.dispose(),'production backup disposal is idempotent');
            let drained=false;const drain=storageBackup.runtime.drain().then(()=>{drained=true});await Promise.resolve();check(!drained,'drain awaits the native file write already inside its writer');
            release.resolve();const finalName=await pending;await drain;
            const finalFile=await (await backupDir(c)).getFileHandle(finalName);
            check(JSON.parse(await (await finalFile.getFile()).text()).notes[0].content==='accepted before disposal','disposal preserves and verifies an accepted native file write');
            for(const stale of callbacks)stale();await storageBackup.runtime.drain();
            check(await save({})===null&&queue({},1000)===false&&jobs.size===0,'disposed commands and stale wakeups cannot submit another backup');
            check(['autoBackupTimer','pendingAutoBackupPayload'].every(key=>!Object.hasOwn(files,key))&&!Object.hasOwn(session,'startupLocalServicesPromise'),'state contexts contain no backup wakeup/payload or startup flight');
            check(JSON.stringify(await db.load('local:'+app))===mainBefore&&JSON.stringify(await db.load('local:shared-checks'))===sharedBefore,'backup resource lifecycle preserves exact Main and Shared IDB records');
            const fresh=createStorageV2Runtime({app,owner:()=> 'local',primary:()=>false,mode:()=> 'primary',validate:()=>{}}),recovered=await fresh.recoverReadOnly();
            const shared=createSharedChecksStorageV2({owner:()=> 'local',primary:()=>false}),recoveredShared=await shared.recoverReadOnly();
            check(recovered.state.notes.some(row=>row.id===note.id&&row.content===note.content),'fresh Main recovery retains the original note ID/content');
            check(recoveredShared.state.checks.some(row=>row.id===record.id&&row.note===record.note&&row.amount===47),'fresh Shared recovery retains the original check ID/content');
          }finally{
            release.resolve();storageBackup.runtime.dispose();globalThis.setTimeout=set;globalThis.clearTimeout=clear;storageFiles[writerKey]=writer;files[targetKey]=oldTarget;
          }
          return done;
        })()""".replace('APP',json.dumps(app)),timeout=40)
        assert not browser.drain_serious_errors()
        print(f'PASS {app} automatic backup owner: {len(result)} native file/timer and exact journal recovery assertions')
