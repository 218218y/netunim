import {createStartupTask} from './shared/startup-task.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({
  storageProtocol,
  storageRecovery,
  hydrateStorageOwner=async()=>{},
  hydrateLocalBirth=async()=>null,
  ensureLocalBirth=async()=>false,
  localBirthPreparing=()=>false,
  hydrateStorageV2OwnerTransfer=async()=>null,
  resumeStorageV2OwnerTransfer=async()=>null,
  storageV2OwnerTransferPreparing=()=>false,
  ensureSyncCapabilities=async()=>true,
  render=()=>{},
  hideConnectScreen=()=>{},
  session,
  tab,
  openLastFolder,
  handleCloudConnectButton,
  setCloudHeaderStatus,
  setSaveStatus=()=>{},
  setConnectedStatus=()=>{},
  requestPersistentBrowserStorage,
  showSecondaryTabGuard,
  acquirePrimaryTabLock,
  chooseFolder,
  chooseDataFile,
  restoreRememberedBackupTarget,
  supaConfigured,
  restoreSupaSession,
  resumeIncompleteRestore=async()=>false,
  showCloudNoDocument,
  tryAutoOpenSupabase,
  setConnectUI,
  showFirstRun,
  tryAutoOpenRemembered,
  startCloudPolling=()=>{}
}){
for(const method of ['check','readMarkers','verifyLocal'])if(typeof storageProtocol?.[method]!=='function')throw new TypeError(`lifecycle_storage_protocol_${method}_required`);
for(const method of ['assertBound','primary','readOnly','activate'])if(typeof storageRecovery?.[method]!=='function')throw new TypeError(`lifecycle_storage_recovery_${method}_required`);
storageRecovery.assertBound();

async function boot(){
  session.storageProtocolBlocked=true;
  await acquirePrimaryTabLock();
  // Storage ownership is durable and independent from the auth token. Establish
  // it before any account-scoped marker, snapshot or writer can be consulted.
  await hydrateStorageOwner();
  const restoredAuth=await restoreSupaSession();await hydrateLocalBirth();await hydrateStorageV2OwnerTransfer();
  let {accountV2Active,localEngineActive,protocol,recoveryError}=await storageProtocol.check({primary:tab.primaryTab,online:globalThis.navigator?.onLine!==false});
  if(recoveryError)console.error('Kupa fenced account recovery',recoveryError);
  if(!protocol.allowed){
    session.storageProtocolBlocked=true;
    const oldBrowser=protocol.reason==='server-v2',upgradeRequired=protocol.reason==='upgrade-required';
    setConnectUI({title:upgradeRequired?'נדרש שדרוג החשבון ל־Storage V2':oldBrowser?'ממתין לשחזור Storage V2 מהענן':'נדרש אימות אחסון בענן',text:upgradeRequired?'החשבון בענן עדיין בפרוטוקול אחסון ישן. העריכה בגרסה זו חסומה עד לשדרוג החשבון ל־Storage V2.':oldBrowser?'יש לפתוח טאב ראשי עם חיבור תקין כדי לטעון את נתוני החשבון מהענן. אם נמצא מעבר V2 שלא הושלם, העריכה תישאר נעולה לבדיקה.':'יש להתחבר לחשבון ולהיות מקוון כדי לאמת את מצב האחסון לפני עריכה במכשיר זה.',showCloud:!oldBrowser});
    return;
  }
  session.storageProtocolBlocked=false;
  if(!tab.primaryTab){
    const v2Required=storageV2OwnerTransferPreparing()||accountV2Active||localEngineActive||localBirthPreparing();
    let shown=false;
    if(v2Required)shown=!!(await storageRecovery.readOnly());
    if(shown){storageRecovery.activate();render()}
    showSecondaryTabGuard();
    setConnectedStatus('לקריאה בלבד');setSaveStatus(shown?'לקריאה בלבד':'קריאה בלבד — רענן לאחר סיום האתחול בטאב הראשי',shown?'':'error');
    setCloudHeaderStatus('offline',shown?'ענן: קריאה בלבד':'ענן: קריאה בלבד — הנתונים טרם זמינים');
    return;
  }
  if(storageV2OwnerTransferPreparing()){
    if(!navigator.onLine||!restoredAuth){session.backendReady=false;setConnectUI({title:'מעבר החשבון ממתין',text:'העריכה נעולה עד לחיבור מחדש לחשבון היעד ולהשלמת המעבר.',showCloud:true});return}
    try{await resumeStorageV2OwnerTransfer();({accountV2Active,localEngineActive}=await storageProtocol.readMarkers())}
    catch(error){console.error('Kupa V2 owner transfer resume',error);session.backendReady=false;setConnectUI({title:'מעבר החשבון נעצר בבטחה',text:'הנתונים נשמרו. יש להתחבר לחשבון היעד ולהשלים את המעבר לפני עריכה.',showCloud:true});return}
  }
  // Birth is a durable transition, and its Main checkpoint is not complete
  // until Shared and the local marker are verified. Keep the screen closed.
  if(!accountV2Active){
    try{await ensureLocalBirth();localEngineActive=await storageProtocol.verifyLocal();if(!localEngineActive)throw new Error('kupa_local_engine_marker_required')}
    catch(error){console.error('Kupa local V2 birth',error);setConnectUI({title:'מעבר האחסון המקומי נעצר',text:'הנתונים הישנים נשארו שמורים. העריכה חסומה עד להשלמת מעבר האחסון או בדיקת התקלה.',showCloud:false});return}
  }
  document.getElementById('chooseFolder').addEventListener('click',chooseFolder);
  document.getElementById('chooseDataFile').addEventListener('click',chooseDataFile);
  document.getElementById('openLastFolder').addEventListener('click',openLastFolder);
  document.getElementById('openCloud').addEventListener('click',handleCloudConnectButton);

  session.startupCloudHydrating=!localEngineActive&&!!navigator.onLine;
  try{await storageRecovery.primary({localEngineActive})}
  catch(error){session.backendReady=false;setConnectUI({title:'שחזור הנתונים המקומיים נעצר',text:'הנתונים נשארו שמורים והעריכה חסומה. יש לבדוק את התקלה ולרענן לאחר השלמת השחזור.',showCloud:!localEngineActive});throw error}
  const startupLocalShown=!localEngineActive;

  if(supaConfigured())setCloudHeaderStatus('syncing',startupLocalShown&&navigator.onLine?'ענן: מסנכרן…':'ענן: בודק…');else setCloudHeaderStatus('off','ענן: לא מוגדר');
  const persistentStoragePromise=requestPersistentBrowserStorage().catch(error=>console.error('persistent browser storage',error));
  await restoreRememberedBackupTarget();
  await persistentStoragePromise;

  // Shared Checks owns checks independently of Main. Hydrate it before an
  // offline or cloud-capability exit can show composed business data.
  storageRecovery.activate();
  if(startupLocalShown){session.backendReady=true;hideConnectScreen();render()}
  if(localEngineActive){session.startupCloudHydrating=false;if(await tryAutoOpenRemembered())return;showFirstRun();return}
  if(!navigator.onLine&&startupLocalShown){session.startupCloudHydrating=false;startCloudPolling();return}
  if(navigator.onLine&&restoredAuth){try{await ensureSyncCapabilities();session.syncCapabilitiesError=null}catch(error){session.syncCapabilitiesError=error;setCloudHeaderStatus('conflict',error.message);setConnectUI({title:'ה־DB אינו תואם לגרסת האתר',text:error.message,showCloud:false});}}
  if(session.syncCapabilitiesError){session.startupCloudHydrating=false;setCloudHeaderStatus('conflict',session.syncCapabilitiesError.message);return}
  try{await resumeIncompleteRestore()}catch(error){console.error('restore group startup recovery',error);setCloudHeaderStatus('conflict','ענן: שחזור ממתין')}
  let autoOpened=false;
  try{autoOpened=await tryAutoOpenSupabase()}finally{session.startupCloudHydrating=false}
  if(autoOpened)return;
  if(session.cloudAuthNoDocument){await showCloudNoDocument();return}
  if(!restoredAuth)setCloudHeaderStatus('off','ענן: נדרשת התחברות');
}

return { boot:createStartupTask(boot) };
}
