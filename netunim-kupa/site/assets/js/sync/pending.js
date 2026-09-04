import {clone} from '../core/values.js';
import {createOutboxRecord,outboxRetryForGeneration} from '../shared/cloud-sync.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncPending({session, prepareKupaCloudState, setSaveStatus, setCloudHeaderStatus, loadCloudPendingSync, persistCloudPendingSync, putCloudPending, lastSavedCloudState, getCloudPending, rebaseKupaCloudProgress}){
function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}
function mergeDeleteIntents(...values){const out={};for(const value of values){for(const [key,ids] of Object.entries(normalizeDeleteIntents(value))){out[key]=[...new Set([...(out[key]||[]),...ids])].sort()}}return out}
function stageCloudPendingLocal(snapshot,msg,baseRevision=session.dbRevision,baseState=null,generation=session.localGeneration,conflict=false,retry=undefined,deleteIntents=undefined,metadata={}){
  const existing=loadCloudPendingSync(),nextGeneration=Math.max(Number(generation||0),Number(existing?.generation||0),1),sameGeneration=!!existing&&Number(existing.generation||0)===nextGeneration,base=existing?.baseState||baseState||lastSavedCloudState()||prepareKupaCloudState(snapshot),record=createOutboxRecord({
    domain:'kupa',documentName:session.cloudDocumentName,operationId:sameGeneration?(existing.operationId||existing.id):undefined,
    generation:nextGeneration,mutationSeq:Math.max(Number(existing?.mutationSeq||existing?.commitSeq||existing?.generation||0)+1,nextGeneration),baseRevision:Number(existing?.baseRevision??baseRevision??0),
    baseState:clone(base),snapshot:clone(snapshot),createdAt:existing?.createdAt||existing?.savedAt,updatedAt:new Date().toISOString(),
    conflict:conflict===true?{kind:'entity-conflict'}:(conflict||existing?.conflict||null),retry:outboxRetryForGeneration(existing,{sameGeneration,retry}),mutationType:metadata?.mutationType||existing?.mutationType||'autosave',surface:metadata?.surface||existing?.surface||'kupa',restoreGroupId:metadata?.restoreGroupId||existing?.restoreGroupId||null,
  });
  record.deleteIntents=mergeDeleteIntents(existing?.deleteIntents,deleteIntents);
  const cacheOk=persistCloudPendingSync(record),previous=session.cloudOutboxCommitPromise||Promise.resolve();
  session.cloudOutboxCommitPromise=previous.catch(()=>{}).then(()=>putCloudPending(record));
  session.cloudConflictPending=!!record.conflict;
  setSaveStatus(record.conflict?'התנגשות שמורה מקומית':navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית',cacheOk?'saving':'error');
  setCloudHeaderStatus(record.conflict?'conflict':navigator.onLine?'syncing':'offline',record.conflict?'ענן: התנגשות':navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');return record
}

async function rebaseNewerPending(completedGeneration,baseState,newRevision){const pending=await getCloudPending();if(!pending||Number(pending.generation||0)<=Number(completedGeneration||0))return false;const nextSnapshot=rebaseKupaCloudProgress(pending.baseState||baseState,pending.snapshot,baseState,{deleteIntents:pending.deleteIntents||{}}),next=createOutboxRecord({...pending,mutationSeq:Number(pending.mutationSeq||pending.generation||0)+1,baseRevision:Number(newRevision||0),baseState:prepareKupaCloudState(baseState),snapshot:clone(nextSnapshot),updatedAt:new Date().toISOString(),conflict:pending.conflict||null});next.deleteIntents=normalizeDeleteIntents(pending.deleteIntents);await putCloudPending(next);session.cloudConflictPending=!!next.conflict;return true}

return { stageCloudPendingLocal, rebaseNewerPending };
}
