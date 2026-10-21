import {canonicalCloudSyncBase} from './state-projection.js';
import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';
import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {jsonEq} from './merge-records.js';

// Commits the durable checkpoint before visible remote publication. Independent
// Finance and Shared Checks keep their original journals and ordering fences.
export function createRemoteAdoption({model,session,tab,access,journal,projection,transport,view,mirror,secondary,write}){
const {storageV2CloudOutboxActive,assertAccountOwner,markCloudMode}=access;
const {refreshStorageV2CloudState,replaceStorageV2CurrentState,clearStorageV2CloudControl,adoptStorageV2CloudHead,setStorageV2CloudControl,queueStorageV2CloudNormalization,resetStorageV2CloudHead}=journal;
const {domainRevisions,prepareKupaCloudState,applyKupaCloudState}=projection;
const {readSupabaseDocument,readFinanceSyncDocument}=transport;
const {setSaveStatus,setCloudHeaderStatus,hideConnectScreen,setConnectedStatus,render}=view;
const {backupSnapshotToComputer}=mirror;
const {syncSharedChecksFromCloud,refreshOrdersFinanceSummary}=secondary;
const {requestStorageV2CloudSave,startCloudPolling}=write;
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
  markCloudMode();session.cloudAuthNoDocument=false;hideConnectScreen();
  if(renderNow)render();
  // Secondary hydration must not prevent Main's checkpoint from committing.
  // Its failure remains visible to the caller and is retried by the next poll.
  startCloudPolling();
  await syncSharedChecksFromCloud({quiet:true,required:true});
  await refreshOrdersFinanceSummary({force:true,renderIfChanged:false});
  // The backup owner captures the target, verifies the file and refreshes its
  // catalog. Native file I/O is outside Main's hydration/polling lifecycle.
  try{void Promise.resolve(backupSnapshotToComputer(structuredClone(model.state),revision)).catch(error=>console.error('post-hydration local backup',error))}catch(error){console.error('post-hydration local backup',error)}
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

return {replaceVisibleState,applyKupaCoreState,applyAcknowledgedCoreState,applyFinanceOnlyRow,pollIndependentFinance,reviewCleanConflict,applyCloudRow,loadSupabaseState};
}
