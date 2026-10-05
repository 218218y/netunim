import {beginLocalSiteResetNavigation} from '../shared/local-site-reset.js';

import {esc} from '../core/values.js';
import {SUPA_EMAIL_KEY, SUPA_AUTO_KEY, STORAGE_PREF_KEY} from '../state/constants.js';

const CLOUD_RECOVERY_DELAYS_MS=[15_000,30_000,60_000,120_000];

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiCloud({session, tab, checksSession, model, loadSupabaseState, toast, supaConfigured, modal, configureCloudConnectButton, supaProjectRef, setCloudHeaderStatus, loadSupaSession, setConnectUI, prepareKupaCloudState, storageV2CloudOutboxActive=()=>false, storageV2PrimaryRequested=()=>false, refreshStorageV2CloudState=async()=>null, showSecondaryTabGuard, openBrowserStateFallback, restoreSupaSession, storeSupaSession, isSupabaseAuthError, friendlySupabaseError, supaEnsureSession, readSupabaseDocument, readSharedChecksDocument, verifyLocalResetCloud, applyCloudRow, requestStorageV2CloudSave, startCloudPolling, render, setConnectedStatus, supaAuthPassword, supaAuthPasswordForLocalReset, closeModal, showFirstRun, confirmDialog, storageOwnerCurrent=()=> 'local', storageOwnerAdoption=()=>null, startStorageV2OwnerTransfer=async()=>{throw new Error('storage_transfer_unavailable')}}){
function clearCloudRecovery(){if(session.cloudRecoveryTimer){clearTimeout(session.cloudRecoveryTimer);session.cloudRecoveryTimer=null}session.cloudRecoveryAttempt=0}
function scheduleCloudRecovery(){
  if(!tab.primaryTab||!navigator.onLine||localStorage.getItem(SUPA_AUTO_KEY)!=='1'||!loadSupaSession()||session.cloudRecoveryTimer)return;
  const index=Math.min(Number(session.cloudRecoveryAttempt||0),CLOUD_RECOVERY_DELAYS_MS.length-1),delay=CLOUD_RECOVERY_DELAYS_MS[index];session.cloudRecoveryAttempt=Math.min(index+1,CLOUD_RECOVERY_DELAYS_MS.length-1);
  session.cloudRecoveryTimer=setTimeout(()=>{session.cloudRecoveryTimer=null;void tryAutoOpenSupabase()},delay);
}
async function deferPendingRecovery(){
  const v2=await refreshStorageV2CloudState();
  if(!v2?.base||!storageV2CloudOutboxActive())throw new Error('kupa_v2_owner_head_required');
  if(!(v2.pending||v2.flight||v2.control?.conflict))return false;
  session.connectionMode='supabase';session.backendReady=true;document.getElementById('connectScreen').style.display='none';
  if(v2.control?.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');render();startCloudPolling();return true}
  await requestStorageV2CloudSave();render();startCloudPolling();return true;
}
async function discardCloudPendingAndLoadRemote(){if(!session.cloudConflictPending)return loadSupabaseState();if(!await confirmDialog('טעינת גרסת הענן','פעולה זו תוותר על השינוי המקומי שממתין ותטען את גרסת הענן. מומלץ קודם ללחוץ על ייצא JSON.',{confirmText:'טען גרסת ענן',cancelText:'ביטול',tone:'danger'}))return;await loadSupabaseState({discardLocalV2:true});toast('נטענה גרסת הענן')}

function openSupabaseLoginModal(mode='open'){
  if(!supaConfigured())return alert('קובץ הגדרת Supabase חסר או לא תקין.');
  const email=localStorage.getItem(SUPA_EMAIL_KEY)||'',resetMode=mode==='reset';
  modal(resetMode?'אימות ענן לפני איפוס מקומי':mode==='upload'?'הפעלת סנכרון Supabase':'פתיחת קופה מהענן',`<div class="form-grid"><div class="form-group full"><div class="notice">${resetMode?'ההתחברות כאן משמשת רק לאימות שהקופה והצ׳קים קיימים ונגישים בענן לפני מחיקת האחסון המקומי. היא אינה פותחת, ממזגת או מעלה נתונים.':'הנתונים העסקיים נשמרים ב־Supabase ולא בזיכרון הדפדפן. בדפדפן נשמרים רק פרטי התחברות/Session כדי שלא תצטרך להתחבר בכל פתיחה.'}</div></div><div class="form-group full"><label>אימייל משתמש Supabase Auth</label><input id="supaEmail" type="email" value="${esc(email)}" autocomplete="username"></div><div class="form-group full"><label>סיסמה</label><input id="supaPassword" type="password" autocomplete="current-password"></div><div class="form-group full"><div id="supaLoginError" class="notice warn" style="display:none"></div></div>${resetMode?'':`<div class="form-group full"><div class="soft-note">${mode==='upload'?'אם עדיין אין קופה בענן, הנתונים הפתוחים כרגע יועלו כעותק הראשי. אם כבר קיימת קופה בענן, המערכת לא תדרוס אותה.':'המערכת תפתח את הקופה הקיימת בענן. אם עוד לא הועלתה קופה, פתח קודם את התיקייה המקומית והפעל ענן מתוך ההגדרות.'}</div></div>`}</div>`,resetMode?'אמת והמשך לאיפוס':mode==='upload'?'התחבר והפעל ענן':'התחבר ופתח',()=>connectSupabaseFromLogin(mode))
}

async function showCloudNoDocument(){
  session.cloudAuthNoDocument=true;setCloudHeaderStatus('auth','ענן: מחובר · טרם הועלתה קופה');
  const ses=loadSupaSession(),email=ses?.user?.email||localStorage.getItem(SUPA_EMAIL_KEY)||'משתמש מחובר';
  setConnectUI({title:'מחובר ל-Supabase — עדיין אין קופה בענן',text:`ההתחברות הצליחה כ־<b>${esc(email)}</b> לפרויקט <b>${esc(supaProjectRef())}</b>, אבל למשתמש הזה עדיין אין מסמך קופה בשם <b>${esc(session.cloudDocumentName)}</b>.`,note:'זה לא כשל התחברות. אם זה המשתמש הנכון — פתח את הקופה המקומית, עבור אל <b>הגדרות וגיבוי</b> ולחץ <b>הפעל ענן והעלה את הקופה הנוכחית</b>. אם זה משתמש אחר, לחץ <b>התחבר עם משתמש אחר</b>.',showChoose:true,showFile:!window.showDirectoryPicker,showCloud:true});
  configureCloudConnectButton('התחבר עם משתמש אחר','reauth');
}

async function transferLocalV2(intent){
  const targetOwner=String(loadSupaSession()?.user?.id||'').trim();
  if(!targetOwner)throw new Error('storage_transfer_target_reauth_required');
  const result=await startStorageV2OwnerTransfer({targetOwner,intent});
  if(storageOwnerCurrent()!==targetOwner)throw new Error('storage_transfer_activation_unverified');
  session.connectionMode='supabase';session.backendReady=true;session.dbRevision=Number(result.mainRevision);
  checksSession.sharedChecksRevision=Number(result.sharedRevision);
  session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(model.state));session.cloudAuthNoDocument=false;
  localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');
  document.getElementById('connectScreen').style.display='none';setConnectedStatus('Supabase מחובר');setCloudHeaderStatus('synced','ענן: מסונכרן');
  render();startCloudPolling();clearCloudRecovery();return true;
}
async function openCloudUsingSavedSession({interactive=true}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}if(!supaConfigured())return false;
  const saved=await restoreSupaSession();if(!saved){if(interactive)openSupabaseLoginModal('open');return false}
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');const localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(!localOwner&&await deferPendingRecovery()){clearCloudRecovery();return true}
    await supaEnsureSession();if(localOwner&&storageV2PrimaryRequested())return await transferLocalV2('load-account');
    const row=await readSupabaseDocument();if(!row){clearCloudRecovery();await showCloudNoDocument();return false}
    await applyCloudRow(row);clearCloudRecovery();return true
  }catch(e){console.error(e);if(isSupabaseAuthError(e)){clearCloudRecovery();storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');if(interactive)openSupabaseLoginModal('open');return false}setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין');scheduleCloudRecovery();if(await openBrowserStateFallback())return true;if(interactive)alert('לא ניתן לפתוח את הקופה מהענן: '+friendlySupabaseError(e));return false}
}

async function enableCloudFromCurrentState(){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  if(!supaConfigured()){alert('הגדרות Supabase חסרות');return false}
  const saved=await restoreSupaSession();
  if(!saved){openSupabaseLoginModal('upload');return false}
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');
    await supaEnsureSession();
    if(storageOwnerCurrent()==='local'){
      if(!storageV2PrimaryRequested())throw new Error('storage_v2_local_engine_required');
      return await transferLocalV2('upload-local');
    }
    return await openCloudUsingSavedSession({interactive:false});
  }catch(error){
    console.error(error);
    if(isSupabaseAuthError(error)){
      storeSupaSession(null);
      setCloudHeaderStatus('off','ענן: נדרשת התחברות');
      openSupabaseLoginModal('upload');
      return false;
    }
    alert('לא ניתן להפעיל את הענן: '+friendlySupabaseError(error));
    return false;
  }
}

async function connectSupabaseFromLogin(mode){
  const email=document.getElementById('supaEmail')?.value.trim();
  const password=document.getElementById('supaPassword')?.value||'';
  if(!email||!password)return toast('יש להזין אימייל וסיסמה');
  try{
    if(mode==='reset'){
      const resetSession=await supaAuthPasswordForLocalReset(email,password);
      closeModal();
      return resetLocalSiteStorage({allowAuthPrompt:false,resetSession});
    }
    await supaAuthPassword(email,password);
    if(mode==='upload'){
      const ok=await enableCloudFromCurrentState();
      if(ok)closeModal();
      return ok;
    }
    if(storageOwnerCurrent()==='local'){
      if(!storageV2PrimaryRequested())throw new Error('storage_v2_local_engine_required');
      const ok=await transferLocalV2('load-account');
      if(ok)closeModal();
      return ok;
    }
    const ok=await openCloudUsingSavedSession({interactive:false});
    if(ok)closeModal();
    return ok;
  }catch(error){
    console.error(error);
    const message='לא ניתן להתחבר ל-Supabase: '+friendlySupabaseError(error);
    const box=document.getElementById('supaLoginError');
    if(box){box.textContent=message;box.style.display='block'}else alert(message);
    return false;
  }
}

async function tryAutoOpenSupabase(){
  if(!tab.primaryTab)return false;if(!supaConfigured())return false;const s=await restoreSupaSession();if(!s)return false;
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');const localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(localOwner&&storageV2PrimaryRequested())return false;
    if(reserved?.intent==='upload-local'){await enableCloudFromCurrentState();clearCloudRecovery();return storageOwnerCurrent()!=='local'}if(!localOwner&&await deferPendingRecovery()){clearCloudRecovery();return true}
    await supaEnsureSession();const row=await readSupabaseDocument();if(!row){clearCloudRecovery();session.cloudAuthNoDocument=true;setCloudHeaderStatus('auth','ענן: מחובר · אין קופה');return false}
    await applyCloudRow(row);clearCloudRecovery();return true
  }catch(e){console.error('auto cloud',e);if(isSupabaseAuthError(e)){clearCloudRecovery();storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות')}else{setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין');scheduleCloudRecovery();if(await openBrowserStateFallback())return true}return false}
}

function logoutSupabase(){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  // Logout clears authorization only. activeStorageOwner is durable and remains
  // unchanged, so account data can never fall through to the local namespace.
  clearCloudRecovery();session.cloudPollingEnabled=false;if(session.cloudPollTimer){clearTimeout(session.cloudPollTimer);session.cloudPollTimer=null}storeSupaSession(null);localStorage.removeItem(STORAGE_PREF_KEY);localStorage.removeItem(SUPA_AUTO_KEY);session.cloudAuthNoDocument=false;session.dbRevision=0;session.financeRevision=0;session.financeUpdatedAt=null;session.serverInfo.lastSavedAt=null;checksSession.sharedChecksRevision=0;checksSession.sharedChecksUpdatedAt=null;setCloudHeaderStatus('off','ענן: לא מחובר');if(session.connectionMode==='supabase'){session.backendReady=false;document.getElementById('connectScreen').style.display='flex';showFirstRun()}toast('ההתחברות לענן נמחקה מהמחשב הזה. בעלות האחסון והשינויים המקומיים נשמרו עד להתחברות מחדש.');return true
}

async function resetLocalSiteStorage({allowAuthPrompt=true,resetSession=null}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  if(!navigator.onLine){toast('איפוס אחסון מקומי דורש חיבור לרשת כדי לוודא קודם שהענן זמין.');return false}
  const cloudSession=resetSession||loadSupaSession();
  if(!cloudSession){if(allowAuthPrompt)openSupabaseLoginModal('reset');else toast('נדרש אימות Supabase מחדש לצורך האיפוס.');return false}
  try{
    const {main,shared}=await verifyLocalResetCloud(cloudSession);
    const mainRevision=Number(main?.revision),sharedRevision=Number(shared?.revision);
    if(!main||!Number.isSafeInteger(mainRevision)||mainRevision<1)throw new Error('מסמך הקופה בענן אינו זמין או אינו תקין');
    if(!shared||!Number.isSafeInteger(sharedRevision)||sharedRevision<1)throw new Error('מסמך הצ׳קים המשותף בענן אינו זמין או אינו תקין');
    const account=String(cloudSession?.user?.email||'').trim(),accountLine=account?`חשבון שאומת: ${account}.
`:'';
    const approved=await confirmDialog('איפוס אחסון מקומי',`${accountLine}הענן אומת: קופה r${mainRevision}, צ׳קים r${sharedRevision}.

הפעולה תמחק מהמחשב הזה את כל נתוני האתר של הכתובת הנוכחית בדפדפן — Storage V2, נתוני מעבר ישנים, תורי סנכרון, owner binding, IndexedDB, LocalStorage, Cache ו־Service Worker. כל שינוי מקומי שלא הגיע לענן יימחק.

Supabase, קובצי data וגיבויים מחוץ לדפדפן לא ישתנו. לאחר האיפוס יהיה צורך להתחבר שוב ולפתוח מהענן.`,{confirmText:'אפס אחסון מקומי',cancelText:'ביטול',tone:'danger'});
    if(!approved)return false;
    await beginLocalSiteResetNavigation();return true;
  }catch(error){
    if(allowAuthPrompt&&String(error?.code||'')==='local_reset_auth_required'){openSupabaseLoginModal('reset');return false}
    console.error('kupa local site reset preflight',error);toast('האיפוס לא התחיל: '+friendlySupabaseError(error));return false
  }
}

return { discardCloudPendingAndLoadRemote, openSupabaseLoginModal, showCloudNoDocument, openCloudUsingSavedSession, enableCloudFromCurrentState, connectSupabaseFromLogin, tryAutoOpenSupabase, logoutSupabase, resetLocalSiteStorage };
}
