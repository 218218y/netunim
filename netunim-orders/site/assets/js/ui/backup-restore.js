import {clone} from '../core/values.js';
import {applyStorageV2RestoreGroup,captureStorageV2RestoreSource} from '../shared/storage-v2-restore.js';
import {resumeRestoreGroup} from '../shared/restore-groups.js';
import {stamp} from '../core/dates.js';
import {normalizeSharedChecks,normalizeSharedBankEvents} from '../shared/shared-checks-contract.js';
import {applyStorageV2LocalImport} from '../shared/storage-v2-local-import.js';
import {createRestoreReviewScope} from '../shared/restore-review-scope.js';

// Owns durable restore coordination through explicit ports.
export function createBackupRestore({model,session,tab,checksSession,projection={},view={},local={},cloud={},storage={},browser}){
  const downloadBlob=(...args)=>browser.download(...args);
  const {prepareState,normalizeState}=projection;
  const {toast,showSecondaryTabGuard,setSave,render,confirmDialog,invalidateAllViewDomains=()=>{}}=view;
  const {folderBackupAvailable,folderSaveTitle,writeStateSnapshotToFolder,writeStateToFolder}=local;
  const {loadSession,cloudEnabled,requestCloudSave=async()=>false,restoreGroupStore,stageRestoreGroup,applyRestoreGroup,listIncompleteRestoreGroups}=cloud;
  const {refreshStorageV2CloudState=async()=>null,storageV2LocalPrimary=()=>false,recoverStorageV2State=async()=>null,storageOwnerCurrent=()=>'',storageV2Boundary=null,sharedChecksV2=null}=storage;

async function applyCompletedGroupLocally(group,result={}){
    if(sharedChecksV2?.primaryReady){
      const target=normalizeState(clone(group.localTargetState||{...group.main.state,checks:group.checks?.state?.checks||group.beforeState?.local?.checks||[]}));
      const sharedState={checks:clone(target.checks||[]),bankEvents:clone(group.checks?.state?.bankEvents||checksSession.checksBankEvents||[])};
      const applied=await applyStorageV2RestoreGroup({boundary:storageV2Boundary,group,result,target,sharedState});
      model.state=target;session.localGeneration++;session.cloudRevision=applied.mainRevision;session.cloudUpdatedAt=new Date().toISOString();session.lastCloudState=clone(group.main.state);
      if(group.checks){checksSession.checksCloudBase=clone(sharedState.checks);checksSession.checksBankEvents=clone(sharedState.bankEvents);checksSession.checksCloudRevision=applied.sharedRevision}
      await refreshStorageV2CloudState();invalidateAllViewDomains();render();return true;
    }
    throw new Error('shared_checks_v2_required');
  }

async function resumeIncompleteRestore(){
    if(!tab.primaryTab||!navigator.onLine||!loadSession())return false;
    const resumed=await resumeRestoreGroup({store:restoreGroupStore,stageRemote:stageRestoreGroup,applyRemote:applyRestoreGroup,onApplied:applyCompletedGroupLocally});
    if(resumed){toast('שחזור שנקטע הושלם בבטחה');return true}
    const serverGroups=await listIncompleteRestoreGroups();for(const row of serverGroups.filter(item=>item.app_site==='orders'))await applyRestoreGroup(row.restore_group_id);
    return serverGroups.some(item=>item.app_site==='orders');
  }

  const reviewScope=createRestoreReviewScope({owner:storageOwnerCurrent,generation:()=>Number(session.localGeneration||0),writable:()=>tab.primaryTab&&storageV2LocalPrimary()});

  async function restoreNormalizedState(source,{restoreChecks=true,title='אישור שחזור גיבוי',message='לשחזר את נתוני הגיבוי?',surface='backup.restore',beforeDownload=true,assertFileCurrent=()=>{},signal=null}={}){
    if(!tab.primaryTab)return showSecondaryTabGuard();
    const review=reviewScope.capture(),imported=normalizeState(clone(source)),current=prepareState(),currentChecks=clone(model.state.checks||[]);
    if(!await confirmDialog(title,`${message}\n\nלפני השחזור יישמר צילום בטיחות durable. ${restoreChecks?'גם מסמך הצ׳קים ישוחזר באותה פעולת restore.':'מסמך הצ׳קים יישאר ללא שינוי.'}`,{confirmText:'שחזר גיבוי',cancelText:'ביטול',tone:'danger',...(signal?{signal}:{})}))return false;
    if(!storageV2LocalPrimary()||!sharedChecksV2?.localReady)throw new Error('storage_v2_restore_required');
    try{
      assertFileCurrent();reviewScope.assertCurrent(review);
      if(beforeDownload)downloadBlob(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}),`orders-before-restore_${stamp()}.json`);
      if(folderBackupAvailable())await writeStateSnapshotToFolder(current,true);
      assertFileCurrent();reviewScope.assertCurrent(review);
      const cloudActive=cloudEnabled();if(!restoreChecks)imported.checks=currentChecks;
      const [v2Pending,sharedCloud]=await Promise.all([refreshStorageV2CloudState(),sharedChecksV2.cloudState()]);if([v2Pending,sharedCloud].some(cloud=>cloud&&(cloud.pending||cloud.flight||cloud.control)))throw new Error('קיים שינוי מקומי שממתין לסנכרון; יש להשלים או לפתור אותו לפני שחזור');
      assertFileCurrent();reviewScope.assertCurrent(review);
      if(storageOwnerCurrent()==='local'&&(storageV2LocalPrimary()||sharedChecksV2?.localReady)&&(!storageV2LocalPrimary()||!sharedChecksV2?.localReady))throw new Error('storage_local_import_both_journals_required');
      if(storageV2LocalPrimary()&&sharedChecksV2?.localReady&&storageOwnerCurrent()==='local'&&!v2Pending?.base&&!sharedCloud?.base){
        const [mainLocal,sharedLocal]=await Promise.all([recoverStorageV2State(),sharedChecksV2.recover()]);
        assertFileCurrent();reviewScope.assertCurrent(review);
        if(!mainLocal||!sharedLocal)throw new Error('storage_local_import_recovery_required');
        const sharedState={checks:normalizeSharedChecks(imported.checks),bankEvents:normalizeSharedBankEvents(checksSession.checksBankEvents||[])};
        await applyStorageV2LocalImport({boundary:storageV2Boundary,mode:'local-only',mainCloud:v2Pending,sharedCloud,mainLocal,sharedLocal,mainState:imported,sharedState});
        assertFileCurrent();reviewScope.assertCurrent(review);
        model.state=imported;session.localGeneration++;invalidateAllViewDomains();render();
        if(folderBackupAvailable())try{await writeStateToFolder(true)}catch(error){console.error('folder mirror after durable V2 import',error)}
        setSave('מקומי: שמור','',folderSaveTitle());toast('הגיבוי יובא ונשמר ב־Storage V2');return true;
      }
      const v2Source=sharedChecksV2?.primaryReady?captureStorageV2RestoreSource(v2Pending,sharedCloud):null;
      if(v2Source){
        const sharedState={checks:normalizeSharedChecks(imported.checks),bankEvents:normalizeSharedBankEvents(checksSession.checksBankEvents||[])};
        const latestSharedCloud=await sharedChecksV2.cloudState();assertFileCurrent();reviewScope.assertCurrent(review);
        await applyStorageV2LocalImport({boundary:storageV2Boundary,mainCloud:v2Pending,sharedCloud:latestSharedCloud,mainState:imported,sharedState});
        assertFileCurrent();reviewScope.assertCurrent(review);
        model.state=imported;session.localGeneration++;session.cloudSaveRequested=true;checksSession.checksSaveRequested=true;
        await refreshStorageV2CloudState();invalidateAllViewDomains();render();
        if(folderBackupAvailable())try{await writeStateToFolder(true)}catch(error){console.error('folder mirror after durable V2 import',error)}
        setSave('מקומי: שמור','',folderSaveTitle());toast('הגיבוי יובא ונשמר מקומית; הסנכרון לענן ממתין');
        if(cloudActive&&navigator.onLine){void requestCloudSave('הייבוא סונכרן').catch(console.error);void sharedChecksV2.sync().catch(console.error)}
        return true;
      }
      throw new Error('storage_v2_restore_head_required');
    }catch(error){if(error?.code==='backup_file_scope_changed')return false;console.error(surface,error);toast('השחזור נעצר בבטחה: '+(error.message||error));return false}
  }

return {applyCompletedGroupLocally,resumeIncompleteRestore,restoreNormalizedState};
}
