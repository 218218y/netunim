import {esc} from '../core/values.js';
import {CLOUD_EMAIL_KEY, $, CLOUD_AUTO_KEY} from '../state/constants.js';
import {beginLocalSiteResetNavigation} from '../shared/local-site-reset.js';

const CLOUD_RECOVERY_DELAYS_MS=[15_000,30_000,60_000,120_000];

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiCloud({model, files, tab, session, checksSession, ui, modal, confirmDialog, supaConfigured, toast, closeModal, authPassword, authPasswordForLocalReset, setCloud, showSecondaryTabGuard, prepareCloudState, render, writeStateToFolder, loadSession, readCloud, verifyLocalResetCloud, applyOrderCloudState, composeOrderCloudState=(cloud,current)=>({...structuredClone(cloud),checks:structuredClone(current.checks||[])}), refreshKupaReadout, syncSharedChecksFromCloud, requestCloudSave, startPolling, saveSession, renderSettings, resumeCalendarAfterCloudLogin, startFinanceAutoSync=()=>{}, storageOwnerCurrent=()=>null, storageOwnerAdoption=()=>null, startStorageV2OwnerTransfer=async()=>{throw new Error('storage_transfer_unavailable')}, storageV2CloudOutboxActive=()=>false, storageV2PrimaryRequested=()=>false, refreshStorageV2CloudState=async()=>null, adoptStorageV2CloudHead=async()=>null, storageV2CommitPromise=()=>Promise.resolve()}){
function clearCloudRecovery(){if(session.cloudRecoveryTimer){clearTimeout(session.cloudRecoveryTimer);session.cloudRecoveryTimer=null}session.cloudRecoveryAttempt=0}
function scheduleCloudRecovery(){
  if(!tab.primaryTab||!navigator.onLine||localStorage.getItem(CLOUD_AUTO_KEY)!=='1'||!loadSession()||session.cloudRecoveryTimer)return;
  const index=Math.min(Number(session.cloudRecoveryAttempt||0),CLOUD_RECOVERY_DELAYS_MS.length-1),delay=CLOUD_RECOVERY_DELAYS_MS[index];session.cloudRecoveryAttempt=Math.min(index+1,CLOUD_RECOVERY_DELAYS_MS.length-1);
  session.cloudRecoveryTimer=setTimeout(()=>{session.cloudRecoveryTimer=null;void openCloud({renderAfter:true,quiet:true})},delay);
}
function loginModal(mode='open'){if(!supaConfigured())return alert('הגדרת Supabase חסרה. בדוק supabase/config.js');const email=localStorage.getItem(CLOUD_EMAIL_KEY)||'',calendarMode=mode==='calendar',resetMode=mode==='reset',title=resetMode?'אימות ענן לפני איפוס מקומי':calendarMode?'התחברות לענן לצורך Google Calendar':mode==='upload'?'הפעלת ענן נפרד לניהול הזמנות':'פתיחת ניהול הזמנות מהענן',notice=resetMode?'ההתחברות כאן משמשת רק לאימות שמסמך ניהול ההזמנות ומסמך הצ׳קים קיימים ונגישים בענן לפני מחיקת האחסון המקומי. היא אינה פותחת, ממזגת או מעלה נתונים.':calendarMode?'השרת המקומי הוא כתובת נפרדת מהאתר שברשת, ולכן הדפדפן דורש כאן התחברות חד-פעמית ל-Supabase. ההתחברות מזהה את המשתמש לצורך Google Calendar בלבד ואינה מפעילה מעצמה את סנכרון מסמך ניהול ההזמנות.':`ניהול ההזמנות נשמר בטבלאות <b>order_management_*</b>. טאב הצ'קים קורא וכותב ישירות למאגר הצ'קים המשותף <b>shared_checks_documents/main</b>. בנוסף, נתוני העו״ש והאשראי נקראים מאותו מסמך קופה <b>kupa_documents/main</b>, וסנכרון בנק/אשראי מניהול ההזמנות מעדכן בו רק את התחומים הפיננסיים המתאימים דרך מנגנון ה-revision של הקופה. הוצאות ומזומן נשארים בבעלות ניהול הקופה, ואין עותק פיננסי נוסף בניהול ההזמנות.`;const action=resetMode?'finish-local-reset-login':'finish-cloud-login';modal(title,`<div class="form-grid"><div class="field full"><div class="notice">${notice}</div></div><div class="field full"><label>אימייל Supabase Auth</label><input id="cEmail" type="email" value="${esc(email)}"></div><div class="field full"><label>סיסמה</label><input id="cPassword" type="password"></div></div>`,`<button class="btn primary" data-action="${action}" data-click-arg0="${esc(mode)}">${resetMode?'אמת והמשך לאיפוס':'התחבר'}</button><button class="btn" data-action="close-modal">ביטול</button>`)}

async function deferPendingRecovery({manageStatus=true,startPoll=true}={}){
  await storageV2CommitPromise();
  const state=await refreshStorageV2CloudState();
  if(!state?.base||!storageV2CloudOutboxActive())throw new Error('orders_v2_owner_head_required');
  if(state.control?.conflict){session.cloudConflictBlocked=true;if(manageStatus)setCloud('ענן: התנגשות','error');return true}
  if(state.pending||state.flight){
    localStorage.setItem(CLOUD_AUTO_KEY,'1');
    await requestCloudSave();
    if(startPoll)startPolling();
    return true;
  }
  return false;
}
async function finishCloudLogin(mode){const email=$('#cEmail').value.trim(),pass=$('#cPassword').value;if(!email||!pass)return toast('יש להזין אימייל וסיסמה');try{await authPassword(email,pass)}catch(e){console.error(e);toast('התחברות נכשלה: '+e.message);return}closeModal();try{if(mode==='calendar'){if(typeof resumeCalendarAfterCloudLogin!=='function')throw new Error('המשך החיבור ליומן אינו זמין');await resumeCalendarAfterCloudLogin();return}if(mode==='upload')await enableCloud(true);else await openCloud()}catch(e){console.error(e);toast((mode==='calendar'?'חיבור Google Calendar נכשל: ':'פתיחת הענן נכשלה: ')+e.message)} }

async function finishLocalResetLogin(){const email=$('#cEmail').value.trim(),pass=$('#cPassword').value;if(!email||!pass)return toast('יש להזין אימייל וסיסמה');let resetSession;try{resetSession=await authPasswordForLocalReset(email,pass)}catch(e){console.error(e);toast('אימות הענן נכשל: '+e.message);return false}closeModal();return resetLocalSiteStorage({allowAuthPrompt:false,resetSession})}

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
  if(!tab.primaryTab)return showSecondaryTabGuard();
  if(!supaConfigured())return alert('הגדרות Supabase חסרות');
  if(!loadSession()&&!afterLogin)return loginModal('upload');
  try{
    setCloud('ענן: בודק…');
    if(storageOwnerCurrent()==='local'){
      if(!storageV2PrimaryRequested())throw new Error('storage_v2_local_engine_required');
      return await transferLocalV2('upload-local');
    }
    if(await deferPendingRecovery())return true;
    return await openCloud();
  }catch(error){
    console.error(error);
    toast('לא ניתן להפעיל ענן: '+error.message);
    setCloud('ענן: שגיאה','error');
    return false;
  }
}

async function openCloud({renderAfter=true,quiet=false,hydrateSecondary=true,manageStatus=true,startPoll=true}={}){
  if(!tab.primaryTab)return false;if(!loadSession()){if(!quiet)loginModal('open');return false}
  try{
    if(manageStatus)setCloud('ענן: מאמת נתוני הזמנות…');
    const localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(localOwner){
      if(!storageV2PrimaryRequested())throw new Error('storage_v2_local_engine_required');
      return await transferLocalV2(reserved?.intent==='upload-local'?'upload-local':'load-account',{renderAfter,startPoll});
    }
    if(await deferPendingRecovery({manageStatus,startPoll}))return true;
    await storageV2CommitPromise();
    const v2Head=await refreshStorageV2CloudState();
    if(!v2Head?.base||!storageV2CloudOutboxActive())throw new Error('orders_v2_account_head_required');
    const observedSeq=Number(v2Head.seq);
    if(!Number.isSafeInteger(observedSeq)||observedSeq<0)throw new Error('orders_v2_account_seq_invalid');
    const observedGeneration=Number(session.localGeneration||0);
    const row=await readCloud();
    if(!row){clearCloudRecovery();if(manageStatus)setCloud('ענן: אין מסמך','error');return false}
    const rowRevision=Number(row.revision);
    if(!Number.isSafeInteger(rowRevision)||rowRevision<1)throw new Error('orders_v2_remote_revision_invalid');
    const currentHead=await refreshStorageV2CloudState();
    if(currentHead?.seq!==observedSeq||currentHead?.pending||currentHead?.flight||currentHead?.control||Number(session.localGeneration||0)!==observedGeneration)
      throw new Error('orders_v2_local_change_during_cloud_read');
    if(rowRevision<Number(v2Head.base.revision))throw new Error('orders_v2_remote_revision_behind_local_base');
    localStorage.setItem(CLOUD_AUTO_KEY,'1');
    const nextState=composeOrderCloudState(row.state,model.state);
    await adoptStorageV2CloudHead(rowRevision,nextState);
    if(Number(session.localGeneration||0)!==observedGeneration)throw new Error('orders_v2_local_change_during_cloud_adoption');
    session.cloudConflictBlocked=false;
    applyOrderCloudState(row.state);
    session.cloudRevision=rowRevision;
    session.cloudUpdatedAt=row.updated_at||session.cloudUpdatedAt;
    session.lastCloudState=prepareCloudState(model.state);
    try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
    // The account owner is already bound; secondary domains hydrate after Main.
    if(renderAfter)render();
    if(hydrateSecondary){if(manageStatus)setCloud('ענן: מסנכרן צ׳קים…');await syncSharedChecksFromCloud({quiet:true,required:true});if(manageStatus)setCloud('ענן: מסונכרן','synced');const financeOk=await refreshKupaReadout({force:true,renderIfChanged:true});if(!financeOk)console.warn('finance readout unavailable after orders cloud open; header status remains scoped to orders + checks');if(startPoll)startPolling();startFinanceAutoSync()}
    else{if(startPoll)startPolling();if(manageStatus)setCloud(session.cloudConflictBlocked?'ענן: התנגשות':'ענן: נתוני הזמנות אומתו',session.cloudConflictBlocked?'error':'')}
    closeModal();clearCloudRecovery();if(!quiet&&!session.cloudConflictBlocked)toast('ניהול ההזמנות נטען מהענן');return true
  }catch(e){console.error(e);if(!quiet)toast('פתיחת הענן נכשלה: '+e.message);if(manageStatus)setCloud(navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין',navigator.onLine?'':'offline');scheduleCloudRecovery();return false}
}

function logoutCloud(){
  // Logout clears authorization only. activeStorageOwner is durable and remains
  // unchanged, so account data can never fall through to the local namespace.
  clearCloudRecovery();saveSession(null);localStorage.removeItem(CLOUD_AUTO_KEY);session.cloudRevision=0;session.cloudUpdatedAt=null;checksSession.checksCloudRevision=0;checksSession.checksCloudUpdatedAt=null;session.cloudConflictBlocked=false;session.cloudSaveRequested=false;session.cloudPollingEnabled=false;clearTimeout(session.cloudPollTimer);setCloud('ענן: לא פעיל');renderSettings();toast('נותקת מהענן; בעלות האחסון והנתונים המקומיים נשמרו עד להתחברות מחדש');return true
}

async function resetLocalSiteStorage({allowAuthPrompt=true,resetSession=null}={}){
  if(!tab.primaryTab)return showSecondaryTabGuard();
  if(!navigator.onLine){toast('איפוס אחסון מקומי דורש חיבור לרשת כדי לוודא קודם שהענן זמין.');return false}
  const cloudSession=resetSession||loadSession();
  if(!cloudSession){if(allowAuthPrompt)loginModal('reset');else toast('נדרש אימות Supabase מחדש לצורך האיפוס.');return false}
  try{
    const {main,shared}=await verifyLocalResetCloud(cloudSession);
    const mainRevision=Number(main?.revision),sharedRevision=Number(shared?.revision);
    if(!main||!Number.isSafeInteger(mainRevision)||mainRevision<1)throw new Error('מסמך ניהול ההזמנות בענן אינו זמין או אינו תקין');
    if(!shared||!Number.isSafeInteger(sharedRevision)||sharedRevision<1)throw new Error('מסמך הצ׳קים המשותף בענן אינו זמין או אינו תקין');
    const account=String(cloudSession?.user?.email||'').trim(),accountLine=account?`חשבון שאומת: ${account}.
`:'';
    const approved=await confirmDialog('איפוס אחסון מקומי',`${accountLine}הענן אומת: ניהול הזמנות r${mainRevision}, צ׳קים r${sharedRevision}.

הפעולה תמחק מהמחשב הזה את כל נתוני האתר של הכתובת הנוכחית בדפדפן — Storage V2, נתוני מעבר ישנים, תורי סנכרון, owner binding, IndexedDB, LocalStorage, Cache ו־Service Worker. כל שינוי מקומי שלא הגיע לענן יימחק.

Supabase, קובצי data וגיבויים מחוץ לדפדפן לא ישתנו. לאחר האיפוס יהיה צורך להתחבר שוב ולפתוח מהענן.`,{confirmText:'אפס אחסון מקומי',cancelText:'ביטול',tone:'danger'});
    if(!approved)return false;
    await beginLocalSiteResetNavigation();return true;
  }catch(error){
    if(allowAuthPrompt&&String(error?.code||'')==='local_reset_auth_required'){loginModal('reset');return false}
    console.error('orders local site reset preflight',error);toast('האיפוס לא התחיל: '+(error?.message||String(error)));return false
  }
}

return { loginModal, finishCloudLogin, finishLocalResetLogin, enableCloud, openCloud, logoutCloud, resetLocalSiteStorage };
}
