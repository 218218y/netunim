import {createDebouncedTask} from '../shared/debounced-task.js';

// Owns Shared Checks appends and their follow-ups. Main has a separate writer.
export function createChecksPersistence({
  sharedChecksV2,checksSession,session,model,files,tab,checksStatus,
  loadSession=()=>null,domainRevisions,showSecondaryTabGuard,setSaveStatus,
  normalizeState,backupSnapshotToComputer,saveSharedChecksToCloud,timers=globalThis,
  isOnline=()=>globalThis.navigator?.onLine!==false,
}){
  let disposed=false,followupEpoch=0;
  const pending=new Set();
  const cloudTask=createDebouncedTask({delay:220,timers,onError:error=>console.error('checks sync',error)});
  const backupTask=createDebouncedTask({delay:0,timers,onError:error=>console.error('checks backup',error)});
  function track(work){
    const tracked=Promise.resolve(work).finally(()=>pending.delete(tracked));
    pending.add(tracked);
    return tracked;
  }
  const runtime={
    isPending:()=>pending.size>0||cloudTask.isPending()||backupTask.isPending(),
    cancelPending(){followupEpoch++;const cloud=cloudTask.cancel(),backup=backupTask.cancel();return cloud||backup},
    async drain(){
      do{
        while(pending.size)await Promise.allSettled([...pending]);
        await Promise.all([cloudTask.drain(),backupTask.drain()]);
      }while(pending.size);
    },
    dispose(){
      if(disposed)return false;
      disposed=true;cloudTask.dispose();backupTask.dispose();return true;
    },
  };

  function saveChecksState(msg='הצק נשמר',{deletedIds=[],mutationType='autosave',surface='kupa.checks',operations=null}={}){
    if(disposed)return Promise.resolve(false);
    if(!tab.primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
    const risk=token=>(session.localUndurableGenerations??=new Set()).add(token);
    if(!sharedChecksV2?.requested){
      risk(`checks:${Number(checksSession.sharedChecksGeneration||0)+1}`);
      setSaveStatus('Shared Checks V2 is required before saving checks','error');
      return Promise.resolve(false);
    }
    if(typeof checksStatus?.save!=='function'||typeof checksStatus?.cloud!=='function')throw new Error('shared_checks_status_port_required');
    const account=loadSession()?.user?.id;
    const cloudCurrent=()=>!disposed&&!!account&&loadSession()?.user?.id===account&&session.connectionMode==='supabase'&&session.backendReady&&sharedChecksV2.cloudReady;
    const failed=()=>{
      if(disposed)return;
      checksStatus.save('הצקים לא נשמרו — אין לסגור את החלון','error');
      if(cloudCurrent())checksStatus.cloud('conflict','ענן: שמירת הצ׳קים נעצרה — אחסון מקומי נכשל');
    };
    const generation=Number(checksSession.sharedChecksGeneration||0)+1,riskToken=`checks:${generation}`;
    const epoch=followupEpoch;
    let write;
    domainRevisions?.touch('checks');
    try{write=sharedChecksV2.persist(operations,{generation,surface,mutationType,deleteIds:deletedIds})}
    catch(error){risk(riskToken);failed();console.error('Shared Checks V2 save',error);return Promise.resolve(false)}
    checksSession.sharedChecksGeneration=generation;checksSession.sharedChecksSaveRequested=true;
    if(cloudCurrent())checksStatus.cloud(isOnline()?'syncing':'offline',isOnline()?'ענן: צ׳קים ממתינים לסנכרון':'ענן: אופליין');
    if(!write.emergencyDurable)risk(riskToken);
    checksStatus.save(write.emergencyDurable?'הצקים שמורים מקומית':'ממתין לאישור שמירת הצקים ב־IndexedDB','saving');
    // Disposal never cancels an accepted journal append or hides its failure.
    const committed=track(write.committed.then(()=>{
      session.localUndurableGenerations?.delete(riskToken);
      if(!disposed&&epoch===followupEpoch&&files.backupsDirHandle)backupTask.schedule(()=>backupSnapshotToComputer(normalizeState(model.state),session.dbRevision));
      return true;
    },()=>{failed();return false}));
    cloudTask.cancel();
    if(session.connectionMode==='supabase'&&session.backendReady){
      cloudTask.schedule(async()=>{
        if(await committed&&!disposed&&epoch===followupEpoch)await saveSharedChecksToCloud(msg);
      });
    }
    return committed;
  }
  return {saveChecksState,runtime};
}
