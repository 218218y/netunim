import {clone} from '../core/values.js';
import {applyStorageV2RestoreGroup,captureStorageV2RestoreSource} from '../shared/storage-v2-restore.js';
import {resumeRestoreGroup} from '../shared/restore-groups.js';
import {payloadFromState} from '../state/serialization.js';
import {normalizeSharedChecks,normalizeSharedBankEvents} from '../shared/shared-checks-contract.js';
import {applyStorageV2LocalImport} from '../shared/storage-v2-local-import.js';
import {createRestoreReviewScope} from '../shared/restore-review-scope.js';

// Owns durable restore coordination through explicit ports.
export function createBackupRestore({model,session,files,checksSession,view={},local={},cloud={},storage={}}){
  const {toast,render,confirmDialog,invalidateAllViewDomains=()=>{}}=view;
  const {createManualBackup}=local;
  const {loadSupaSession,persistSupabaseState=async()=>false,restoreGroupStore,stageRestoreGroup,applyRestoreGroup,listIncompleteRestoreGroups}=cloud;
  const {refreshStorageV2CloudState=async()=>null,storageV2LocalPrimary=()=>false,recoverStorageV2State=async()=>null,storageOwnerCurrent=()=>'',storageV2Boundary=null,sharedChecksV2=null}=storage;

async function applyCompletedGroupLocally(group,result={}){
    if(sharedChecksV2?.primaryReady){
      const target=clone(group.localTargetState||{...group.main.state,checks:group.checks?.state?.checks||group.beforeState?.local?.checks||[]});
      const sharedState={checks:clone(target.checks||[]),bankEvents:clone(group.checks?.state?.bankEvents||checksSession.sharedChecksBankEvents||[])};
      const applied=await applyStorageV2RestoreGroup({boundary:storageV2Boundary,group,result,target,sharedState});
      model.state=target;session.connectionMode='supabase';session.backendReady=true;session.dbRevision=applied.mainRevision;session.lastSavedSnapshot=JSON.stringify(group.main.state);
      if(group.checks){checksSession.sharedChecksRevision=applied.sharedRevision;checksSession.sharedChecksBase=clone(sharedState.checks);checksSession.sharedChecksBankEvents=clone(sharedState.bankEvents)}
      await refreshStorageV2CloudState();invalidateAllViewDomains();render();return true;
    }
    throw new Error('shared_checks_v2_required');
  }

async function resumeIncompleteRestore(){
    if(!navigator.onLine||!loadSupaSession())return false;
    const resumed=await resumeRestoreGroup({store:restoreGroupStore,stageRemote:stageRestoreGroup,applyRemote:applyRestoreGroup,onApplied:applyCompletedGroupLocally});
    if(resumed){toast('שחזור שנקטע הושלם בבטחה');return true}
    const serverGroups=await listIncompleteRestoreGroups();for(const row of serverGroups.filter(item=>item.app_site==='kupa'))await applyRestoreGroup(row.restore_group_id);
    return serverGroups.some(item=>item.app_site==='kupa');
  }

  const reviewScope=createRestoreReviewScope({owner:storageOwnerCurrent,generation:()=>Number(session.localGeneration||0),writable:storageV2LocalPrimary});

  async function restoreState(state,{title='שחזור גיבוי',message='להחליף את הנתונים הנוכחיים בנתוני הגיבוי?',surface='backup.restore',assertFileCurrent=()=>{},signal=null}={}){
    const review=reviewScope.capture(),currentState=clone(model.state),cloudActive=session.connectionMode==='supabase'&&session.backendReady;
    if(!await confirmDialog(title,`${message} לפני כל כתיבה יישמר צילום בטיחות durable. במצב ענן הקופה והצ׳קים ישוחזרו בפעולה מאוחדת אחת.`,{confirmText:'שחזר גיבוי',cancelText:'ביטול',tone:'danger',...(signal?{signal}:{})}))return false;
    if(!storageV2LocalPrimary()||!sharedChecksV2?.localReady)throw new Error('storage_v2_restore_required');
    assertFileCurrent();reviewScope.assertCurrent(review);
    if(files.backupsDirHandle)await createManualBackup(payloadFromState(currentState,session.dbRevision),'before-restore');
    assertFileCurrent();reviewScope.assertCurrent(review);
    const [v2Pending,sharedCloud]=await Promise.all([refreshStorageV2CloudState(),sharedChecksV2.cloudState()]);
    assertFileCurrent();reviewScope.assertCurrent(review);
    if((v2Pending&&(v2Pending.pending||v2Pending.flight||v2Pending.control))||(sharedCloud&&(sharedCloud.pending||sharedCloud.flight||sharedCloud.control)))throw new Error('קיים שינוי מקומי שממתין לסנכרון; יש להשלים או לפתור אותו לפני שחזור');
    if(storageOwnerCurrent()==='local'&&(storageV2LocalPrimary()||sharedChecksV2?.localReady)&&(!storageV2LocalPrimary()||!sharedChecksV2?.localReady))throw new Error('storage_local_import_both_journals_required');
    if(storageV2LocalPrimary()&&sharedChecksV2?.localReady&&storageOwnerCurrent()==='local'&&!v2Pending?.base&&!sharedCloud?.base){
      const [mainLocal,sharedLocal]=await Promise.all([recoverStorageV2State(),sharedChecksV2.recover()]);
      assertFileCurrent();reviewScope.assertCurrent(review);
      if(!mainLocal||!sharedLocal)throw new Error('storage_local_import_recovery_required');
      const sharedState={checks:normalizeSharedChecks(state.checks),bankEvents:normalizeSharedBankEvents(checksSession.sharedChecksBankEvents||[])};
      await applyStorageV2LocalImport({boundary:storageV2Boundary,mode:'local-only',mainCloud:v2Pending,sharedCloud,mainLocal,sharedLocal,mainState:state,sharedState});
      assertFileCurrent();reviewScope.assertCurrent(review);
      model.state=clone(state);session.localGeneration++;invalidateAllViewDomains();render();toast('הגיבוי יובא ונשמר ב־Storage V2');return true;
    }
    const v2Source=sharedChecksV2?.primaryReady?captureStorageV2RestoreSource(v2Pending,sharedCloud):null;
    if(v2Source){
      const sharedState={checks:normalizeSharedChecks(state.checks),bankEvents:normalizeSharedBankEvents(checksSession.sharedChecksBankEvents||[])};
      const latestSharedCloud=await sharedChecksV2.cloudState();assertFileCurrent();reviewScope.assertCurrent(review);
      await applyStorageV2LocalImport({boundary:storageV2Boundary,mainCloud:v2Pending,sharedCloud:latestSharedCloud,mainState:state,sharedState});
      assertFileCurrent();reviewScope.assertCurrent(review);
      model.state=clone(state);session.localGeneration++;checksSession.sharedChecksSaveRequested=true;
      await refreshStorageV2CloudState();invalidateAllViewDomains();render();
      toast('הגיבוי יובא ונשמר מקומית; הסנכרון לענן ממתין');
      if(cloudActive&&navigator.onLine){void persistSupabaseState(model.state,'הייבוא סונכרן').catch(console.error);void sharedChecksV2.sync().catch(console.error)}
      return true;
    }
    throw new Error('storage_v2_restore_head_required');

  }

return {applyCompletedGroupLocally,resumeIncompleteRestore,restoreState};
}
