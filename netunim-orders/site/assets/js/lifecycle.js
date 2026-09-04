import {clone} from './core/values.js';
import {CLOUD_BASE_KEY} from './state/constants.js';

function startupMark(name){try{globalThis.performance?.mark?.(`orders-startup:${name}`)}catch{}}
function nextTurn(){return new Promise(resolve=>setTimeout(resolve,0))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createLifecycle({model, files, tab, ui, session, checksSession, normalizeState, restoreBrowserStateFallback, markCloudPending, getCloudPending, loadCloudPendingState, getChecksPending, checksPendingExists, setSave, setCloud, beginStartupSync=()=>{}, setStartupDomain=()=>{}, syncFolderAccessButton, folderBackupAvailable, folderSaveTitle, showSecondaryTabGuard, acquirePrimaryTabLock, sameOrderCloudData, hasMeaningfulLocalData, render, prepareState, maybeCreateAutomaticFolderBackup, loadDirHandle, requestPersistentBrowserStorage, refreshDirPermission, loadSession, cloudEnabled, refreshKupaReadout, syncSharedChecksFromCloud, openCloud, startOrderPolling=()=>{}, startFinanceAutoSync=()=>{}, showStartupAlerts=()=>{}}){
async function recoverOrdersLocalState(){
  try{session.lastCloudState=JSON.parse(localStorage.getItem(CLOUD_BASE_KEY)||'null')}catch(e){console.error('orders cloud base load',e)}
  const durablePending=await getCloudPending(),pending=durablePending?.snapshot||loadCloudPendingState();
  if(pending){
    model.state=normalizeState(clone(pending));session.localGeneration=Math.max(session.localGeneration,Number(durablePending?.generation||1));session.cloudSaveRequested=true;return;
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
      if(pending?.snapshot){model.state.checks=clone(pending.snapshot);if(['checks','kupa','summary'].includes(ui.currentView))render()}
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
  showStartupAlerts();
  startFinanceAutoSync();
  startupMark('background-ready');
}

async function boot(){
  startupMark('boot-start');
  await acquirePrimaryTabLock();startupMark('primary-tab-ready');
  try{await restoreBrowserStateFallback()}catch(e){console.error('browser state recovery',e)}

  if(!tab.primaryTab){
    setCloud('ענן: לשונית משנית','offline');render({supplierScrollMode:'end'});startupMark('first-render');showSecondaryTabGuard();syncFolderAccessButton();setSave('מקומי: קריאה בלבד','',folderSaveTitle());
    void initializeLocalServices();
    return;
  }

  await recoverOrdersLocalState();startupMark('orders-local-recovered');
  const sessionAvailable=!!loadSession(),online=!!navigator.onLine,ordersOnline=cloudEnabled()&&online&&sessionAvailable,sharedOnline=sessionAvailable&&online;
  beginStartupSync({orders:ordersOnline,checks:sharedOnline,finance:sharedOnline});

  render({supplierScrollMode:'end'});startupMark('first-render');
  syncFolderAccessButton();
  setSave(session.cloudDurabilityDegraded?'מקומי: מצב התאוששות':'מקומי: שמור',session.cloudDurabilityDegraded?'error':'',folderSaveTitle());

  const localServicesPromise=initializeLocalServices();
  const checksRecoveryPromise=recoverChecksLocalState();
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
      if(pending)setStartupDomain('orders','deferred','שינויים מקומיים שמורים וממתינים למועד הסנכרון');
      else setStartupDomain('orders','ready');
    }
  }

  if(sharedOnline){
    session.startupHydrationPromise=hydrateSecondaryDomains({sharedOnline,ordersOnline,checksRecoveryPromise,localServicesPromise}).catch(error=>{console.error('secondary startup hydration',error);showStartupAlerts();startFinanceAutoSync()});
  }else{
    await checksRecoveryPromise;
    session.startupHydrationPromise=backupAfterHydration(localServicesPromise).then(()=>{showStartupAlerts();startFinanceAutoSync();startupMark('background-ready')}).catch(error=>{console.error('startup background',error);showStartupAlerts();startFinanceAutoSync()});
  }
}

return { boot };
}
