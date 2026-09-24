import {esc, clone} from '../core/values.js';
import {CLOUD_EMAIL_KEY, $, CLOUD_AUTO_KEY, CLOUD_BASE_KEY} from '../state/constants.js';
import {getOutboxRetryDelay} from '../shared/cloud-sync.js';

const CLOUD_RECOVERY_DELAYS_MS=[15_000,30_000,60_000,120_000];

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiCloud({model, files, tab, session, checksSession, ui, modal, supaConfigured, toast, closeModal, authPassword, localSnapshot:writeLocalSnapshot, markCloudPending, getCloudPending=async()=>null, clearCloudPending, setCloud, showSecondaryTabGuard, prepareCloudState, render, writeStateToFolder, loadSession, readCloud, applyOrderCloudState, refreshKupaReadout, syncSharedChecksFromCloud, requestCloudSave, restorePendingAgainstCloud, startPolling, saveSession, renderSettings, resumeCalendarAfterCloudLogin, startFinanceAutoSync=()=>{}, prepareAuthenticatedStorageOwner=async()=>null, storageOwnerCurrent=()=>null, storageOwnerAdoption=()=>null, adoptAuthenticatedStorageOwner=async()=>true, startStorageV2OwnerTransfer=async()=>{throw new Error('storage_transfer_unavailable')}, storageV2CloudOutboxActive=()=>false, storageV2PrimaryRequested=()=>false, refreshStorageV2CloudState=async()=>null, initializeStorageV2CloudCursor=async()=>false, adoptStorageV2CloudHead=async()=>null}){
const localSnapshot=(source,options)=>writeLocalSnapshot(source,options||{storageBoundary:'cloud-ui-state'});
function clearCloudRecovery(){if(session.cloudRecoveryTimer){clearTimeout(session.cloudRecoveryTimer);session.cloudRecoveryTimer=null}session.cloudRecoveryAttempt=0}
function scheduleCloudRecovery(){
  if(!tab.primaryTab||!navigator.onLine||localStorage.getItem(CLOUD_AUTO_KEY)!=='1'||!loadSession()||session.cloudRecoveryTimer)return;
  const index=Math.min(Number(session.cloudRecoveryAttempt||0),CLOUD_RECOVERY_DELAYS_MS.length-1),delay=CLOUD_RECOVERY_DELAYS_MS[index];session.cloudRecoveryAttempt=Math.min(index+1,CLOUD_RECOVERY_DELAYS_MS.length-1);
  session.cloudRecoveryTimer=setTimeout(()=>{session.cloudRecoveryTimer=null;void openCloud({renderAfter:true,quiet:true})},delay);
}
async function persistAuthoritativeCloudHead(){
  if(storageV2CloudOutboxActive()){await adoptStorageV2CloudHead(session.cloudRevision,model.state);return true}
  const ok=localSnapshot();if(ok===false)return false;
  try{await initializeStorageV2CloudCursor(session.cloudRevision)}catch(error){console.error('orders V2 cloud cursor initialization',error)}
  return true
}
function loginModal(mode='open'){if(!supaConfigured())return alert('הגדרת Supabase חסרה. בדוק supabase/config.js');const email=localStorage.getItem(CLOUD_EMAIL_KEY)||'',calendarMode=mode==='calendar',title=calendarMode?'התחברות לענן לצורך Google Calendar':mode==='upload'?'הפעלת ענן נפרד לניהול הזמנות':'פתיחת ניהול הזמנות מהענן',notice=calendarMode?'השרת המקומי הוא כתובת נפרדת מהאתר שברשת, ולכן הדפדפן דורש כאן התחברות חד-פעמית ל-Supabase. ההתחברות מזהה את המשתמש לצורך Google Calendar בלבד ואינה מפעילה מעצמה את סנכרון מסמך ניהול ההזמנות.':`ניהול ההזמנות נשמר בטבלאות <b>order_management_*</b>. טאב הצ'קים קורא וכותב ישירות למאגר הצ'קים המשותף <b>shared_checks_documents/main</b>. בנוסף, נתוני העו״ש והאשראי נקראים מאותו מסמך קופה <b>kupa_documents/main</b>, וסנכרון בנק/אשראי מניהול ההזמנות מעדכן בו רק את התחומים הפיננסיים המתאימים דרך מנגנון ה-revision של הקופה. הוצאות ומזומן נשארים בבעלות ניהול הקופה, ואין עותק פיננסי נוסף בניהול ההזמנות.`;modal(title,`<div class="form-grid"><div class="field full"><div class="notice">${notice}</div></div><div class="field full"><label>אימייל Supabase Auth</label><input id="cEmail" type="email" value="${esc(email)}"></div><div class="field full"><label>סיסמה</label><input id="cPassword" type="password"></div></div>`,`<button class="btn primary" data-action="finish-cloud-login" data-click-arg0="${esc(mode)}">התחבר</button><button class="btn" data-action="close-modal">ביטול</button>`)}

async function deferPendingRecovery({manageStatus=true,startPoll=true}={}){
  if(storageV2CloudOutboxActive()){
    const state=await refreshStorageV2CloudState();
    if(state?.control?.conflict){session.cloudConflictBlocked=true;if(manageStatus)setCloud('ענן: התנגשות','error');return true}
    if(state?.pending||state?.flight){localStorage.setItem(CLOUD_AUTO_KEY,'1');if(manageStatus)setCloud('ענן: מסנכרן…');await requestCloudSave('שינויים מקומיים ממתינים לסנכרון');if(startPoll)startPolling();return true}
  }
  if(storageV2PrimaryRequested()){
    const state=await refreshStorageV2CloudState();
    if(!state?.base||!storageV2CloudOutboxActive())throw new Error('orders_v2_owner_head_required');
    return false;
  }
  const pending=await getCloudPending();if(!pending||getOutboxRetryDelay(pending)<=0)return false;localStorage.setItem(CLOUD_AUTO_KEY,'1');if(manageStatus)setCloud('ענן: ממתין למועד הסנכרון');await requestCloudSave('שינויים מקומיים ממתינים לסנכרון');if(startPoll)startPolling();return true
}

async function finishCloudLogin(mode){const email=$('#cEmail').value.trim(),pass=$('#cPassword').value;if(!email||!pass)return toast('יש להזין אימייל וסיסמה');try{await authPassword(email,pass)}catch(e){console.error(e);toast('התחברות נכשלה: '+e.message);return}closeModal();try{if(mode==='calendar'){if(typeof resumeCalendarAfterCloudLogin!=='function')throw new Error('המשך החיבור ליומן אינו זמין');await resumeCalendarAfterCloudLogin();return}if(mode==='upload')await enableCloud(true);else await openCloud()}catch(e){console.error(e);toast((mode==='calendar'?'חיבור Google Calendar נכשל: ':'פתיחת הענן נכשלה: ')+e.message)} }

async function effectiveOwnerIntent(requested){
  const pending=storageOwnerAdoption();
  if(pending){const reserved=await prepareAuthenticatedStorageOwner(pending.intent);return reserved?.intent||pending.intent}
  const reserved=await prepareAuthenticatedStorageOwner(requested);return reserved?.intent||requested
}

async function transferLocalV2(intent,{renderAfter=true,startPoll=true}={}){
  const targetOwner=String(loadSession()?.user?.id||'').trim();
  if(!targetOwner)throw new Error('storage_transfer_target_reauth_required');
  const result=await startStorageV2OwnerTransfer({targetOwner,intent});
  if(storageOwnerCurrent()!==targetOwner)throw new Error('storage_transfer_activation_unverified');
  session.cloudRevision=Number(result.mainRevision);checksSession.checksCloudRevision=Number(result.sharedRevision);
  session.lastCloudState=prepareCloudState(model.state);session.cloudConflictBlocked=false;
  localStorage.setItem(CLOUD_AUTO_KEY,'1');setCloud('ענן: מסונכרן','synced');
  if(renderAfter)render();if(startPoll){startPolling();startFinanceAutoSync()}
  clearCloudRecovery();return true;
}

async function enableCloud(afterLogin=false){
  if(!tab.primaryTab)return showSecondaryTabGuard();if(!supaConfigured())return alert('הגדרת Supabase חסרה');if(!loadSession()&&!afterLogin)return loginModal('upload');
  try{
    setCloud('ענן: בודק…');
    const localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(localOwner&&storageV2PrimaryRequested())return await transferLocalV2('upload-local');
    if(!localOwner&&await deferPendingRecovery())return;
    const existing=await readCloud(),v2Head=await refreshStorageV2CloudState();
    let ownerIntent=reserved?.intent||null;if(!ownerIntent)ownerIntent=await effectiveOwnerIntent(existing?'load-account':'upload-local');
    if(ownerIntent==='load-account'&&!existing)throw new Error('storage_owner_reserved_account_document_missing');
    if((storageV2PrimaryRequested()&&!v2Head?.base)||(v2Head&&(!existing||!v2Head.base)))throw new Error('orders_v2_owner_bootstrap_required');
    if(storageV2PrimaryRequested()&&!storageV2CloudOutboxActive())throw new Error('orders_v2_legacy_head_not_clean');
    localStorage.setItem(CLOUD_AUTO_KEY,'1');
    if(existing){
      const localPending=localOwner?await getCloudPending():null;
      if(localOwner&&ownerIntent==='load-account'&&localPending)throw new Error('storage_owner_local_pending_requires_upload');
      const restored=ownerIntent==='upload-local'||!localOwner?await restorePendingAgainstCloud(existing):false;
      if(!restored){
        session.cloudConflictBlocked=false;applyOrderCloudState(existing.state);session.cloudRevision=Number(existing.revision||0);session.cloudUpdatedAt=existing.updated_at||session.cloudUpdatedAt;session.lastCloudState=prepareCloudState(model.state);if(!storageV2CloudOutboxActive())localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState));await persistAuthoritativeCloudHead();
        try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
      }
      setCloud('ענן: מסנכרן צ׳קים…');
    }else{
      if(ownerIntent!=='upload-local')throw new Error('storage_owner_upload_intent_required');
      session.cloudRevision=0;session.lastCloudState=clone(prepareCloudState());localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState));
      const existingPending=await getCloudPending();if(!existingPending){markCloudPending();session.localGeneration=Math.max(session.localGeneration,1)}
      await requestCloudSave('נתוני ניהול ההזמנות הועלו לענן הנפרד');setCloud('ענן: מסנכרן צ׳קים…');
    }
    await syncSharedChecksFromCloud({quiet:true,required:true});await adoptAuthenticatedStorageOwner(ownerIntent);
    setCloud('ענן: מסונכרן','synced');render();if(existing)toast('כבר היה מסמך ניהול הזמנות בענן — נטענה גרסת הענן ולא נדרסה.');
    const financeOk=await refreshKupaReadout({force:true,renderIfChanged:true});if(!financeOk)console.warn('finance readout unavailable after orders cloud enable; header status remains scoped to orders + checks');startPolling();startFinanceAutoSync();clearCloudRecovery();
  }catch(e){console.error(e);toast('לא ניתן להפעיל ענן: '+e.message);setCloud('ענן: שגיאה','error')}
}

async function openCloud({renderAfter=true,quiet=false,hydrateSecondary=true,manageStatus=true,startPoll=true}={}){
  if(!tab.primaryTab)return false;if(!loadSession()){if(!quiet)loginModal('open');return false}
  try{
    if(manageStatus)setCloud('ענן: מאמת נתוני הזמנות…');
    let localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(localOwner&&storageV2PrimaryRequested())return await transferLocalV2('load-account',{renderAfter,startPoll});
    if(reserved?.intent==='upload-local')return enableCloud(false);
    if(!localOwner&&await deferPendingRecovery({manageStatus,startPoll}))return true;
    const row=await readCloud(),v2Head=await refreshStorageV2CloudState();
    if((storageV2PrimaryRequested()&&!v2Head?.base)||(v2Head&&!v2Head.base))throw new Error('orders_v2_account_head_initialization_required');if(storageV2PrimaryRequested()&&!storageV2CloudOutboxActive())throw new Error('orders_v2_legacy_head_not_clean');
    if(!row){clearCloudRecovery();if(manageStatus)setCloud('ענן: אין מסמך','error');if(!quiet)toast('אין עדיין מסמך ניהול הזמנות בענן. השתמש ב"הפעל ענן והעלה".');return false}
    let ownerIntent=reserved?.intent||null;if(localOwner&&!ownerIntent)ownerIntent=await effectiveOwnerIntent('load-account');
    localOwner=storageOwnerCurrent()==='local';
    localStorage.setItem(CLOUD_AUTO_KEY,'1');
    if(localOwner){
      const localPending=await getCloudPending();if(localPending)throw new Error('storage_owner_local_pending_requires_upload');if(v2Head?.pending||v2Head?.flight||v2Head?.control)throw new Error('storage_owner_local_v2_work_requires_recovery');
      session.cloudConflictBlocked=false;applyOrderCloudState(row.state);session.cloudRevision=Number(row.revision||0);session.cloudUpdatedAt=row.updated_at||session.cloudUpdatedAt;session.lastCloudState=prepareCloudState(model.state);if(!storageV2CloudOutboxActive())localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState));await persistAuthoritativeCloudHead();
      try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
    }else{
      const restored=await restorePendingAgainstCloud(row);if(!restored){session.cloudConflictBlocked=false;applyOrderCloudState(row.state);session.cloudRevision=Number(row.revision||0);session.cloudUpdatedAt=row.updated_at||session.cloudUpdatedAt;session.lastCloudState=prepareCloudState(model.state);if(!storageV2CloudOutboxActive())localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState));await persistAuthoritativeCloudHead();try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}}
    }
    // For an already-bound owner, the verified Orders core can paint immediately
    // while Shared Checks/finance hydrate in sequence. During local->account
    // adoption we deliberately keep the target state non-interactive until both
    // Main and Shared are prepared and the durable owner flip has committed.
    const renderCoreEarly=renderAfter&&!localOwner;if(renderCoreEarly)render();
    const hydrateChecks=hydrateSecondary||localOwner;
    if(hydrateChecks){if(manageStatus)setCloud('ענן: מסנכרן צ׳קים…');await syncSharedChecksFromCloud({quiet:true,required:true});if(localOwner)await adoptAuthenticatedStorageOwner(ownerIntent||'load-account');if(manageStatus)setCloud('ענן: מסונכרן','synced');const financeOk=await refreshKupaReadout({force:true,renderIfChanged:true});if(!financeOk)console.warn('finance readout unavailable after orders cloud open; header status remains scoped to orders + checks');if(startPoll)startPolling();startFinanceAutoSync()}
    else{if(startPoll)startPolling();if(manageStatus)setCloud(session.cloudConflictBlocked?'ענן: התנגשות':'ענן: נתוני הזמנות אומתו',session.cloudConflictBlocked?'error':'')}
    closeModal();if(renderAfter&&!renderCoreEarly)render();clearCloudRecovery();if(!quiet&&!session.cloudConflictBlocked)toast('ניהול ההזמנות נטען מהענן');return true
  }catch(e){console.error(e);if(!quiet)toast('פתיחת הענן נכשלה: '+e.message);if(manageStatus)setCloud(navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין',navigator.onLine?'':'offline');scheduleCloudRecovery();return false}
}

function logoutCloud(){
  // Logout clears authorization only. activeStorageOwner is durable and remains
  // unchanged, so account data can never fall through to the local namespace.
  clearCloudRecovery();saveSession(null);localStorage.removeItem(CLOUD_AUTO_KEY);session.cloudRevision=0;session.cloudUpdatedAt=null;checksSession.checksCloudRevision=0;checksSession.checksCloudUpdatedAt=null;session.cloudConflictBlocked=false;session.cloudSaveRequested=false;session.cloudPollingEnabled=false;clearTimeout(session.cloudPollTimer);setCloud('ענן: לא פעיל');renderSettings();toast('נותקת מהענן; בעלות האחסון והנתונים המקומיים נשמרו עד להתחברות מחדש');return true
}

return { loginModal, finishCloudLogin, enableCloud, openCloud, logoutCloud };
}
