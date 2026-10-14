import {createCloudWriteAuthority} from '../shared/cloud-write-authority.js';
import {createCloudWriteFlight} from './write-flight.js';
import {createCloudAckPublication} from './ack-publication.js';
import {canonicalCloudSyncBase} from './state-projection.js';
import {createCloudConfirmation} from './confirmation.js';
import {createCloudPolling} from './polling.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';

import {captureCloudWriteScope,cloudWriteScopeIsCurrent,cloudWriteScopeHasIdentity} from '../shared/cloud-write-scope.js';
import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';

import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {jsonEq} from './merge-records.js';
import {SUPA_AUTO_KEY, STORAGE_PREF_KEY} from '../state/constants.js';
import {createOutboxRetryScheduler,normalizeCloudError} from '../shared/cloud-sync.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncDocument({model,session,tab,access,journal,checkpoint,recovery,projection,transport,view,mirror,secondary}){
const {getCloudWriteScope,storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner}=access;
const {refreshStorageV2CloudState,materializeStorageV2CloudFlight,acknowledgeStorageV2CloudFlight,rejectStorageV2CloudFlight,setStorageV2CloudControl,storageV2CommitPromise}=journal;
const {clearStorageV2CloudControl,replaceStorageV2CurrentState,queueStorageV2CloudNormalization,adoptStorageV2CloudHead,resetStorageV2CloudHead}=checkpoint;
const {readStorageV2CloudRecovery,commitStorageV2CloudRecovery,cancelCloudRecovery}=recovery;
const {prepareKupaCloudState,applyKupaCloudState,mergeKupaCloudState3Way,domainRevisions}=projection;
const {readSupabaseDocument,readFinanceSyncDocument,rpcSaveCloudV2}=transport;
const {hideConnectScreen,reportError,setSaveStatus,setConnectedStatus,setCloudHeaderStatus,showSecondaryTabGuard,toast,render}=view;
const {listBackups,backupSnapshotToComputer}=mirror;
const {syncSharedChecksFromCloud,pollSharedChecks,refreshOrdersFinanceSummary}=secondary;

const outboxRetryScheduler=createOutboxRetryScheduler();
let savingScope=null,cloudSavePromise=null,wakeEpoch=0;
const saveWork=createRuntimeTaskOwner();
const {isCurrent:writeScopeCurrent,setControl:setWriteControl}=createCloudWriteAuthority({
  scope:{read:getCloudWriteScope},
  leadership:{primary:()=>tab.primaryTab,preparing:storageV2PreparationActive},
  control:{write:setStorageV2CloudControl},
});


function replaceVisibleState(next,{forceAll=false}={}){const previous=model.state;model.state=next;domainRevisions?.reconcile(previous,model.state,{forceAll});return model.state}
function applyKupaCoreState(coreState,checks=model.state.checks,financeSource=model.state){
  const next=structuredClone(coreState&&typeof coreState==='object'?coreState:{}),finance=financeSource&&typeof financeSource==='object'?financeSource:{},coreBank=next.bank&&typeof next.bank==='object'?next.bank:{},financeBank=finance.bank&&typeof finance.bank==='object'?structuredClone(finance.bank):null;
  if(financeBank){
    delete financeBank.adjustments;delete financeBank.snapshotToken;delete financeBank.snapshotSeq;
    if(financeBank.source!=='hapoalim'){delete financeBank.currentBalance;delete financeBank.updatedAt;delete financeBank.asOfDate;delete financeBank.source;delete financeBank.sourceAccount}
    next.bank={...coreBank,...financeBank,adjustments:Array.isArray(coreBank.adjustments)?structuredClone(coreBank.adjustments):[],snapshotToken:coreBank.snapshotToken??null,snapshotSeq:coreBank.snapshotSeq??null};
  }
  if(finance.creditSync&&typeof finance.creditSync==='object')next.creditSync=structuredClone(finance.creditSync);
  return applyKupaCloudState(next,checks)
}
// Compare the full applied state: a canonical cloud projection can hide local
// normalization changes (for example expired legacy rows or numeric strings).
function applyAcknowledgedCoreState(snapshot){
  const next=applyKupaCoreState(snapshot,model.state.checks),changed=!jsonEq(model.state,next);
  if(changed)replaceVisibleState(next);
  return changed;
}
async function applyFinanceOnlyRow(row){
  if(row?.financeAvailable===false)return false;
  const revision=Number(row?.financeRevision);
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('finance_read_revision_invalid');
  if(revision<=Number(session.financeRevision||0))return false;
  const cloud=await refreshStorageV2CloudState();if(!cloud?.base)throw new Error('kupa_v2_checkpoint_required');
  const generation=Number(session.localGeneration||0),previousRevision=Number(session.financeRevision||0),current=structuredClone(model.state),remote=row.state||{},bank=current.bank||{};
  const financeBank=remote.bank?{...bank,...structuredClone(remote.bank),adjustments:structuredClone(bank.adjustments||[]),snapshotToken:bank.snapshotToken??null,snapshotSeq:bank.snapshotSeq??null}:bank;
  if(bank.source==='manual')for(const key of ['currentBalance','updatedAt','asOfDate','source','sourceAccount'])financeBank[key]=bank[key];
  const normalized=applyKupaCloudState({...current,bank:financeBank,creditSync:remote.creditSync||current.creditSync},current.checks);
  const next={...current,bank:normalized.bank,creditSync:normalized.creditSync};
  if(!jsonEq(prepareKupaCloudState(current),prepareKupaCloudState(next)))throw new Error('finance_hydration_main_changed');
  const publication=await commitCloudCheckpoint({
    commit:()=>replaceStorageV2CurrentState(next,{expectedSeq:cloud.seq}),
    isCurrent:committed=>committed===cloud.seq&&tab.primaryTab&&Number(session.localGeneration||0)===generation&&Number(session.financeRevision||0)===previousRevision,
    publish:()=>{replaceVisibleState(next)},
  });
  if(!publication.published){if(publication.reason==='publication-error')throw publication.error;return false}
  session.financeRevision=revision;session.financeUpdatedAt=row.financeUpdatedAt||session.financeUpdatedAt||null;
  render();return true;
}

async function pollIndependentFinance(){
  try{
    const row=await readFinanceSyncDocument();if(!row)return false;
    return await applyFinanceOnlyRow({state:row.state,financeRevision:row.revision,financeUpdatedAt:row.updated_at});
  }catch(error){console.warn('Independent Finance hydration deferred; Kupa local work retained',error);return false}
}

async function reviewCleanConflict(cloud){
  const conflict=cloud.control?.conflict;
  // This fence records a dirty projection, not a server rejection or an ACK
  // failure. Only its disproved condition can be retired automatically.
  if(conflict?.kind!=='storage-v2-dirty-head'||conflict.domain!=='kupa'||cloud.pending||cloud.flight||!cloud.base||!jsonEq(prepareKupaCloudState(model.state),cloud.base.state))return cloud;
  try{
    const cleared=await clearStorageV2CloudControl({onlyIfClean:{kind:conflict.kind,seq:cloud.seq,baseRevision:cloud.base.revision}});
    if(!cleared)return cloud;
    const current=await refreshStorageV2CloudState();session.cloudConflictPending=!!current?.control?.conflict;return current;
  }catch(error){console.warn('Kupa conflict review deferred; local journal retained',error);return cloud}
}
async function applyCloudRow(row,{renderNow=true}={}){
  const currentV2=await refreshStorageV2CloudState();
  if(!currentV2?.base)throw new Error('kupa_v2_account_head_initialization_required');
  if(!storageV2CloudOutboxActive())throw new Error('kupa_v2_account_head_not_ready');
  assertAccountOwner();
  if(currentV2.pending||currentV2.flight||currentV2.control)throw new Error('kupa_v2_cloud_pending_during_authoritative_apply');
  const revision=Number(row?.revision),generation=Number(session.localGeneration||0),financeRevision=Number(session.financeRevision||0);
  if(!Number.isSafeInteger(revision)||revision<1||revision<currentV2.base.revision)throw new Error('kupa_v2_remote_revision_invalid');
  const legacyCards=Array.isArray(row?.state?.cards)&&row.state.cards.some(card=>typeof card?.id!=='string'||!card.id.trim()),financeAvailable=row?.financeAvailable!==false&&Number(row.financeRevision||0)>=financeRevision;
  const next=financeAvailable?applyKupaCloudState(row.state,model.state.checks):applyKupaCoreState(row.state,model.state.checks,model.state);
  const removed=model.lastNormalizeRemovedCredits,normalizationBase=canonicalCloudSyncBase(row.state,prepareKupaCloudState);
  const publication=await commitCloudCheckpoint({
    commit:()=>adoptStorageV2CloudHead(revision,next,{cloudState:normalizationBase,expectedHead:{seq:currentV2.seq,baseRevision:currentV2.base.revision}}),
    isCurrent:committed=>{assertAccountOwner();return committed?.seq===currentV2.seq&&committed?.revision===revision&&!committed.pending&&!committed.control&&tab.primaryTab&&storageV2CloudOutboxActive()&&Number(session.localGeneration||0)===generation},
    // Shared Checks owns its own journal and can advance while Main commits.
    publish:()=>{next.checks=normalizeSharedChecks(model.state.checks);replaceVisibleState(Number(session.financeRevision||0)===financeRevision?next:applyKupaCoreState(next,model.state.checks,model.state))},
  });
  if(!publication.published){
    if(tab.primaryTab&&storageV2CloudOutboxActive()){
      session.cloudConflictPending=true;
      if(!publication.committed?.control?.conflict)await setStorageV2CloudControl({conflict:{kind:publication.reason==='publication-error'?'cloud-publication-failed':'concurrent-hydration',domain:'kupa',baseRevision:currentV2.base.revision,currentRemoteRevision:revision}});
      setSaveStatus('הנתונים נשמרו מקומית; נדרשת בדיקת סנכרון','error');setCloudHeaderStatus('conflict','ענן: נדרשת בדיקה');
    }
    if(publication.reason==='publication-error')throw publication.error;
    throw new Error('cloud_hydration_publication_stale');
  }
  session.dbRevision=revision;session.lastSavedSnapshot=JSON.stringify(normalizationBase);
  if(financeAvailable&&Number(session.financeRevision||0)===financeRevision){session.financeRevision=Number(row.financeRevision||0);session.financeUpdatedAt=row.financeUpdatedAt||session.financeUpdatedAt||null}
  session.connectionMode='supabase';session.backendReady=true;session.cloudConflictPending=false;
  session.serverInfo={...session.serverInfo,schemaVersion:6,lastSavedAt:row.coreUpdatedAt||session.serverInfo?.lastSavedAt||null,databaseFile:'Supabase'};
  const v2Normalization=removed>0||legacyCards;
  if(v2Normalization)await queueStorageV2CloudNormalization(model.state,revision);
  localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');session.cloudAuthNoDocument=false;hideConnectScreen();
  if(renderNow)render();
  // Secondary hydration must not prevent Main's checkpoint from committing.
  // Its failure remains visible to the caller and is retried by the next poll.
  startCloudPolling();
  await syncSharedChecksFromCloud({quiet:true,required:true});
  await refreshOrdersFinanceSummary({force:true,renderIfChanged:false});
  try{session.serverInfo.backups=await listBackups();await backupSnapshotToComputer(model.state,revision)}catch(error){console.error('post-hydration local backup',error)}
  assertAccountOwner();
  setConnectedStatus('Supabase מחובר');
  if(Number(session.localGeneration||0)!==generation||v2Normalization){setSaveStatus('שינוי שמור מקומית וממתין לסנכרון','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…')}
  else{setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן')}
  if(v2Normalization)void requestStorageV2CloudSave().catch(error=>console.error('Kupa cloud normalization sync',error));
  return model.state;
}

async function loadSupabaseState({discardLocalV2=false}={}){
  let v2=await refreshStorageV2CloudState();
  if(discardLocalV2&&v2?.base&&(v2.pending||v2.flight||v2.control)){const row=await readSupabaseDocument();if(!row)throw new Error('מסמך הענן לא נמצא');const next=applyKupaCoreState(row.state,model.state.checks,model.state);replaceVisibleState(next,{forceAll:true});await resetStorageV2CloudHead(Number(row.revision||0),model.state);session.dbRevision=Number(row.revision||0);session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));session.cloudConflictPending=false;v2=await refreshStorageV2CloudState();return applyCloudRow(row)}
  if(storageV2CloudOutboxActive()&&(v2?.pending||v2?.flight||v2?.control)){session.connectionMode='supabase';session.backendReady=true;hideConnectScreen();await requestStorageV2CloudSave('שינויים מקומיים שוחזרו וסונכרנו');return model.state}
  const row=await readSupabaseDocument();
  if(!row)throw new Error('מסמך הענן לא נמצא');
  return applyCloudRow(row)
}



function v2RetryRecord(state,flight=null){return {domain:'kupa',documentName:`${session.cloudDocumentName||'main'}-v2`,generation:Number(flight?.generation??state?.pendingGeneration??0),operationId:String(flight?.operationId||'kupa-v2'),retry:state?.control?.retry||null}}

function requestStorageV2CloudSave(...args){
  return saveWork.run(()=>runStorageV2CloudSave(...args));
}
async function runStorageV2CloudSave(message='הקופה סונכרנה לענן',{force=false}={}){
  const wakeGeneration=wakeEpoch;
  const liveScope=getCloudWriteScope();if(!tab.primaryTab){showSecondaryTabGuard();return false}if(!force&&(session.connectionMode!=='supabase'||!session.backendReady))return false;let state=await refreshStorageV2CloudState();const scope=captureCloudWriteScope(liveScope,state);if(!writeScopeCurrent(scope,state))return false;if(!state?.base)return false;if(state.control?.conflict){session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
  if(!navigator.onLine){try{await storageV2CommitPromise()}catch(error){console.error('kupa V2 journal offline commit',error)}if(!writeScopeCurrent(scope))return false;setSaveStatus('אופליין — שינוי שמור מקומית וממתין','saving');setCloudHeaderStatus('offline','ענן: אופליין');return false}
  if(cloudSavePromise&&cloudWriteScopeHasIdentity(scope,savingScope))return cloudSavePromise;
  savingScope=scope;
  let followup=false;
  const saving=(async()=>{
    while(writeScopeCurrent(scope)&&cloudConfirmationAccess(force)&&!session.cloudConflictPending){
      const generation=Number(session.localGeneration||0);
      state=await refreshStorageV2CloudState();
      if(!cloudConfirmationAccess(force)||!writeScopeCurrent(scope,state))return false;
      if(state.control?.conflict){session.cloudConflictPending=true;return false}
      const currentFlight=state.flight||null,retryDelay=outboxRetryScheduler.schedule(v2RetryRecord(state,currentFlight),()=>writeScopeCurrent(scope)?requestStorageV2CloudSave(message,{force}):false);
      if(retryDelay>0){setSaveStatus('ממתין למועד הסנכרון שהשרת קבע','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');return false}
      const flight=currentFlight||await materializeStorageV2CloudFlight();
      if(!writeScopeCurrent(scope))return false;
      if(!flight){
        const confirmation=await confirmCloudSynced(generation,state,{force,scope});
        followup=confirmation.advanced&&writeScopeCurrent(scope,confirmation.head);
        if(confirmation.synced&&message)toast(message);
        return confirmation.synced;
      }
      if(!cloudConfirmationAccess(force)||!cloudWriteScopeIsCurrent(scope,getCloudWriteScope(),{base:flight}))return false;
      session.cloudSyncBusy=true;setSaveStatus('מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…');
      try{
        const saved=await saveStorageV2CloudFlight(flight,scope);if(!saved||!writeScopeCurrent(scope,saved.state))return false;
        outboxRetryScheduler.cancel();
        const confirmation=await confirmCloudSynced(generation,saved.state,{force,scope});
        if(confirmation.synced){if(message)toast(message);return true}
        // Continue the existing drain only for work represented in the ACK
        // receipt. A later edit/backup completion belongs to the next wakeup.
        if(saved.state?.pending&&cloudConfirmationAccess(force)&&writeScopeCurrent(scope,confirmation.head)&&!confirmation.head?.control)continue;
        followup=confirmation.advanced&&writeScopeCurrent(scope,confirmation.head);
        return false;
      }catch(error){
        console.error('kupa cloud save V2',error);
        if(!writeScopeCurrent(scope)||!cloudScopeAccess(force))return false;
        state=await refreshStorageV2CloudState();if(!cloudScopeAccess(force)||!writeScopeCurrent(scope,state))return false;
        const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};
        await setWriteControl(scope,{retry});state=await refreshStorageV2CloudState();
        if(!cloudScopeAccess(force)||!writeScopeCurrent(scope,state))return false;
        outboxRetryScheduler.schedule(v2RetryRecord(state,state?.flight),()=>writeScopeCurrent(scope)?requestStorageV2CloudSave(message,{force}):false);
        setSaveStatus(navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');return false;
      }finally{if(cloudWriteScopeHasIdentity(scope,getCloudWriteScope())){session.cloudSyncBusy=false;session.cloudWriteBusy=false}}
    }
    return false;
  })().finally(()=>{
    if(cloudSavePromise===saving){cloudSavePromise=null;savingScope=null}
    // Consume a newer generation through the existing owner, after clearing the
    // joined promise. Explicitly stopped/denied owners cannot be restarted here.
    if(wakeGeneration===wakeEpoch&&writeScopeCurrent(scope)&&followup&&session.cloudPollingEnabled&&cloudConfirmationAccess(force))void polling.wake();
  });cloudSavePromise=saving;return saving
}

async function persistSupabaseState(_snapshot,msg){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  if(!storageV2CloudOutboxActive())throw new Error('kupa_v2_account_head_required');
  try{await storageV2CommitPromise()}
  catch(error){console.error('kupa V2 journal commit before cloud save',error);setSaveStatus('השינוי לא נשמר באחסון המקומי — אין לסגור את החלון','error');setCloudHeaderStatus('conflict','ענן: נדרש שחזור אחסון מקומי');return false}
  return requestStorageV2CloudSave(msg);
}

function startCloudPolling(){return polling.start()}
function stopCloudPolling(){wakeEpoch++;return polling.stop()}
const {publishAcknowledgedFlight}=createCloudAckPublication({
  model,
  session,
  tab,
  access:{writeScopeCurrent},
  journal:{refreshStorageV2CloudState,acknowledgeStorageV2CloudFlight,setWriteControl},
  projection:{prepareKupaCloudState,mergeKupaCloudState3Way,applyKupaCoreState,applyAcknowledgedCoreState},
  view:{setSaveStatus,setCloudHeaderStatus,reportError,render},
  mirror:{backupSnapshotToComputer},
  recovery:{readStorageV2CloudRecovery,commitStorageV2CloudRecovery},
});
const {saveStorageV2CloudFlight}=createCloudWriteFlight({
  model,
  session,
  access:{writeScopeCurrent,getCloudWriteScope},
  journal:{refreshStorageV2CloudState,materializeStorageV2CloudFlight,rejectStorageV2CloudFlight,setWriteControl},
  projection:{prepareKupaCloudState,mergeKupaCloudState3Way,applyKupaCoreState,replaceVisibleState},
  transport:{rpcSaveCloudV2,readSupabaseDocument},
  view:{setSaveStatus,setCloudHeaderStatus,reportError,render},
  publication:{publishAcknowledgedFlight},
});
const confirmation=createCloudConfirmation({
  model,
  session,
  tab,
  access:{storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner,writeScopeCurrent},
  state:{prepareKupaCloudState,refreshStorageV2CloudState},
  view:{setSaveStatus,setCloudHeaderStatus},
});
const {cloudScopeAccess,cloudConfirmationAccess,confirmCloudSynced}=confirmation;
const polling=createCloudPolling({
  model,
  session,
  tab,
  access:{storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner},
  state:{prepareKupaCloudState,refreshStorageV2CloudState},
  view:{setSaveStatus,setCloudHeaderStatus,toast},
  remote:{readSupabaseDocument},
  adoption:{reviewCleanConflict,applyFinanceOnlyRow,applyCloudRow,setStorageV2CloudControl},
  secondary:{pollSharedChecks,pollIndependentFinance,refreshOrdersFinanceSummary},
  write:{requestStorageV2CloudSave},
  confirmation,
});
const trackedCloudPoll=polling.poll,resumeAfterReconnect=polling.resumeAfterReconnect;
const runtime={
  isPending:()=>saveWork.isPending()||polling.runtime.isPending(),
  async drain(){
    do{
      await saveWork.drain();await polling.runtime.drain();
    }while(saveWork.isPending()||polling.runtime.isPending());
  },
};
async function quiesceForStorageCutover(){
  stopCloudPolling();
  cancelCloudRecovery();
  outboxRetryScheduler.cancel();
  await runtime.drain();
  outboxRetryScheduler.cancel();return true;
}

return { applyCloudRow, loadSupabaseState, rpcSaveCloudV2, persistSupabaseState, requestStorageV2CloudSave, cloudPoll:trackedCloudPoll, resumeAfterReconnect, startCloudPolling,stopCloudPolling,quiesceForStorageCutover,runtime };
}
