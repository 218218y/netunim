import {createStartupTask} from './shared/startup-task.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({
  storageProtocol,
  storageRecovery,
  cloudStartup,
  localServices,
  connectionStartup,
  hydrateStorageOwner=async()=>{},
  hydrateLocalBirth=async()=>null,
  ensureLocalBirth=async()=>false,
  localBirthPreparing=()=>false,
  hydrateStorageV2OwnerTransfer=async()=>null,
  resumeStorageV2OwnerTransfer=async()=>null,
  storageV2OwnerTransferPreparing=()=>false,
  render=()=>{},
  hideConnectScreen=()=>{},
  session,
  tab,
  setCloudHeaderStatus,
  setSaveStatus=()=>{},
  setConnectedStatus=()=>{},
  showSecondaryTabGuard,
  acquirePrimaryTabLock,
  restoreSupaSession,
  setConnectUI,
}){
for(const method of ['check','readMarkers','verifyLocal'])if(typeof storageProtocol?.[method]!=='function')throw new TypeError(`lifecycle_storage_protocol_${method}_required`);
for(const method of ['assertBound','primary','readOnly','activate'])if(typeof storageRecovery?.[method]!=='function')throw new TypeError(`lifecycle_storage_recovery_${method}_required`);
storageRecovery.assertBound();
for(const [name,port,methods] of [
  ['cloud',cloudStartup,['prepare','hydrate']],['local',localServices,['start']],
  ['connection',connectionStartup,['bind','openLocal']],
])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`lifecycle_${name}_${method}_required`);

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
  await connectionStartup.bind();

  await cloudStartup.prepare({localEngineActive});
  try{await storageRecovery.primary({localEngineActive})}
  catch(error){session.backendReady=false;setConnectUI({title:'שחזור הנתונים המקומיים נעצר',text:'הנתונים נשארו שמורים והעריכה חסומה. יש לבדוק את התקלה ולרענן לאחר השלמת השחזור.',showCloud:!localEngineActive});throw error}
  // Shared Checks owns checks independently of Main. Hydrate it before an
  // offline or cloud-capability exit can show composed business data.
  storageRecovery.activate();
  if(!localEngineActive){session.backendReady=true;hideConnectScreen();render()}
  // Optional browser/folder services no longer delay the first recovered view.
  // They still finish before remote hydration/automatic file opening so backup
  // target selection keeps its existing ordering and ownership.
  session.startupLocalServicesPromise=localServices.start();
  await session.startupLocalServicesPromise;
  await cloudStartup.hydrate();
  if(localEngineActive)await connectionStartup.openLocal();
}

return { boot:createStartupTask(boot) };
}
