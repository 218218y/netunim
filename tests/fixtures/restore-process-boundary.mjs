// Native IDB barriers let Python kill the real owned Chromium process after
// each durable paired-restore phase. No production module is patched.
export async function createRestoreProcessBoundary(app,{initialize=false,pauseAt=null}={}){
  const {createStorageJournal}=await import('./assets/js/shared/storage-journal.js');
  const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
  const {createStorageV2Boundary}=await import('./assets/js/shared/storage-v2-boundary.js');
  const {captureStorageV2RestoreSource,applyStorageV2RestoreGroup}=await import('./assets/js/shared/storage-v2-restore.js');
  const owner='restore-process-'+app,id='paired-process-restore';
  const db=createStorageJournalDb({name:owner});
  const main=createStorageJournal({owner:owner+':main',schema:{collections:['notes']},validate:()=>{},db});
  const checks=createStorageJournal({owner:owner+':shared',schema:{collections:['checks'],fields:['bankEvents']},validate:()=>{},db});
  if(initialize){
    await main.initializeCloudHead(8,{notes:[]});
    await checks.initializeCloudHead(11,{checks:[],bankEvents:[]});
  }else{await main.open();await checks.open()}
  async function barrier(phase){
    if(phase!==pauseAt)return;
    window.restoreProcessReached=phase;
    await new Promise(()=>{});
  }
  const faultDb={...db,
    async beginBoundary(...args){const result=await db.beginBoundary(...args);await barrier('prepared');return result},
    async advanceBoundary(...args){const result=await db.advanceBoundary(...args);await barrier(args[3]);return result},
  };
  const shared={...checks,resetCloudHead:(revision,state,{boundaryId}={})=>checks.resetCloudHead(revision,state,state,{appMetadata:{boundaryId}})};
  const boundary=createStorageV2Boundary({owner:()=>owner,primary:()=>true,main,shared,db:faultDb});
  async function state(){
    const view=async(journal,key)=>{const row=await journal.recover();if(!row)throw Error('restore_process_missing_journal '+JSON.stringify({key,databases:await indexedDB.databases(),stored:await db.load(key),boundary:await db.readBoundary(owner),origin:location.origin}));return {state:row.state,seq:row.seq,epoch:row.epoch,appMetadata:row.appMetadata,checkpointChecksum:row.stored.checkpoints.checksum}};
    return {main:await view(main,owner+':main'),shared:await view(checks,owner+':shared'),mainCloud:await main.cloudState(),sharedCloud:await checks.cloudState(),boundary:await db.readBoundary(owner)};
  }
  async function start(){
    const v2Source=captureStorageV2RestoreSource(await main.cloudState(),await checks.cloudState());
    const target={notes:[{id:'RESTORED',content:'paired restored note'}]},sharedState={checks:[{id:'RESTORED-CHECK',amount:123}],bankEvents:[]};
    return applyStorageV2RestoreGroup({boundary,group:{restoreGroupId:id,v2Source,main:{state:target},checks:{state:sharedState}},
      result:{main_revision:9,checks_revision:12},target,sharedState});
  }
  return {start,state,resume:()=>boundary.resume()};
}
