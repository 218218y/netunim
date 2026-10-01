import {clone} from './core/values.js';
import {checkStorageAccountStartup} from './shared/storage-v2-server-protocol.js';

function startupMark(name){try{globalThis.performance?.mark?.(`orders-startup:${name}`)}catch{}}
function nextTurn(){return new Promise(resolve=>setTimeout(resolve,0))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({hydrateStorageOwner=async()=>{},hydrateStorageV2OwnerTransfer=async()=>null,resumeStorageV2OwnerTransfer=async()=>null,storageV2OwnerTransferPreparing=()=>false,hydrateLocalBirth=async()=>null,ensureLocalBirth=async()=>null,localBirthPreparing=()=>false,storageOwnerCurrent=()=>null,verifyStorageCutover=async()=>false,verifyLocalStorageEngine=async()=>false,readStorageProtocolState,authenticatedOwner=()=>null,recoverFencedAccount=async()=>false,recoverLocalV2State=async()=>null,recoverReadOnlyV2State=async()=>null,restoreBrowserStateReadOnly=async()=>false,restoreBrowserStateFallback=async()=>false,recoverSharedChecksV2Primary=async()=>false,recoverSharedChecksV2ReadOnly=async()=>false,ensureSyncCapabilities=async()=>true,resumeIncompleteRestore=async()=>false,model,files,tab,ui,session,checksSession,refreshStorageV2CloudState=async()=>null,cloudHasLocalWork=()=>false,setSave=()=>{},setCloud=()=>{},beginStartupSync=()=>{},setStartupDomain=()=>{},syncFolderAccessButton,folderBackupAvailable,folderSaveTitle=()=>'',showSecondaryTabGuard,acquirePrimaryTabLock,render,prepareState,maybeCreateAutomaticFolderBackup,loadDirHandle,requestPersistentBrowserStorage,refreshDirPermission,loadSession,cloudEnabled,refreshKupaReadout,syncSharedChecksFromCloud,openCloud,startOrderPolling=()=>{},startFinanceAutoSync=()=>{},prepareStartupAlerts=async()=>false,showStartupAlerts=()=>{}}){
async function recoverOrdersLocalState(){
  const v2=await refreshStorageV2CloudState();
  if(!v2?.base)throw new Error('orders_v2_cloud_head_missing');
  session.lastCloudState=clone(v2.base.state);session.cloudRevision=Number(v2.base.revision||0);
  session.storageV2CloudPending=!!(v2.pending||v2.flight);session.cloudConflictBlocked=!!v2.control?.conflict;
  session.cloudSaveRequested=!!(v2.pending||v2.flight)&&!session.cloudConflictBlocked;
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
    else if(checksSession.checksSaveRequested)setStartupDomain('checks','deferred',checksSession.checksCloudLastError||'שינויי הצ׳קים נשמרו מקומית וממתינים לסנכרון');
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
  session.storageProtocolBlocked=true;
  startupMark('boot-start');
  await acquirePrimaryTabLock();startupMark('primary-tab-ready');
  await hydrateStorageOwner();startupMark('storage-owner-ready');
  loadSession();
  const transfer=await hydrateStorageV2OwnerTransfer();
  await hydrateLocalBirth();
  let localOwner=storageOwnerCurrent()==='local';
  let cutoverActive=await verifyStorageCutover(),localEngineActive=await verifyLocalStorageEngine();
  let protocol=await checkStorageAccountStartup({owner:storageOwnerCurrent(),cutoverActive,localEngineActive,online:globalThis.navigator?.onLine!==false,authenticatedOwner:authenticatedOwner(),readProtocolState:readStorageProtocolState});
  if(protocol.reason==='server-v2'&&tab.primaryTab){
    try{
      await recoverFencedAccount();
      localOwner=storageOwnerCurrent()==='local';
      cutoverActive=await verifyStorageCutover();
      if(!cutoverActive)throw new Error('storage_fenced_recovery_marker_missing');
      protocol={allowed:true,reason:'v2-ready'};
    }catch(error){console.error('Orders fenced account recovery',error)}
  }
  if(!protocol.allowed){
    session.storageProtocolBlocked=true;
    const oldBrowser=protocol.reason==='server-v2',unsupported=protocol.reason==='protocol-unsupported';
    const message=unsupported?'גרסת האחסון של החשבון בענן אינה נתמכת בגרסה זו. אין מסלול migration בזמן ריצה; יש להשלים את הטיפול בחשבון לפני פתיחתו.':oldBrowser?'החשבון כבר עבר ל־Storage V2. הטעינה מחדש מהענן ממתינה לטאב הראשי ולחיבור תקין; העריכה תישאר נעולה אם נמצא מעבר V2 שלא הושלם.':'נדרש חיבור ואימות של מצב האחסון בענן לפני פתיחת נתונים ישנים במכשיר זה.';
    setCloud(message,'error');setSave('העריכה נעולה עד השלמת אימות האחסון','error');
    if(!tab.primaryTab)showSecondaryTabGuard();syncFolderAccessButton();return;
  }
  session.storageProtocolBlocked=false;

  if(!tab.primaryTab){
    const v2Required=!!(transfer||storageV2OwnerTransferPreparing()||cutoverActive||localEngineActive||localBirthPreparing());
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
    cutoverActive=await verifyStorageCutover();localEngineActive=await verifyLocalStorageEngine();
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

  // Shared Checks is authoritative and must be recovered before any business state becomes interactive.
  let sharedPrimary=false;
  if((cutoverActive||localEngineActive)){
    sharedPrimary=await recoverSharedChecksV2Primary();
    if(!sharedPrimary)throw new Error('orders_shared_v2_recovery_required');
  }
  if(!localEngineActive&&navigator.onLine&&loadSession()){try{await ensureSyncCapabilities();session.syncCapabilitiesError=null}catch(error){session.syncCapabilitiesError=error;setCloud(error.message,'error');}}
  if(session.syncCapabilitiesError){if(!cutoverActive||sharedPrimary)render();setCloud(session.syncCapabilitiesError.message,'error');setSave(session.syncCapabilitiesError.message,'error');return}

  if(!sharedPrimary)sharedPrimary=await recoverSharedChecksV2Primary();
  if(!sharedPrimary)throw new Error('orders_shared_v2_recovery_required');

  try{await resumeIncompleteRestore()}catch(error){console.error('restore group startup recovery',error);setCloud('ענן: שחזור ממתין','error')}

  if(!localEngineActive)await recoverOrdersLocalState();startupMark('orders-local-recovered');
  const sessionAvailable=!!loadSession(),online=!!navigator.onLine,ordersOnline=!localEngineActive&&cloudEnabled()&&online&&sessionAvailable,sharedOnline=!localEngineActive&&sessionAvailable&&online;
  beginStartupSync({orders:ordersOnline,checks:sharedOnline,finance:sharedOnline});

  render({supplierScrollMode:'end'});startupMark('first-render');
  syncFolderAccessButton();
  setSave(session.cloudDurabilityDegraded?'מקומי: מצב התאוששות':'מקומי: שמור',session.cloudDurabilityDegraded?'error':'',folderSaveTitle());

  const localServicesPromise=initializeLocalServices();
  const checksRecoveryPromise=Promise.resolve(true);
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
      if(cloudHasLocalWork())setStartupDomain('orders','deferred','שינויים מקומיים שמורים וממתינים למועד הסנכרון');
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
