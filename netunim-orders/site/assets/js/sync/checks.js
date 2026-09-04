import {mergeArray, eq} from './merge-records.js';
import {normalizeSharedChecks, normalizeSharedBankEvents} from '../domains/checks/model.js';
import {clone} from '../core/values.js';
import {CLOUD_WRITE_POLICY,cloudWriteError,contentionDelay,createOutboxRetryScheduler,normalizeCloudError,operationAuditMetadata,runBusyCloudWriteWithPolicy} from '../shared/cloud-sync.js';

function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncChecks({model, files, checksSession, tab, localSnapshot, persistChecksBase, markChecksPending, getChecksPending, clearChecksPending, toast, recomputeKupaNetFromCache, renderKupaDependentView, queueSharedChecksSave, writeStateToFolder, loadSession, readSharedChecksCloud, checksPendingExists, rpcSaveSharedChecks, checksHaveLocalWork, readSharedChecksCloudMeta, refreshCloudTimestamp}){
const outboxRetryScheduler=createOutboxRetryScheduler();
function normalizeDeleteIds(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort()}
function protectImplicitDeletes(base,local,deleteIds){const allowed=new Set(normalizeDeleteIds(deleteIds)),safe=normalizeSharedChecks(local||[]),present=new Set(safe.map(x=>x.id));for(const item of normalizeSharedChecks(base||[])){if(item?.id&&!present.has(item.id)&&!allowed.has(item.id)){safe.push(clone(item));present.add(item.id)}}return safe}
function effectiveDeletedIds(remote,merged,deleteIds){const allowed=new Set(normalizeDeleteIds(deleteIds)),kept=new Set(normalizeSharedChecks(merged||[]).map(x=>x.id));return normalizeSharedChecks(remote||[]).map(x=>x.id).filter(id=>allowed.has(id)&&!kept.has(id)).sort()}
function checksAudit(pending,before,after,baseRevision,deletedIds){return operationAuditMetadata({site:'orders',mutationType:pending?.mutationType||'autosave',surface:pending?.surface||'orders.checks',baseRevision,beforeState:{checks:before},afterState:{checks:after},collections:['checks'],deleteCount:deletedIds.length,restoreGroupId:pending?.restoreGroupId})}
function mergeSharedChecks(base,local,remote,{deleteIds=[]}={}){const conflicts=[],b=normalizeSharedChecks(base||[]),r=normalizeSharedChecks(remote||[]),safeLocal=protectImplicitDeletes(b,local,deleteIds),checks=mergeArray(b,safeLocal,r,'id',conflicts,'check');return {checks:normalizeSharedChecks(checks),conflicts}}
function mergeSharedChecksPreferLocal(base,local,remote,{deleteIds=[]}={}){const conflicts=[],b=normalizeSharedChecks(base||[]),r=normalizeSharedChecks(remote||[]),safeLocal=protectImplicitDeletes(b,local,deleteIds),checks=mergeArray(b,safeLocal,r,'id',conflicts,'check',true);return{checks:normalizeSharedChecks(checks),conflicts}}

async function mirrorChecksLocally(){localSnapshot();try{if(files.dirHandle)await writeStateToFolder()}catch(error){console.error('checks local mirror',error)}}

async function syncSharedChecksFromCloud({quiet=false,required=false}={}){
  if(!loadSession()||checksSession.checksCloudBusy||!navigator.onLine)return false;
  const deferred=await getChecksPending();if(deferred&&outboxRetryScheduler.schedule(deferred,()=>saveSharedChecksToCloud(checksSession.checksSaveMessage||checksSession.sharedChecksSaveMessage))>0){checksSession.checksSaveRequested=false;checksSession.checksCloudLastError='הצקים ממתינים למועד הסנכרון שהשרת קבע';if(!quiet)renderKupaDependentView();return false}
  checksSession.checksCloudBusy=true;
  try{
    const row=await readSharedChecksCloud();
    if(!row){const error=new Error('מאגר הצ\'קים המשותף חסר. יש להשלים cutover תקין.');checksSession.checksCloudLastError=error.message;if(required)throw error;if(!quiet)renderKupaDependentView();return false}
    const outbox=await getChecksPending(),remote=normalizeSharedChecks(row.state?.checks||[]),local=normalizeSharedChecks(outbox?.snapshot||model.state.checks),base=normalizeSharedChecks(outbox?.baseState||checksSession.checksCloudBase||local);
    if(!checksSession.checksCloudBase&&!outbox&&local.length&&!eq(local,remote)){markChecksPending(local,'bootstrap-conflict',{kind:'missing-base'});throw new Error('נמצאו צ\'קים מקומיים ללא גרסת בסיס. שום נתון לא נדרס.')}
    const merged=mergeSharedChecks(base,local,remote,{deleteIds:outbox?.deleteIds});
    if(merged.conflicts.length){markChecksPending(local,'merge-conflict',{kind:'entity-conflict',items:merged.conflicts});throw new Error('הצ\'קים לא נדרסו: אותו צ\'ק שונה במקביל.')}
    model.state.checks=clone(merged.checks);checksSession.checksBankEvents=normalizeSharedBankEvents(row.state.bankEvents);recomputeKupaNetFromCache();
    checksSession.checksCloudBase=clone(remote);persistChecksBase(remote,checksSession.checksBankEvents);checksSession.checksCloudRevision=Number(row.revision||0);checksSession.checksCloudUpdatedAt=row.updated_at||checksSession.checksCloudUpdatedAt;checksSession.checksCloudLastError='';
    await mirrorChecksLocally();
    if(!eq(merged.checks,remote)){checksSession.checksGeneration=Math.max(checksSession.checksGeneration,Number(outbox?.generation||0))+1;markChecksPending(merged.checks,'merged-local',undefined,{deleteIds:outbox?.deleteIds||[]});checksSession.checksSaveRequested=true;queueSharedChecksSave('שינויי הצ\'קים המקומיים מוזגו לענן')}else if(outbox){const cleared=await clearChecksPending(outbox.generation);if(cleared)checksSession.checksSaveRequested=false;else{const latest=await getChecksPending();checksSession.checksSaveRequested=Number(latest?.generation||0)>Number(outbox.generation||0);if(!checksSession.checksSaveRequested)checksSession.checksCloudLastError='הצקים אושרו בענן; ניקוי האחסון המקומי ממתין להתאוששות'}}
    refreshCloudTimestamp();if(!quiet)renderKupaDependentView();return true;
  }catch(error){console.error('shared checks pull',error);checksSession.checksCloudLastError=error.message||String(error);if(required)throw error;if(!quiet){toast(error.message);renderKupaDependentView()}return false}
  finally{checksSession.checksCloudBusy=false;if(checksSession.checksSaveRequested)setTimeout(()=>saveSharedChecksToCloud(checksSession.checksSaveMessage||checksSession.sharedChecksSaveMessage),0)}
}

async function saveSharedChecksToCloud(message='הצ\'קים סונכרנו'){
  if(!tab.primaryTab)return false;checksSession.checksSaveRequested=true;checksSession.checksSaveMessage=message||checksSession.checksSaveMessage;
  if(!loadSession()||!navigator.onLine){markChecksPending(model.state.checks,message);try{await checksSession.checksOutboxCommitPromise}catch(error){console.error('checks outbox offline commit',error)}if(checksSession.checksDurabilityDegraded)checksSession.checksCloudLastError='IndexedDB אינו זמין; הצקים נשמרו במצב תאימות מקומי';return false}
  if(checksSession.checksCloudBusy)return checksSession.checksSavePromise||false;
  if(checksSession.checksSavePromise)return checksSession.checksSavePromise;
  clearTimeout(checksSession.sharedChecksSaveTimer);checksSession.sharedChecksSaveTimer=null;
  checksSession.checksSavePromise=(async()=>{
    let allOk=true;
    while(checksSession.checksSaveRequested&&loadSession()&&navigator.onLine){
      checksSession.checksSaveRequested=false;const msg=checksSession.checksSaveMessage||message;checksSession.checksSaveMessage='';
      let pending=await getChecksPending();if(!pending){markChecksPending(model.state.checks,msg);pending=await getChecksPending()}if(!pending)throw new Error('checks_outbox_persistence_failed');
      const retryDelay=outboxRetryScheduler.schedule(pending,()=>saveSharedChecksToCloud(msg));if(retryDelay>0){checksSession.checksCloudLastError='הצקים ממתינים למועד הסנכרון שהשרת קבע';allOk=false;renderKupaDependentView();break}
      const generation=Number(pending.generation),local=normalizeSharedChecks(pending.snapshot),base=normalizeSharedChecks(pending.baseState);checksSession.checksCloudBusy=true;
      try{
        let row=await readSharedChecksCloud();if(!row)throw new Error('מאגר הצ\'קים המשותף חסר.');
        let savedChecks=null,savedRevision=Number(row.revision||0),savedUpdatedAt=row.updated_at||checksSession.checksCloudUpdatedAt;
        for(let conflictAttempt=0;conflictAttempt<CLOUD_WRITE_POLICY.conflictAttempts&&!savedChecks;conflictAttempt++){
          const remote=normalizeSharedChecks(row.state?.checks||[]),merged=mergeSharedChecks(base,local,remote,{deleteIds:pending.deleteIds});
          if(merged.conflicts.length){markChecksPending(local,msg,{kind:'entity-conflict',items:merged.conflicts});checksSession.checksCloudLastError='אותו צ\'ק שונה במקביל';allOk=false;break}
          const deletedIds=effectiveDeletedIds(remote,merged.checks,pending.deleteIds),expected=Number(row.revision||0),result=await runBusyCloudWriteWithPolicy(()=>rpcSaveSharedChecks(merged.checks,expected,pending.operationId,deletedIds,checksAudit(pending,remote,merged.checks,expected,deletedIds)));
          if(result?.r?.ok){savedChecks=normalizeSharedChecks(result.row?.state?.checks||merged.checks);checksSession.checksBankEvents=normalizeSharedBankEvents(result.row?.state?.bankEvents||row.state.bankEvents);savedRevision=Number(result.row?.revision||Number(row.revision||0)+1);savedUpdatedAt=result.row?.updated_at||row.updated_at||savedUpdatedAt;break}
          const normalized=normalizeCloudError(result);
          if(normalized.kind==='revision_conflict'){await contentionBackoff(conflictAttempt);row=await readSharedChecksCloud();if(!row)throw new Error('shared_checks_missing_during_merge');continue}
          if(normalized.kind==='busy')throw new Error('save_busy');
          throw cloudWriteError(result,'שמירת הצ\'קים המשותפים נכשלה');
        }
        if(!savedChecks){allOk=false;break}
        outboxRetryScheduler.cancel();checksSession.checksCloudBase=clone(savedChecks);persistChecksBase(savedChecks,checksSession.checksBankEvents);checksSession.checksCloudRevision=savedRevision;checksSession.checksCloudUpdatedAt=savedUpdatedAt;checksSession.checksCloudLastError='';
        const newest=await getChecksPending();
        if(Number(newest?.generation||0)===generation){model.state.checks=clone(savedChecks);recomputeKupaNetFromCache();const cleared=await clearChecksPending(generation);if(!cleared){const latest=await getChecksPending();if(Number(latest?.generation||0)>generation)checksSession.checksSaveRequested=true;else{checksSession.checksCloudLastError='השינוי אושר בענן; ניקוי האחסון המקומי ממתין להתאוששות';allOk=false}}}
        else if(newest){const rebased=mergeSharedChecksPreferLocal(local,normalizeSharedChecks(newest.snapshot),savedChecks,{deleteIds:newest.deleteIds});model.state.checks=clone(rebased.checks);checksSession.checksCloudBase=clone(savedChecks);checksSession.checksCloudRevision=savedRevision;markChecksPending(rebased.checks,msg,undefined,{deleteIds:newest.deleteIds||[]});checksSession.checksSaveRequested=true}
        await mirrorChecksLocally();refreshCloudTimestamp();renderKupaDependentView();if(!checksSession.checksSaveRequested&&!checksPendingExists()&&msg)toast(msg);
      }catch(error){console.error('shared checks save',error);checksSession.checksCloudLastError=error.message||String(error);const current=await getChecksPending(),normalized=normalizeCloudError(error),attempts=Number(current?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null;markChecksPending(model.state.checks,msg,undefined,{retry:{attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt}});const retryPending=await getChecksPending();if(retryPending)outboxRetryScheduler.schedule(retryPending,()=>saveSharedChecksToCloud(msg));allOk=false;renderKupaDependentView();break}
      finally{checksSession.checksCloudBusy=false}
    }
    return allOk&&!checksPendingExists();
  })().finally(()=>{checksSession.checksSavePromise=null;if(checksSession.checksSaveRequested&&navigator.onLine&&!checksSession.checksCloudBusy)setTimeout(()=>saveSharedChecksToCloud(checksSession.checksSaveMessage||checksSession.sharedChecksSaveMessage),0)});
  return checksSession.checksSavePromise;
}

async function pollSharedChecks(){
  if(!tab.primaryTab||!loadSession()||checksSession.checksCloudBusy||!navigator.onLine)return;
  if(checksHaveLocalWork()){await saveSharedChecksToCloud('שינויי הצ\'קים סונכרנו');return}
  checksSession.checksCloudBusy=true;
  try{const meta=await readSharedChecksCloudMeta();if(!meta||Number(meta.revision||0)<=checksSession.checksCloudRevision)return;const row=await readSharedChecksCloud();if(!row||Number(row.revision||0)<=checksSession.checksCloudRevision)return;const remote=normalizeSharedChecks(row.state?.checks||[]);model.state.checks=clone(remote);checksSession.checksBankEvents=normalizeSharedBankEvents(row.state?.bankEvents);recomputeKupaNetFromCache();checksSession.checksCloudBase=clone(remote);persistChecksBase(remote,checksSession.checksBankEvents);checksSession.checksCloudRevision=Number(row.revision||0);checksSession.checksCloudUpdatedAt=row.updated_at||meta.updated_at||checksSession.checksCloudUpdatedAt;checksSession.checksCloudLastError='';await mirrorChecksLocally();refreshCloudTimestamp();renderKupaDependentView()}
  catch(error){console.error('shared checks poll',error)}finally{checksSession.checksCloudBusy=false;if(checksSession.checksSaveRequested)setTimeout(()=>saveSharedChecksToCloud(),0)}
}

return { mergeSharedChecks, syncSharedChecksFromCloud, saveSharedChecksToCloud, pollSharedChecks, mergeSharedChecksPreferLocal };
}
