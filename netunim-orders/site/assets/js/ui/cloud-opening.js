import {CLOUD_AUTO_KEY} from '../state/constants.js';
import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';

// Owns opening commands; application startup supplies its narrow ports.
export function createCloudOpening({model,files,tab,session,auth={},view={},storage={},main={},secondary={},recovery,transfer,authentication}){
  const {supaConfigured,loadSession}=auth;
  const {toast,closeModal,setCloud,showSecondaryTabGuard,render}=view;
  const {storageOwnerCurrent=()=>null,storageOwnerAdoption=()=>null,storageV2CloudOutboxActive=()=>false,storageV2PrimaryRequested=()=>false,refreshStorageV2CloudState=async()=>null,adoptStorageV2CloudHead=async()=>null,setStorageV2CloudControl=async()=>null,storageV2CommitPromise=()=>Promise.resolve()}=storage;
  const {prepareCloudState,composeOrderCloudState=(cloud,current)=>({...structuredClone(cloud),checks:structuredClone(current.checks||[])}),applyOrderCloudState,readCloud,requestCloudSave,startPolling,writeStateToFolder}=main;
  const {refreshKupaReadout,syncSharedChecksFromCloud,startFinanceAutoSync=()=>{}}=secondary;
  const clearCloudRecovery=(...args)=>recovery.reset(...args);
  const scheduleCloudRecovery=(...args)=>recovery.schedule(...args);
  const transferLocalV2=(...args)=>transfer.transferLocalV2(...args);
  const loginModal=(...args)=>authentication.loginModal(...args);

async function deferPendingRecovery({manageStatus=true,startPoll=true}={}){
  await storageV2CommitPromise();
  const state=await refreshStorageV2CloudState();
  if(!state?.base||!storageV2CloudOutboxActive())throw new Error('orders_v2_owner_head_required');
  if(state.control?.conflict){session.cloudConflictBlocked=true;if(manageStatus)setCloud('ענן: התנגשות','error');return true}
  if(state.pending||state.flight){
    localStorage.setItem(CLOUD_AUTO_KEY,'1');
    await requestCloudSave();
    if(startPoll)startPolling();
    return true;
  }
  return false;
}

async function enableCloud(afterLogin=false){
  if(!tab.primaryTab)return showSecondaryTabGuard();
  if(!supaConfigured())return alert('הגדרות Supabase חסרות');
  if(!loadSession()&&!afterLogin)return loginModal('upload');
  try{
    setCloud('ענן: בודק…');
    if(storageOwnerCurrent()==='local'){
      if(!storageV2PrimaryRequested())throw new Error('storage_v2_local_engine_required');
      return await transferLocalV2('upload-local');
    }
    if(await deferPendingRecovery())return true;
    return await openCloud();
  }catch(error){
    console.error(error);
    toast('לא ניתן להפעיל ענן: '+error.message);
    setCloud('ענן: שגיאה','error');
    return false;
  }
}

async function openCloud({renderAfter=true,quiet=false,hydrateSecondary=true,manageStatus=true,startPoll=true}={}){
  if(!tab.primaryTab)return false;if(!loadSession()){if(!quiet)loginModal('open');return false}
  try{
    if(manageStatus)setCloud('ענן: מאמת נתוני הזמנות…');
    const localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(localOwner){
      if(!storageV2PrimaryRequested())throw new Error('storage_v2_local_engine_required');
      return await transferLocalV2(reserved?.intent==='upload-local'?'upload-local':'load-account',{renderAfter,startPoll});
    }
    if(await deferPendingRecovery({manageStatus,startPoll}))return true;
    await storageV2CommitPromise();
    const v2Head=await refreshStorageV2CloudState();
    if(!v2Head?.base||!storageV2CloudOutboxActive())throw new Error('orders_v2_account_head_required');
    const observedSeq=Number(v2Head.seq);
    if(!Number.isSafeInteger(observedSeq)||observedSeq<0)throw new Error('orders_v2_account_seq_invalid');
    const observedGeneration=Number(session.localGeneration||0),authenticatedOwner=loadSession()?.user?.id;
    const sameAccount=()=>{const current=loadSession();return !!current&&current.user?.id===authenticatedOwner};
    const row=await readCloud();
    if(!row){clearCloudRecovery();if(manageStatus)setCloud('ענן: אין מסמך','error');return false}
    const rowRevision=Number(row.revision);
    if(!Number.isSafeInteger(rowRevision)||rowRevision<1)throw new Error('orders_v2_remote_revision_invalid');
    const currentHead=await refreshStorageV2CloudState();
    if(currentHead?.seq!==observedSeq||currentHead?.pending||currentHead?.flight||currentHead?.control||Number(session.localGeneration||0)!==observedGeneration)
      throw new Error('orders_v2_local_change_during_cloud_read');
    if(rowRevision<Number(v2Head.base.revision))throw new Error('orders_v2_remote_revision_behind_local_base');
    localStorage.setItem(CLOUD_AUTO_KEY,'1');
    const nextState=composeOrderCloudState(row.state,model.state);
    const publication=await commitCloudCheckpoint({
      commit:()=>adoptStorageV2CloudHead(rowRevision,nextState,{expectedHead:{seq:observedSeq,baseRevision:v2Head.base.revision}}),
      isCurrent:committed=>committed?.seq===observedSeq&&committed?.revision===rowRevision&&!committed.pending&&!committed.control&&tab.primaryTab&&storageV2CloudOutboxActive()&&sameAccount()&&Number(session.localGeneration||0)===observedGeneration,
      publish:()=>{applyOrderCloudState(row.state);session.cloudRevision=rowRevision;session.cloudUpdatedAt=row.updated_at||session.cloudUpdatedAt;session.lastCloudState=prepareCloudState(model.state);session.cloudConflictBlocked=false},
    });
    if(!publication.published){
      if(tab.primaryTab&&storageV2CloudOutboxActive()&&sameAccount()){
        session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
        if(!publication.committed?.control?.conflict)await setStorageV2CloudControl({conflict:{kind:publication.reason==='publication-error'?'cloud-publication-failed':'concurrent-hydration',domain:'orders',baseRevision:v2Head.base.revision,currentRemoteRevision:rowRevision}});
      }
      if(publication.reason==='publication-error')throw publication.error;
      throw new Error('cloud_hydration_publication_stale');
    }
    try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
    // The account owner is already bound; secondary domains hydrate after Main.
    if(renderAfter)render();
    if(hydrateSecondary){if(manageStatus)setCloud('ענן: מסנכרן צ׳קים…');await syncSharedChecksFromCloud({quiet:true,required:true});if(manageStatus)setCloud('ענן: מסונכרן','synced');const financeOk=await refreshKupaReadout({force:true,renderIfChanged:true});if(!financeOk)console.warn('finance readout unavailable after orders cloud open; header status remains scoped to orders + checks');if(startPoll)startPolling();startFinanceAutoSync()}
    else{if(startPoll)startPolling();if(manageStatus)setCloud(session.cloudConflictBlocked?'ענן: התנגשות':'ענן: נתוני הזמנות אומתו',session.cloudConflictBlocked?'error':'')}
    closeModal();clearCloudRecovery();if(!quiet&&!session.cloudConflictBlocked)toast('ניהול ההזמנות נטען מהענן');return true
  }catch(e){console.error(e);if(!quiet)toast('פתיחת הענן נכשלה: '+e.message);if(manageStatus)setCloud(navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין',navigator.onLine?'':'offline');scheduleCloudRecovery();return false}
}

return {deferPendingRecovery,enableCloud,openCloud};
}
