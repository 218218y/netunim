import {clone} from './core/values.js';
import {createStartupTask} from './shared/startup-task.js';

function startupMark(name){try{globalThis.performance?.mark?.(`orders-startup:${name}`)}catch{}}
function nextTurn(){return new Promise(resolve=>setTimeout(resolve,0))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({
  storageProtocol,
  storageRecovery,
  hydrateStorageOwner=async()=>{},
  hydrateStorageV2OwnerTransfer=async()=>null,
  resumeStorageV2OwnerTransfer=async()=>null,
  storageV2OwnerTransferPreparing=()=>false,
  hydrateLocalBirth=async()=>null,
  ensureLocalBirth=async()=>null,
  localBirthPreparing=()=>false,
  ensureSyncCapabilities=async()=>true,
  files,
  tab,
  session,
  checksSession,
  resumeIncompleteRestore=async()=>false,
  refreshStorageV2CloudState=async()=>null,
  cloudHasLocalWork=()=>false,
  sharedChecksHasLocalWork=()=>true,
  setSave=()=>{},
  setCloud=()=>{},
  beginStartupSync=()=>{},
  setStartupDomain=()=>{},
  syncFolderAccessButton,
  folderBackupAvailable,
  folderSaveTitle=()=>'',
  showSecondaryTabGuard,
  acquirePrimaryTabLock,
  render,
  prepareState,
  maybeCreateAutomaticFolderBackup,
  loadDirHandle,
  requestPersistentBrowserStorage,
  refreshDirPermission,
  loadSession,
  cloudEnabled,
  refreshKupaReadout,
  syncSharedChecksFromCloud,
  openCloud,
  startOrderPolling=()=>{},
  startFinanceAutoSync=()=>{},
  prepareStartupAlerts=async()=>false,
  showStartupAlerts=()=>{}
}){
for(const method of ['check','readMarkers','verifyLocal'])if(typeof storageProtocol?.[method]!=='function')throw new TypeError(`lifecycle_storage_protocol_${method}_required`);
for(const method of ['assertBound','primary','readOnly','activate'])if(typeof storageRecovery?.[method]!=='function')throw new TypeError(`lifecycle_storage_recovery_${method}_required`);
storageRecovery.assertBound();

async function recoverOrdersLocalState(){
  const v2=await refreshStorageV2CloudState();
  if(!v2?.base)throw new Error('orders_v2_cloud_head_missing');
  session.lastCloudState=clone(v2.base.state);
  session.cloudRevision=Number(v2.base.revision||0);
  session.storageV2CloudPending=!!(v2.pending||v2.flight);
  session.cloudConflictBlocked=!!v2.control?.conflict;
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

async function hydrateSecondaryDomains({sharedOnline,ordersOnline,localServicesPromise}){
  if(sharedOnline){
    setStartupDomain('checks','loading');startupMark('checks-start');
    let checksOk=false;
    try{checksOk=await syncSharedChecksFromCloud({quiet:true,required:false})}catch(error){console.error('shared checks startup',error);checksSession.checksCloudLastError=error?.message||String(error)}
    startupMark('checks-end');
    if(checksOk)setStartupDomain('checks','ready');
    else if(sharedChecksHasLocalWork()||checksSession.checksSaveRequested)setStartupDomain('checks','deferred',checksSession.checksCloudLastError||'שינויי הצ׳קים נשמרו מקומית וממתינים לסנכרון');
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

async function boot(){
  session.storageProtocolBlocked=true;
  startupMark('boot-start');
  await acquirePrimaryTabLock();startupMark('primary-tab-ready');
  await hydrateStorageOwner();startupMark('storage-owner-ready');
  loadSession();
  const transfer=await hydrateStorageV2OwnerTransfer();
  await hydrateLocalBirth();
  let {owner,accountV2Active,localEngineActive,protocol,recoveryError}=await storageProtocol.check({primary:tab.primaryTab,online:globalThis.navigator?.onLine!==false});
  if(recoveryError)console.error('Orders fenced account recovery',recoveryError);
  if(!protocol.allowed){
    session.storageProtocolBlocked=true;
    const oldBrowser=protocol.reason==='server-v2',upgradeRequired=protocol.reason==='upgrade-required';
    const message=upgradeRequired?'החשבון בענן עדיין בפרוטוקול אחסון ישן. העריכה בגרסה זו חסומה עד לשדרוג החשבון ל־Storage V2.':oldBrowser?'החשבון כבר עבר ל־Storage V2. הטעינה מחדש מהענן ממתינה לטאב הראשי ולחיבור תקין; העריכה תישאר נעולה אם נמצא מעבר V2 שלא הושלם.':'נדרש חיבור ואימות של מצב האחסון בענן לפני פתיחת נתונים ישנים במכשיר זה.';
    setCloud(message,'error');setSave('העריכה נעולה עד השלמת אימות האחסון','error');
    if(!tab.primaryTab)showSecondaryTabGuard();syncFolderAccessButton();return;
  }
  session.storageProtocolBlocked=false;

  if(!tab.primaryTab){
    const v2Required=!!(transfer||storageV2OwnerTransferPreparing()||accountV2Active||localEngineActive||localBirthPreparing());
    let shown=false;
    if(v2Required)shown=!!(await storageRecovery.readOnly());
    if(shown){storageRecovery.activate();render({supplierScrollMode:'end'});startupMark('first-render');setCloud('ענן: קריאה בלבד','offline');setSave('מקומי: קריאה בלבד','',folderSaveTitle())}
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
    ({owner,accountV2Active,localEngineActive}=await storageProtocol.readMarkers());
  }
  if(owner==='local'){
    try{
      if(!localEngineActive){await ensureLocalBirth();localEngineActive=await storageProtocol.verifyLocal()}
      if(!localEngineActive)throw new Error('orders_local_engine_marker_required');
    }catch(error){
      console.error('Orders local Storage V2 birth',error);
      setCloud('ענן: אחסון מקומי דורש השלמה','error');
      setSave('העריכה נעולה עד השלמת מעבר האחסון המקומי','error');
      syncFolderAccessButton();return;
    }
  }else if(!accountV2Active)throw new Error('orders_v2_account_marker_required');

  // Shared Checks must recover before business state is rendered.
  try{await storageRecovery.primary({localEngineActive})}
  catch(error){setSave('שחזור הנתונים המקומיים נעצר; העריכה נשארת חסומה','error');setCloud('ענן: ממתין לשחזור מקומי תקין','error');syncFolderAccessButton();throw error}
  if(!localEngineActive&&navigator.onLine&&loadSession()){try{await ensureSyncCapabilities();session.syncCapabilitiesError=null}catch(error){session.syncCapabilitiesError=error;setCloud(error.message,'error');}}
  if(session.syncCapabilitiesError){storageRecovery.activate();render();setCloud(session.syncCapabilitiesError.message,'error');setSave(session.syncCapabilitiesError.message,'error');return}

  try{await resumeIncompleteRestore()}catch(error){console.error('restore group startup recovery',error);setCloud('ענן: שחזור ממתין','error')}

  if(!localEngineActive)await recoverOrdersLocalState();startupMark('orders-local-recovered');
  const sessionAvailable=!!loadSession(),online=!!navigator.onLine,ordersOnline=!localEngineActive&&cloudEnabled()&&online&&sessionAvailable,sharedOnline=!localEngineActive&&sessionAvailable&&online;
  beginStartupSync({orders:ordersOnline,checks:sharedOnline,finance:sharedOnline});

  storageRecovery.activate();
  render({supplierScrollMode:'end'});startupMark('first-render');
  syncFolderAccessButton();
  setSave(session.cloudDurabilityDegraded?'מקומי: מצב התאוששות':'מקומי: שמור',session.cloudDurabilityDegraded?'error':'',folderSaveTitle());

  const localServicesPromise=initializeLocalServices();
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
      const pending=await refreshStorageV2CloudState();
      if(pending?.pending||pending?.flight||cloudHasLocalWork())setStartupDomain('orders','deferred','שינויים מקומיים שמורים וממתינים למועד הסנכרון');
      else setStartupDomain('orders','ready');
    }
  }

  if(sharedOnline){
    session.startupHydrationPromise=hydrateSecondaryDomains({sharedOnline,ordersOnline,localServicesPromise}).catch(async error=>{console.error('secondary startup hydration',error);await prepareAlertsBeforeDisplay();showStartupAlerts();startFinanceAutoSync()});
  }else{
    session.startupHydrationPromise=backupAfterHydration(localServicesPromise).then(async()=>{await prepareAlertsBeforeDisplay();showStartupAlerts();startFinanceAutoSync();startupMark('background-ready')}).catch(async error=>{console.error('startup background',error);await prepareAlertsBeforeDisplay();showStartupAlerts();startFinanceAutoSync()});
  }
}

return { boot:createStartupTask(boot) };
}
