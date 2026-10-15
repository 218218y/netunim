import {startupMark} from './shared/startup-timing.js';
import {createStartupTask} from './shared/startup-task.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({
  storageProtocol,
  storageAdmission:admission,
  online,
  storageRecovery,
  cloudStartup,
  localServices,
  connectionStartup,
  hydrateStorageOwner=async()=>{},
  hydrateLocalBirth=async()=>null,
  hydrateStorageV2OwnerTransfer=async()=>null,
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

if(typeof online!=='function')throw new TypeError('lifecycle_online_required');
for(const method of ['admit','assertCurrent','assertOwner','readOnlyRequired','transferPending'])if(typeof admission?.[method]!=='function')throw new TypeError(`lifecycle_storage_admission_${method}_required`);

async function boot(){
  session.storageProtocolBlocked=true;
  startupMark('boot-start');
  await acquirePrimaryTabLock();startupMark('primary-tab-ready');
  // Storage ownership is durable and independent from the auth token. Establish
  // it before any account-scoped marker, snapshot or writer can be consulted.
  await hydrateStorageOwner();startupMark('storage-owner-ready');
  const restoredAuth=await restoreSupaSession();await hydrateLocalBirth();await hydrateStorageV2OwnerTransfer();
  let state=await storageProtocol.check({primary:tab.primaryTab,online:online()});
  admission.assertOwner(state);
  const {protocol,recoveryError}=state;
  if(recoveryError)console.error('Kupa fenced account recovery',recoveryError);
  if(!protocol.allowed){
    session.storageProtocolBlocked=true;
    const oldBrowser=protocol.reason==='server-v2',upgradeRequired=protocol.reason==='upgrade-required';
    setConnectUI({title:upgradeRequired?'נדרש שדרוג החשבון ל־Storage V2':oldBrowser?'ממתין לשחזור Storage V2 מהענן':'נדרש אימות אחסון בענן',text:upgradeRequired?'החשבון בענן עדיין בפרוטוקול אחסון ישן. העריכה בגרסה זו חסומה עד לשדרוג החשבון ל־Storage V2.':oldBrowser?'יש לפתוח טאב ראשי עם חיבור תקין כדי לטעון את נתוני החשבון מהענן. אם נמצא מעבר V2 שלא הושלם, העריכה תישאר נעולה לבדיקה.':'יש להתחבר לחשבון ולהיות מקוון כדי לאמת את מצב האחסון לפני עריכה במכשיר זה.',showCloud:!oldBrowser});
    return;
  }
  session.storageProtocolBlocked=false;
  if(!tab.primaryTab){
    const v2Required=admission.readOnlyRequired(state);
    let shown=false;
    if(v2Required){startupMark('recovery-start');shown=!!(await storageRecovery.readOnly());if(shown)startupMark('local-recovered')}
    admission.assertOwner(state);
    if(shown){storageRecovery.activate();render()}
    showSecondaryTabGuard();
    setConnectedStatus('לקריאה בלבד');setSaveStatus(shown?'לקריאה בלבד':'קריאה בלבד — רענן לאחר סיום האתחול בטאב הראשי',shown?'':'error');
    setCloudHeaderStatus('offline',shown?'ענן: קריאה בלבד':'ענן: קריאה בלבד — הנתונים טרם זמינים');
    return;
  }
  if(admission.transferPending()&&(!online()||!restoredAuth)){
    session.backendReady=false;setConnectUI({title:'???? ?????? ?????',text:'?????? ????? ?? ?????? ???? ?????? ???? ??????? ?????.',showCloud:true});return;
  }
  const admitted=await admission.admit(state);
  if(!admitted.ok){
    console.error('Kupa Storage V2 startup admission',admitted.error);session.backendReady=false;
    setConnectUI(admitted.stage==='transfer'
      ?{title:'???? ?????? ???? ?????',text:'??????? ?????. ?? ?????? ?????? ???? ??????? ?? ????? ???? ?????.',showCloud:true}
      :{title:'???? ?????? ?????? ????',text:'??????? ?????? ????? ??????. ?????? ????? ?? ?????? ???? ?????? ?? ????? ?????.',showCloud:false});return;
  }
  state=admitted.state;const {localEngineActive}=state;
  admission.assertCurrent(state);
  await connectionStartup.bind();admission.assertCurrent(state);

  await cloudStartup.prepare({localEngineActive});admission.assertCurrent(state);
  startupMark('recovery-start');
  try{await storageRecovery.primary({localEngineActive});admission.assertCurrent(state);startupMark('local-recovered')}
  catch(error){session.backendReady=false;setConnectUI({title:'שחזור הנתונים המקומיים נעצר',text:'הנתונים נשארו שמורים והעריכה חסומה. יש לבדוק את התקלה ולרענן לאחר השלמת השחזור.',showCloud:!localEngineActive});throw error}
  // Shared Checks owns checks independently of Main. Hydrate it before an
  // offline or cloud-capability exit can show composed business data.
  storageRecovery.activate();
  if(!localEngineActive){session.backendReady=true;hideConnectScreen();render()}
  // Optional browser/folder services no longer delay the first recovered view.
  // They still finish before remote hydration/automatic file opening so backup
  // target selection keeps its existing ordering and ownership.
  await localServices.start();
  await cloudStartup.hydrate();
  if(localEngineActive)await connectionStartup.openLocal();
}

return { boot:createStartupTask(async()=>{try{return await boot()}catch(error){session.storageProtocolBlocked=true;throw error}}) };
}
