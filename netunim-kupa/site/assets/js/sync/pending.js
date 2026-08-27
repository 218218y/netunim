import {clone} from '../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncPending({session, prepareKupaCloudState, setSaveStatus, setCloudHeaderStatus, loadCloudPendingSync, persistCloudPendingSync, putCloudPending, lastSavedCloudState, getCloudPending, rebaseKupaCloudProgress}){
function stageCloudPendingLocal(snapshot,msg,baseRevision=session.dbRevision,baseState=null,generation=session.localGeneration,conflict=false){
  const existing=loadCloudPendingSync(),base=existing?.baseState||baseState||lastSavedCloudState()||prepareKupaCloudState(snapshot),record={schemaVersion:2,id:existing?.id||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,documentName:session.cloudDocumentName,generation:Math.max(Number(generation||0),Number(existing?.generation||0)),baseRevision:Number(existing?.baseRevision??baseRevision??0),baseState:clone(base),snapshot:clone(snapshot),msg:msg||existing?.msg||'שינויים ממתינים',savedAt:new Date().toISOString(),conflict:!!(conflict||existing?.conflict)};
  persistCloudPendingSync(record);putCloudPending(record).catch(e=>console.error('pending mirror',e));session.cloudConflictPending=record.conflict;
  setSaveStatus(record.conflict?'התנגשות שמורה מקומית':navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');
  setCloudHeaderStatus(record.conflict?'conflict':navigator.onLine?'syncing':'offline',record.conflict?'ענן: התנגשות':navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');return record
}

async function rebaseNewerPending(completedGeneration,baseState,newRevision){const pending=await getCloudPending();if(!pending||Number(pending.generation||0)<=Number(completedGeneration||0))return false;const nextSnapshot=rebaseKupaCloudProgress(pending.baseState||baseState,pending.snapshot,baseState);const next={...pending,baseRevision:Number(newRevision||0),baseState:prepareKupaCloudState(baseState),snapshot:clone(nextSnapshot),savedAt:new Date().toISOString(),conflict:!!pending.conflict};await putCloudPending(next);session.cloudConflictPending=next.conflict;return true}

return { stageCloudPendingLocal, rebaseNewerPending };
}
