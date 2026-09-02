import {clone} from '../core/values.js';
import {createOutboxRecord} from '../shared/cloud-sync.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncPending({session, prepareKupaCloudState, setSaveStatus, setCloudHeaderStatus, loadCloudPendingSync, persistCloudPendingSync, putCloudPending, lastSavedCloudState, getCloudPending, rebaseKupaCloudProgress}){
function stageCloudPendingLocal(snapshot,msg,baseRevision=session.dbRevision,baseState=null,generation=session.localGeneration,conflict=false,retry=undefined){
  const existing=loadCloudPendingSync(),sameSnapshot=!!existing&&JSON.stringify(existing.snapshot)===JSON.stringify(snapshot),base=existing?.baseState||baseState||lastSavedCloudState()||prepareKupaCloudState(snapshot),record=createOutboxRecord({
    domain:'kupa',documentName:session.cloudDocumentName,operationId:sameSnapshot?(existing.operationId||existing.id):undefined,
    generation:Math.max(Number(generation||0),Number(existing?.generation||0),1),baseRevision:Number(existing?.baseRevision??baseRevision??0),
    baseState:clone(base),snapshot:clone(snapshot),createdAt:existing?.createdAt||existing?.savedAt,updatedAt:new Date().toISOString(),
    conflict:conflict===true?{kind:'entity-conflict'}:(conflict||existing?.conflict||null),retry:retry===undefined?(sameSnapshot?existing?.retry:null):retry,
  });
  const cacheOk=persistCloudPendingSync(record),previous=session.cloudOutboxCommitPromise||Promise.resolve();
  session.cloudOutboxCommitPromise=previous.catch(()=>{}).then(()=>putCloudPending(record));
  session.cloudConflictPending=!!record.conflict;
  setSaveStatus(record.conflict?'התנגשות שמורה מקומית':navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית',cacheOk?'saving':'error');
  setCloudHeaderStatus(record.conflict?'conflict':navigator.onLine?'syncing':'offline',record.conflict?'ענן: התנגשות':navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');return record
}

async function rebaseNewerPending(completedGeneration,baseState,newRevision){const pending=await getCloudPending();if(!pending||Number(pending.generation||0)<=Number(completedGeneration||0))return false;const nextSnapshot=rebaseKupaCloudProgress(pending.baseState||baseState,pending.snapshot,baseState),next=createOutboxRecord({...pending,baseRevision:Number(newRevision||0),baseState:prepareKupaCloudState(baseState),snapshot:clone(nextSnapshot),updatedAt:new Date().toISOString(),conflict:pending.conflict||null});await putCloudPending(next);session.cloudConflictPending=!!next.conflict;return true}

return { stageCloudPendingLocal, rebaseNewerPending };
}
