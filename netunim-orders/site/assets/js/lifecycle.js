import {createStartupTask} from './shared/startup-task.js';
import {startupMark} from './startup/marks.js';

function nextTurn(){return new Promise(resolve=>setTimeout(resolve,0))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({
  storageProtocol,
  storageRecovery,
  cloudStartup,
  localServices,
  backgroundStartup,
  hydrateStorageOwner=async()=>{},
  hydrateStorageV2OwnerTransfer=async()=>null,
  resumeStorageV2OwnerTransfer=async()=>null,
  storageV2OwnerTransferPreparing=()=>false,
  hydrateLocalBirth=async()=>null,
  ensureLocalBirth=async()=>null,
  localBirthPreparing=()=>false,
  ensureSyncCapabilities=async()=>true,
  tab,
  session,
  resumeIncompleteRestore=async()=>false,
  setSave=()=>{},
  setCloud=()=>{},
  syncFolderAccessButton,
  folderSaveTitle=()=>'',
  showSecondaryTabGuard,
  acquirePrimaryTabLock,
  render,
  loadSession,
}){
for(const method of ['check','readMarkers','verifyLocal'])if(typeof storageProtocol?.[method]!=='function')throw new TypeError(`lifecycle_storage_protocol_${method}_required`);
for(const method of ['assertBound','primary','readOnly','activate'])if(typeof storageRecovery?.[method]!=='function')throw new TypeError(`lifecycle_storage_recovery_${method}_required`);
storageRecovery.assertBound();
for(const [name,port,methods] of [
  ['cloud',cloudStartup,['prepare','hydrateMain','hydrateSecondary']],
  ['local',localServices,['start']],['background',backgroundStartup,['start']],
])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`lifecycle_${name}_${method}_required`);

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

  const plan=await cloudStartup.prepare({localEngineActive});
  storageRecovery.activate();
  render({supplierScrollMode:'end'});startupMark('first-render');
  syncFolderAccessButton();
  setSave(session.cloudDurabilityDegraded?'מקומי: מצב התאוששות':'מקומי: שמור',session.cloudDurabilityDegraded?'error':'',folderSaveTitle());

  void localServices.start().catch(error=>console.error('local services startup',error));
  await nextTurn();
  await cloudStartup.hydrateMain();
  session.startupHydrationPromise=cloudStartup.hydrateSecondary().then(()=>backgroundStartup.start(plan));
  // Observe unexpected failures without replacing the original rejected task or
  // replaying completed effects. Normal network failures are domain outcomes.
  void session.startupHydrationPromise.catch(error=>console.error('startup hydration/background',error));
}

return { boot:createStartupTask(boot) };
}
