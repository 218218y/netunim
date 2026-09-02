import {esc, clone} from '../core/values.js';

const CLOUD_RECOVERY_DELAYS_MS=[15_000,30_000,60_000,120_000];
import {SUPA_EMAIL_KEY, SUPA_AUTO_KEY, STORAGE_PREF_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiCloud({session, tab, checksSession, model, clearCloudPending, loadSupabaseState, toast, supaConfigured, modal, configureCloudConnectButton, supaProjectRef, setCloudHeaderStatus, loadSupaSession, setConnectUI, prepareKupaCloudState, getCloudPending, loadSharedChecksBase, loadSharedChecksBankEvents, showSecondaryTabGuard, openBrowserStateFallback, restoreSupaSession, storeSupaSession, isSupabaseAuthError, friendlySupabaseError, supaEnsureSession, readSupabaseDocument, syncSharedChecksFromCloud, applyCloudRow, reconcileCloudPending, startCloudPolling, render, setConnectedStatus, ensureSharedChecksForNewCloud, persistSupabaseState, supaAuthPassword, closeModal, showFirstRun, confirmDialog}){
function clearCloudRecovery(){if(session.cloudRecoveryTimer){clearTimeout(session.cloudRecoveryTimer);session.cloudRecoveryTimer=null}session.cloudRecoveryAttempt=0}
function scheduleCloudRecovery(){
  if(!tab.primaryTab||!navigator.onLine||localStorage.getItem(SUPA_AUTO_KEY)!=='1'||!loadSupaSession()||session.cloudRecoveryTimer)return;
  const index=Math.min(Number(session.cloudRecoveryAttempt||0),CLOUD_RECOVERY_DELAYS_MS.length-1),delay=CLOUD_RECOVERY_DELAYS_MS[index];session.cloudRecoveryAttempt=Math.min(index+1,CLOUD_RECOVERY_DELAYS_MS.length-1);
  session.cloudRecoveryTimer=setTimeout(()=>{session.cloudRecoveryTimer=null;void tryAutoOpenSupabase()},delay);
}
async function discardCloudPendingAndLoadRemote(){if(!session.cloudConflictPending)return loadSupabaseState();if(!await confirmDialog('טעינת גרסת הענן','פעולה זו תוותר על השינוי המקומי שממתין ותטען את גרסת הענן. מומלץ קודם ללחוץ על ייצא JSON.',{confirmText:'טען גרסת ענן',cancelText:'ביטול',tone:'danger'}))return;await clearCloudPending(Infinity);session.cloudConflictPending=false;await loadSupabaseState();toast('נטענה גרסת הענן')}

function openSupabaseLoginModal(mode='open'){
  if(!supaConfigured())return alert('קובץ הגדרת Supabase חסר או לא תקין.');
  const email=localStorage.getItem(SUPA_EMAIL_KEY)||'';
  modal(mode==='upload'?'הפעלת סנכרון Supabase':'פתיחת קופה מהענן',`<div class="form-grid"><div class="form-group full"><div class="notice">הנתונים העסקיים נשמרים ב־Supabase ולא בזיכרון הדפדפן. בדפדפן נשמרים רק פרטי התחברות/Session כדי שלא תצטרך להתחבר בכל פתיחה.</div></div><div class="form-group full"><label>אימייל משתמש Supabase Auth</label><input id="supaEmail" type="email" value="${esc(email)}" autocomplete="username"></div><div class="form-group full"><label>סיסמה</label><input id="supaPassword" type="password" autocomplete="current-password"></div><div class="form-group full"><div id="supaLoginError" class="notice warn" style="display:none"></div></div><div class="form-group full"><div class="soft-note">${mode==='upload'?'אם עדיין אין קופה בענן, הנתונים הפתוחים כרגע יועלו כעותק הראשי. אם כבר קיימת קופה בענן, המערכת לא תדרוס אותה.':'המערכת תפתח את הקופה הקיימת בענן. אם עוד לא הועלתה קופה, פתח קודם את התיקייה המקומית והפעל ענן מתוך ההגדרות.'}</div></div></div>`,mode==='upload'?'התחבר והפעל ענן':'התחבר ופתח',()=>connectSupabaseFromLogin(mode))
}

async function showCloudNoDocument(){
  session.cloudAuthNoDocument=true;setCloudHeaderStatus('auth','ענן: מחובר · טרם הועלתה קופה');
  const ses=loadSupaSession(),email=ses?.user?.email||localStorage.getItem(SUPA_EMAIL_KEY)||'משתמש מחובר';
  setConnectUI({title:'מחובר ל-Supabase — עדיין אין קופה בענן',text:`ההתחברות הצליחה כ־<b>${esc(email)}</b> לפרויקט <b>${esc(supaProjectRef())}</b>, אבל למשתמש הזה עדיין אין מסמך קופה בשם <b>${esc(session.cloudDocumentName)}</b>.`,note:'זה לא כשל התחברות. אם זה המשתמש הנכון — פתח את הקופה המקומית, עבור אל <b>הגדרות וגיבוי</b> ולחץ <b>הפעל ענן והעלה את הקופה הנוכחית</b>. אם זה משתמש אחר, לחץ <b>התחבר עם משתמש אחר</b>.',showChoose:true,showFile:!window.showDirectoryPicker,showCloud:true});
  configureCloudConnectButton('התחבר עם משתמש אחר','reauth');
}

async function openCloudUsingSavedSession({interactive=true}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  if(!supaConfigured())return false;
  const saved=await restoreSupaSession();if(!saved){if(interactive)openSupabaseLoginModal('open');return false}
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');await supaEnsureSession();const row=await readSupabaseDocument();
    if(!row){clearCloudRecovery();await showCloudNoDocument();return false}
    const pending=await getCloudPending();if(pending){session.connectionMode='supabase';session.backendReady=true;document.getElementById('connectScreen').style.display='none';session.dbRevision=Number(row.revision||0);session.serverInfo.lastSavedAt=row.updated_at||session.serverInfo.lastSavedAt||null;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});render();startCloudPolling();clearCloudRecovery();return true}
    await applyCloudRow(row);clearCloudRecovery();return true
  }catch(e){console.error(e);if(isSupabaseAuthError(e)){clearCloudRecovery();storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');if(interactive)openSupabaseLoginModal('open');return false}setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין');scheduleCloudRecovery();if(await openBrowserStateFallback())return true;if(interactive)alert('לא ניתן לפתוח את הקופה מהענן: '+friendlySupabaseError(e));return false}
}

async function enableCloudFromCurrentState(){
  if(!tab.primaryTab){showSecondaryTabGuard();return}
  if(!supaConfigured())return alert('קובץ הגדרת Supabase חסר או לא תקין.');
  const saved=await restoreSupaSession();if(!saved)return openSupabaseLoginModal('upload');
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');await supaEnsureSession();const existing=await readSupabaseDocument();
    if(existing){const pending=await getCloudPending();if(pending){session.connectionMode='supabase';session.backendReady=true;session.dbRevision=Number(existing.revision||0);session.serverInfo.lastSavedAt=existing.updated_at||session.serverInfo.lastSavedAt||null;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(existing.state));document.getElementById('connectScreen').style.display='none';await reconcileCloudPending(existing);checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});render()}else await applyCloudRow(existing);toast('כבר קיימת קופה בענן — נטענה הגרסה הקיימת');return}
    const localSnapshot=clone(model.state);session.connectionMode='supabase';session.backendReady=true;session.dbRevision=0;session.serverInfo={schemaVersion:6,lastSavedAt:null,databaseFile:'Supabase',backups:[]};localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');await persistSupabaseState(localSnapshot,'הקופה הועלתה לענן והסנכרון הופעל');checksSession.sharedChecksBase=loadSharedChecksBase();await ensureSharedChecksForNewCloud('מאגר הצקים המשותף נוצר וסונכרן');setConnectedStatus('Supabase מחובר');setCloudHeaderStatus('synced','ענן: מסונכרן');document.getElementById('connectScreen').style.display='none'
  }catch(e){console.error(e);if(isSupabaseAuthError(e)){storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');openSupabaseLoginModal('upload');return}alert('לא ניתן להפעיל את הענן: '+friendlySupabaseError(e))}
}

async function connectSupabaseFromLogin(mode){
  const email=document.getElementById('supaEmail')?.value.trim(),password=document.getElementById('supaPassword')?.value||'';if(!email||!password)return toast('יש להזין אימייל וסיסמה');
  try{
    await supaAuthPassword(email,password);
    if(mode==='upload'){
      const existing=await readSupabaseDocument();
      if(existing){closeModal();await applyCloudRow(existing);toast('כבר קיימת קופה בענן — נטענה הגרסה הקיימת');return}
      const localSnapshot=clone(model.state);session.connectionMode='supabase';session.backendReady=true;session.dbRevision=0;session.serverInfo={schemaVersion:6,lastSavedAt:null,databaseFile:'Supabase',backups:[]};localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');closeModal();await persistSupabaseState(localSnapshot,'הקופה הועלתה לענן והסנכרון הופעל');checksSession.sharedChecksBase=loadSharedChecksBase();await ensureSharedChecksForNewCloud('מאגר הצקים המשותף נוצר וסונכרן');setConnectedStatus('Supabase מחובר');setCloudHeaderStatus('synced','ענן: מסונכרן');document.getElementById('connectScreen').style.display='none';return
    }
    const row=await readSupabaseDocument();closeModal();if(!row){await showCloudNoDocument();return}const pending=await getCloudPending();if(pending){session.connectionMode='supabase';session.backendReady=true;session.dbRevision=Number(row.revision||0);session.serverInfo.lastSavedAt=row.updated_at||session.serverInfo.lastSavedAt||null;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));document.getElementById('connectScreen').style.display='none';await reconcileCloudPending(row);checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});render();startCloudPolling()}else await applyCloudRow(row)
  }catch(e){
    console.error(e);
    const msg='לא ניתן להתחבר ל-Supabase: '+friendlySupabaseError(e);
    const box=document.getElementById('supaLoginError');
    if(box){box.textContent=msg;box.style.display='block'}else alert(msg);
  }
}

async function tryAutoOpenSupabase(){
  if(!tab.primaryTab)return false;if(!supaConfigured())return false;const s=await restoreSupaSession();if(!s)return false;
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');await supaEnsureSession();const row=await readSupabaseDocument();
    if(!row){clearCloudRecovery();session.cloudAuthNoDocument=true;setCloudHeaderStatus('auth','ענן: מחובר · אין קופה');return false}
    const pending=await getCloudPending();if(pending){session.connectionMode='supabase';session.backendReady=true;document.getElementById('connectScreen').style.display='none';session.dbRevision=Number(row.revision||0);session.serverInfo.lastSavedAt=row.updated_at||session.serverInfo.lastSavedAt||null;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});render();startCloudPolling();clearCloudRecovery();return true}
    await applyCloudRow(row);clearCloudRecovery();return true
  }catch(e){console.error('auto cloud',e);if(isSupabaseAuthError(e)){clearCloudRecovery();storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות')}else{setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין');scheduleCloudRecovery();if(await openBrowserStateFallback())return true}return false}
}

function logoutSupabase(){clearCloudRecovery();if(!tab.primaryTab){showSecondaryTabGuard();return}if(session.cloudPollTimer){clearInterval(session.cloudPollTimer);session.cloudPollTimer=null}storeSupaSession(null);localStorage.removeItem(STORAGE_PREF_KEY);localStorage.removeItem(SUPA_AUTO_KEY);session.cloudAuthNoDocument=false;session.dbRevision=0;session.financeRevision=0;session.financeUpdatedAt=null;session.serverInfo.lastSavedAt=null;checksSession.sharedChecksRevision=0;checksSession.sharedChecksUpdatedAt=null;setCloudHeaderStatus('off','ענן: לא מחובר');if(session.connectionMode==='supabase'){session.backendReady=false;document.getElementById('connectScreen').style.display='flex';showFirstRun()}toast('ההתחברות לענן נמחקה מהמחשב הזה. שינויים שטרם סונכרנו לא נמחקו.')}

return { discardCloudPendingAndLoadRemote, openSupabaseLoginModal, showCloudNoDocument, openCloudUsingSavedSession, enableCloudFromCurrentState, connectSupabaseFromLogin, tryAutoOpenSupabase, logoutSupabase };
}
