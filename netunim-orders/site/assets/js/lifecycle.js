import {clone} from './core/values.js';
import {CLOUD_BASE_KEY} from './state/constants.js';

function startupMark(name){try{globalThis.performance?.mark?.(`orders-startup:${name}`)}catch{}}
function nextTurn(){return new Promise(resolve=>setTimeout(resolve,0))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({hydrateStorageOwner=async()=>{},hydrateStorageV2OwnerTransfer=async()=>null,resumeStorageV2OwnerTransfer=async()=>null,storageV2OwnerTransferPreparing=()=>false,hydrateStorageTransition=async()=>null,resumeStorageTransition=async()=>null,storageTransitionPreparing=()=>false,hydrateLocalBirth=async()=>null,ensureLocalBirth=async()=>null,localBirthPreparing=()=>false,storageOwnerCurrent=()=>null,verifyStorageCutover=async()=>false,verifyLocalStorageEngine=async()=>false,recoverLocalV2State=async()=>null,recoverReadOnlyV2State=async()=>null,restoreBrowserStateReadOnly=async()=>false,recoverSharedChecksV2Primary=async()=>false,recoverSharedChecksV2ReadOnly=async()=>false,ensureSyncCapabilities=async()=>true,model, files, tab, ui, session, checksSession, domainRevisions, normalizeState, restoreBrowserStateFallback, resumeIncompleteRestore=async()=>false, markCloudPending, getCloudPending, loadCloudPendingState, refreshStorageV2CloudState=async()=>null, cloudHasLocalWork=()=>false, getChecksPending, checksPendingExists, setSave=()=>{}, setCloud=()=>{}, beginStartupSync=()=>{}, setStartupDomain=()=>{}, syncFolderAccessButton, folderBackupAvailable, folderSaveTitle=()=>'', showSecondaryTabGuard, acquirePrimaryTabLock, sameOrderCloudData, hasMeaningfulLocalData, render, prepareState, maybeCreateAutomaticFolderBackup, loadDirHandle, requestPersistentBrowserStorage, refreshDirPermission, loadSession, cloudEnabled, refreshKupaReadout, syncSharedChecksFromCloud, openCloud, startOrderPolling=()=>{}, startFinanceAutoSync=()=>{}, prepareStartupAlerts=async()=>false, showStartupAlerts=()=>{}}){
async function recoverOrdersLocalState({v2Only=false}={}){
  if(v2Only){
    const v2=await refreshStorageV2CloudState();
    if(!v2?.base)throw new Error('orders_v2_cloud_head_missing');
    session.lastCloudState=clone(v2.base.state);session.cloudRevision=Number(v2.base.revision||0);
    session.storageV2CloudPending=!!(v2.pending||v2.flight);
    session.cloudConflictBlocked=!!v2.control?.conflict;
    session.cloudSaveRequested=!!(v2.pending||v2.flight)&&!session.cloudConflictBlocked;
    return;
  }
  try{session.lastCloudState=JSON.parse(localStorage.getItem(CLOUD_BASE_KEY)||'null')}catch(e){console.error('orders cloud base load',e)}
  const durablePending=await getCloudPending(),pending=durablePending?.snapshot||loadCloudPendingState();
  if(pending){
    const previous=model.state;model.state=normalizeState(clone(pending));domainRevisions?.reconcile(previous,model.state);session.localGeneration=Math.max(session.localGeneration,Number(durablePending?.generation||1));session.cloudSaveRequested=true;return;
  }
  const v2=await refreshStorageV2CloudState();
  if(v2?.base){
    session.lastCloudState=clone(v2.base.state);session.cloudRevision=Number(v2.base.revision||0);session.storageV2CloudPending=!!(v2.pending||v2.flight);
    if(v2.control?.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;return}
    if(v2.pending||v2.flight)session.cloudSaveRequested=true;
    return;
  }
  if(cloudEnabled()&&session.lastCloudState&&!sameOrderCloudData(model.state,session.lastCloudState)){
    session.localGeneration=Math.max(session.localGeneration,1);session.cloudSaveRequested=true;markCloudPending();return;
  }
  if(cloudEnabled()&&!session.lastCloudState&&hasMeaningfulLocalData(model.state)){
    session.localGeneration=Math.max(session.localGeneration,1);session.cloudSaveRequested=true;markCloudPending();
  }
}

async function recoverChecksLocalState(){
  try{
    const pending=await getChecksPending();
    if(pending||checksPendingExists()){
      checksSession.checksGeneration=Math.max(checksSession.checksGeneration,Number(pending?.generation||1));checksSession.checksSaveRequested=true;
      if(pending?.snapshot){model.state.checks=clone(pending.snapshot);domainRevisions?.touch('checks');if(['checks','kupa','summary'].includes(ui.currentView))render()}
    }
    return pending||null;
  }catch(error){console.error('checks pending recovery',error);return null}
}

async function initializeLocalServices(){
  try{await requestPersistentBrowserStorage()}catch(e){console.error('persistent browser storage',e)}
  try{files.dirHandle=await loadDirHandle();if(files.dirHandle)await refreshDirPermission(false);else syncFolderAccessButton()}catch(e){console.error('folder startup',e);syncFolderAccessButton()}
}

async function backupAfterHydration(localServicesPromise){
  try{await localServicesPromise}catch(e){console.error('local services startup',e)}
  if(folderBackupAvailable())try{await maybeCreateAutomaticFolderBackup(prepareState())}catch(e){console.error('automatic folder backup',e)}
}

async function prepareAlertsBeforeDisplay(){
  try{await prepareStartupAlerts()}catch(error){console.error('startup bank alerts preparation',error)}
}

async function hydrateSecondaryDomains({sharedOnline,ordersOnline,checksRecoveryPromise,localServicesPromise}){
  try{await checksRecoveryPromise}catch(e){console.error('checks recovery wait',e)}
  if(sharedOnline){
    setStartupDomain('checks','loading');startupMark('checks-start');
    let checksOk=false;
    try{checksOk=await syncSharedChecksFromCloud({quiet:true,required:false})}catch(error){console.error('shared checks startup',error);checksSession.checksCloudLastError=error?.message||String(error)}
    startupMark('checks-end');
    if(checksOk)setStartupDomain('checks','ready');
    else if(checksPendingExists()||checksSession.checksSaveRequested)setStartupDomain('checks','deferred',checksSession.checksCloudLastError||'שינויי הצ׳קים נשמרו מקומית וממתינים לסנכרון');
    else setStartupDomain('checks','error',checksSession.checksCloudLastError||'טעינת הצ׳קים מהענן נכשלה; נשמר העותק המקומי האחרון התקין');

    setStartupDomain('finance','loading');startupMark('finance-start');
    let financeOk=false;
    try{financeOk=await refreshKupaReadout({force:true,renderIfChanged:true})}catch(error){console.error('finance startup readout',error)}
    startupMark('finance-end');
    if(financeOk)setStartupDomain('finance','ready');
    else setStartupDomain('finance','error','טעינת נתוני הבנק והאשראי נכשלה; נשמר העותק האחרון התקין');
  }
  if(ordersOnline)startOrderPolling();
  await backupAfterHydration(localServicesPromise);
  await prepareAlertsBeforeDisplay();
  showStartupAlerts();
  startFinanceAutoSync();
  startupMark('background-ready');
}

async function retryReadOnlyRecovery(fn,{attempts=6,delay=60}={}){
  for(let attempt=0;attempt<attempts;attempt++){
    try{const result=await fn();if(result)return result}catch(error){if(attempt===attempts-1)console.error('secondary read-only recovery',error)}
    if(attempt<attempts-1)await new Promise(resolve=>setTimeout(resolve,delay));
  }
  return null;
}

async function boot(){
  startupMark('boot-start');
  await acquirePrimaryTabLock();startupMark('primary-tab-ready');
  await hydrateStorageOwner();startupMark('storage-owner-ready');
  loadSession();
  const transfer=await hydrateStorageV2OwnerTransfer();
  await hydrateStorageTransition();await hydrateLocalBirth();
  const localOwner=storageOwnerCurrent()==='local';
  let cutoverActive=await verifyStorageCutover(),localEngineActive=await verifyLocalStorageEngine(),transitionPreparing=storageTransitionPreparing();

  if(!tab.primaryTab){
    const v2Required=!!(transfer||storageV2OwnerTransferPreparing()||cutoverActive||localEngineActive||transitionPreparing||localBirthPreparing());
    let shown=false;
    if(v2Required){
      const mainRecovered=await retryReadOnlyRecovery(()=>recoverReadOnlyV2State());
      const sharedRecovered=mainRecovered&&await retryReadOnlyRecovery(()=>recoverSharedChecksV2ReadOnly());
      shown=!!(mainRecovered&&sharedRecovered);
    }else shown=await restoreBrowserStateReadOnly();
    if(shown){render({supplierScrollMode:'end'});startupMark('first-render');setCloud('ענן: קריאה בלבד','offline');setSave('מקומי: קריאה בלבד','',folderSaveTitle())}
    else{setCloud('ענן: קריאה בלבד — הנתונים טרם זמינים','offline');setSave('קריאה בלבד — רענן לאחר סיום האתחול בטאב הראשי','error')}
    showSecondaryTabGuard();syncFolderAccessButton();return;
  }

  if(transfer||storageV2OwnerTransferPreparing()){
    try{await resumeStorageV2OwnerTransfer()}
    catch(error){
      console.error('Orders Storage V2 owner transfer resume',error);
      setCloud('ענן: מעבר חשבון דורש השלמה','error');
      setSave('העריכה נעולה עד השלמת מעבר החשבון','error');
      syncFolderAccessButton();return;
    }
    cutoverActive=await verifyStorageCutover();localEngineActive=await verifyLocalStorageEngine();transitionPreparing=storageTransitionPreparing();
  }
  if(localOwner){
    try{
      if(!localEngineActive){await ensureLocalBirth();localEngineActive=await verifyLocalStorageEngine()}
      if(!localEngineActive)throw new Error('orders_local_engine_marker_required');
      await recoverLocalV2State();
    }catch(error){
      console.error('Orders local Storage V2 birth/recovery',error);
      setCloud('ענן: אחסון מקומי דורש השלמה','error');
      setSave('העריכה נעולה עד השלמת מעבר האחסון המקומי','error');
      syncFolderAccessButton();return;
    }
  }else try{await restoreBrowserStateFallback()}catch(e){if(cutoverActive||localEngineActive)throw e;console.error('browser state recovery',e)}

  // The Main checkpoint still contains a non-authoritative checks copy. A
  // cut-over account must hydrate Shared before any early capability exit can
  // render business state or allow a background poll to inspect that copy.
  let sharedPrimary=false;
  if((cutoverActive||localEngineActive)&&!transitionPreparing){
    sharedPrimary=await recoverSharedChecksV2Primary();
    if(!sharedPrimary)throw new Error('orders_shared_v2_recovery_required');
  }
  if(!localEngineActive&&navigator.onLine&&loadSession()){try{await ensureSyncCapabilities();session.syncCapabilitiesError=null}catch(error){session.syncCapabilitiesError=error;setCloud(error.message,'error');}}
  if(session.syncCapabilitiesError){if(!cutoverActive||sharedPrimary)render();setCloud(session.syncCapabilitiesError.message,'error');setSave(session.syncCapabilitiesError.message,'error');return}

  transitionPreparing=storageTransitionPreparing();
  if(transitionPreparing){
    if(!navigator.onLine||!loadSession()){render();setCloud('ענן: מעבר Storage V2 ממתין להתחברות ולרשת','error');setSave('העריכה נעולה עד השלמת מעבר האחסון','error');return}
    try{await resumeStorageTransition();cutoverActive=await verifyStorageCutover();if(!cutoverActive)throw new Error('storage_cutover_marker_verification_failed')}
    catch(error){console.error('Storage V2 cutover resume',error);render();setCloud('ענן: מעבר Storage V2 דורש השלמה','error');setSave('העריכה נעולה עד השלמת מעבר האחסון','error');return}
  }

  if(!sharedPrimary)sharedPrimary=await recoverSharedChecksV2Primary();
  if(localEngineActive&&!sharedPrimary)throw new Error('orders_local_shared_v2_recovery_required');

  try{await resumeIncompleteRestore()}catch(error){console.error('restore group startup recovery',error);setCloud('ענן: שחזור ממתין','error')}

  if(!localEngineActive)await recoverOrdersLocalState({v2Only:cutoverActive});startupMark('orders-local-recovered');
  const sessionAvailable=!!loadSession(),online=!!navigator.onLine,ordersOnline=!localEngineActive&&cloudEnabled()&&online&&sessionAvailable,sharedOnline=!localEngineActive&&sessionAvailable&&online;
  beginStartupSync({orders:ordersOnline,checks:sharedOnline,finance:sharedOnline});

  render({supplierScrollMode:'end'});startupMark('first-render');
  syncFolderAccessButton();
  setSave(session.cloudDurabilityDegraded?'מקומי: מצב התאוששות':'מקומי: שמור',session.cloudDurabilityDegraded?'error':'',folderSaveTitle());

  const localServicesPromise=initializeLocalServices();
  const checksRecoveryPromise=sharedPrimary?Promise.resolve(true):recoverChecksLocalState();
  await nextTurn();

  if(cloudEnabled()&&!online)setCloud('ענן: אופליין','offline');

  if(ordersOnline){
    setStartupDomain('orders','loading');startupMark('orders-cloud-start');
    let coreOk=false;
    try{coreOk=await openCloud({renderAfter:true,quiet:true,hydrateSecondary:false,manageStatus:false,startPoll:false})}catch(error){console.error('orders startup cloud',error)}
    startupMark('orders-cloud-end');
    if(!coreOk)setStartupDomain('orders','error','אימות נתוני ניהול ההזמנות מול הענן נכשל; העותק המקומי נשמר');
    else if(session.cloudConflictBlocked)setStartupDomain('orders','error','נמצאה התנגשות מול הענן; הנתונים המקומיים נשמרו ולא נדרסו');
    else{
      let pending=null;try{pending=await getCloudPending()}catch(error){console.error('orders pending status',error)}
      if(pending||cloudHasLocalWork())setStartupDomain('orders','deferred','שינויים מקומיים שמורים וממתינים למועד הסנכרון');
      else setStartupDomain('orders','ready');
    }
  }

  if(sharedOnline){
    session.startupHydrationPromise=hydrateSecondaryDomains({sharedOnline,ordersOnline,checksRecoveryPromise,localServicesPromise}).catch(async error=>{console.error('secondary startup hydration',error);await prepareAlertsBeforeDisplay();showStartupAlerts();startFinanceAutoSync()});
  }else{
    await checksRecoveryPromise;
    session.startupHydrationPromise=backupAfterHydration(localServicesPromise).then(async()=>{await prepareAlertsBeforeDisplay();showStartupAlerts();startFinanceAutoSync();startupMark('background-ready')}).catch(async error=>{console.error('startup background',error);await prepareAlertsBeforeDisplay();showStartupAlerts();startFinanceAutoSync()});
  }
}

return { boot };
}
