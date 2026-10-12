"""Main runtime quiescence with native timers, real IDB and fresh recovery."""
from browser_harness import BrowserSession, ROOT
import json

for app in ('kupa','orders'):
    with BrowserSession(ROOT/f'netunim-{app}/site', f'{app}-main-runtime-ownership') as browser:
        result=browser.evaluate(r"""(async()=>{
          await appReady;const app=APP,kupa=app==='kupa';
          if(kupa){financeAutomation.stop();syncDocument.stopCloudPolling()}else{finance.runtime.stop();syncDocument.stopPolling()}
          const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
          const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
          const note={id:'main-owner-note',content:'independent retained content'},record={id:'main-owner-check',name:'retained check',amount:37,dueDate:'2026-10-12',status:'בקופה',account:'עסקי',note:'same check content'};
          state.notes.push(note);
          const options={domains:['notes'],operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note}]};
          if(kupa){session.connectionMode='file';session.backendReady=true;await storagePersistence.saveState('retain note',options)}else storagePersistence.scheduleSave('retain note',options);
          await mainStorageV2.commitPromise;if(!kupa)storagePersistence.runtime.cancelPending();await storagePersistence.runtime.drain();
          state.checks.push(record);
          const checkOptions={operations:[{type:'put',collection:'checks',id:record.id,mode:'insert',index:state.checks.length-1,record}]};
          if(kupa)await checks.commands.saveLocal('retain check',checkOptions);else checks.commands.scheduleSave('retain check',checkOptions);
          checks.runtime.cancelPending();await checks.runtime.drain();await sharedChecksV2.commitPromise;
          const owner='main-runtime-owner';
          (kupa?cloudAuth.storeSupaSession:cloudAuth.saveSession)({user:{id:owner},access_token:'fixture',expires_at:9999999999});
          let mainHead=null,sharedHead=null;
          const writeMain=async snapshot=>{mainHead={revision:1,state:structuredClone(snapshot)};return {r:{ok:true},row:mainHead}};
          const writeShared=async rows=>{sharedHead={revision:1,state:{version:1,checks:structuredClone(rows),bankEvents:[]}};return {r:{ok:true},row:sharedHead}};
          if(kupa){
            cloudTransport.readSupabaseDocument=async()=>mainHead;cloudTransport.readSharedChecksDocument=async()=>sharedHead;
            syncDocument.rpcSaveCloudV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeShared;
            await storageV2Coordinator.ownerUiPorts().startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});
          }else{
            cloudTransport.readCloud=async()=>mainHead;cloudTransport.readSharedChecksCloud=async()=>sharedHead;
            cloudTransport.rpcSaveV2=writeMain;cloudTransport.rpcSaveSharedChecksV2=writeShared;
            await storageV2Coordinator.startStorageV2OwnerTransfer({targetOwner:owner,intent:'upload-local'});
          }
          session.connectionMode='supabase';session.backendReady=true;session.storageProtocolBlocked=false;
          const keys=await import('./assets/js/state/constants.js');
          localStorage.setItem(kupa?keys.SUPA_AUTO_KEY:keys.CLOUD_AUTO_KEY,'1');
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const {createStorageV2Runtime}=await import('./assets/js/shared/storage-v2-runtime.js');
          const {createSharedChecksStorageV2}=await import('./assets/js/shared/shared-checks-storage-v2.js');
          const db=createStorageJournalDb(),mainBefore=JSON.stringify(await db.load(owner+':'+app)),sharedBefore=JSON.stringify(await db.load(owner+':shared-checks'));
          const materialize=storageBrowser.materializeStorageV2CloudFlight,entered=gate(),release=gate();
          storageBrowser.materializeStorageV2CloudFlight=async(...args)=>{entered.resolve();await release.promise;return materialize(...args)};
          const save=syncDocument.requestStorageV2CloudSave('');await entered.promise;
          check(syncDocument.runtime.isPending(),'Main owns a held materialization before publication');
          let drained=false;const drain=syncDocument.quiesceForStorageCutover().then(()=>{drained=true});
          await Promise.resolve();await Promise.resolve();check(!drained,'cutover waits for held accepted Main work');
          release.resolve();check(await save===true,'accepted clean-head confirmation finishes after polling stops');await drain;
          storageBrowser.materializeStorageV2CloudFlight=materialize;
          check(!syncDocument.runtime.isPending(),'Main drain leaves no accepted operations');
          check(['saveQueue','cloudSavePromise','storageV2CloudSavePromise','cloudPollTimer','cloudRecoveryTimer','cloudRecoveryAttempt'].every(key=>!Object.hasOwn(session,key)),'state exposes no Main queue, flight or timer handles');
          const set=globalThis.setTimeout,clear=globalThis.clearTimeout,callbacks=[];
          globalThis.setTimeout=(run,delay,...args)=>{if(delay===15_000)callbacks.push(run);return set(run,delay,...args)};
          try{
            localStorage.setItem(kupa?keys.SUPA_AUTO_KEY:keys.CLOUD_AUTO_KEY,'1');
            check(uiCloud.recoveryRuntime.schedule(),'automatic recovery has one private wakeup');
            check(callbacks.length===1,'recovery preserves the native 15-second first delay');
            uiCloud.recoveryRuntime.cancel();callbacks[0]();await uiCloud.recoveryRuntime.drain();
            check(!uiCloud.recoveryRuntime.isPending(),'a delivered cancelled recovery callback cannot re-enter');
          }finally{globalThis.setTimeout=set;globalThis.clearTimeout=clear;uiCloud.recoveryRuntime.cancel()}
          check(JSON.stringify(await db.load(owner+':'+app))===mainBefore,'quiescence preserves the exact Main journal');
          check(JSON.stringify(await db.load(owner+':shared-checks'))===sharedBefore,'quiescence preserves the exact Shared journal');
          const freshMain=createStorageV2Runtime({app,owner:()=>owner,primary:()=>false,mode:()=> 'primary',validate:()=>{}}),restoredMain=await freshMain.recoverReadOnly();
          const freshShared=createSharedChecksStorageV2({owner:()=>owner,primary:()=>false}),restoredShared=await freshShared.recoverReadOnly();
          check(restoredMain.state.notes.some(row=>row.id===note.id&&row.content===note.content),'fresh Main recovery retains the original note');
          check(restoredShared.state.checks.some(row=>row.id===record.id&&row.note===record.note&&row.amount===37),'fresh Shared recovery retains the original check');
          return done;
        })()""".replace('APP',json.dumps(app)),timeout=40)
        assert not browser.drain_serious_errors()
        print(f'PASS {app} native Main runtime ownership: {len(result)} assertions for held saves, recovery cancellation and exact journal recovery')
