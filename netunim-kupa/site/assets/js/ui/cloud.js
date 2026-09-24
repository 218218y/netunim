import {esc, clone} from '../core/values.js';
import {getOutboxRetryDelay} from '../shared/cloud-sync.js';

const CLOUD_RECOVERY_DELAYS_MS=[15_000,30_000,60_000,120_000];
import {SUPA_EMAIL_KEY, SUPA_AUTO_KEY, STORAGE_PREF_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiCloud({session, tab, checksSession, model, clearCloudPending, loadSupabaseState, toast, supaConfigured, modal, configureCloudConnectButton, supaProjectRef, setCloudHeaderStatus, loadSupaSession, setConnectUI, prepareKupaCloudState, getCloudPending=async()=>null, storageV2CloudOutboxActive=()=>false, storageV2PrimaryRequested=()=>false, refreshStorageV2CloudState=async()=>null, loadSharedChecksBase, loadSharedChecksBankEvents, showSecondaryTabGuard, openBrowserStateFallback, restoreSupaSession, storeSupaSession, isSupabaseAuthError, friendlySupabaseError, supaEnsureSession, readSupabaseDocument, syncSharedChecksFromCloud, applyCloudRow, reconcileCloudPending, startCloudPolling, render, setConnectedStatus, ensureSharedChecksForNewCloud, persistSupabaseState, supaAuthPassword, closeModal, showFirstRun, confirmDialog, prepareAuthenticatedStorageOwner=async()=>null, storageOwnerCurrent=()=> 'local', storageOwnerAdoption=()=>null, adoptAuthenticatedStorageOwner=async()=>true, startStorageV2OwnerTransfer=async()=>{throw new Error('storage_transfer_unavailable')}, storageTransitionPreparing=()=>false}){
function clearCloudRecovery(){if(session.cloudRecoveryTimer){clearTimeout(session.cloudRecoveryTimer);session.cloudRecoveryTimer=null}session.cloudRecoveryAttempt=0}
function blockOrdinaryCloudDuringCutover({interactive=false}={}){
  if(!storageTransitionPreparing())return false;
  clearCloudRecovery();setCloudHeaderStatus('conflict','ענן: מעבר Storage V2 דורש השלמה');
  if(interactive)alert('מעבר Storage V2 נמצא באמצע. פתיחת הענן הרגילה חסומה כדי לא לערבב בין V1 ל־V2. יש לרענן את הדף ולאפשר למערכת להשלים את המעבר.');
  return true
}
function scheduleCloudRecovery(){
  if(!tab.primaryTab||!navigator.onLine||localStorage.getItem(SUPA_AUTO_KEY)!=='1'||!loadSupaSession()||session.cloudRecoveryTimer)return;
  const index=Math.min(Number(session.cloudRecoveryAttempt||0),CLOUD_RECOVERY_DELAYS_MS.length-1),delay=CLOUD_RECOVERY_DELAYS_MS[index];session.cloudRecoveryAttempt=Math.min(index+1,CLOUD_RECOVERY_DELAYS_MS.length-1);
  session.cloudRecoveryTimer=setTimeout(()=>{session.cloudRecoveryTimer=null;void tryAutoOpenSupabase()},delay);
}
async function deferPendingRecovery(){
  const v2=await refreshStorageV2CloudState();if(storageV2CloudOutboxActive()&&(v2?.pending||v2?.flight||v2?.control?.conflict)){session.connectionMode='supabase';session.backendReady=true;document.getElementById('connectScreen').style.display='none';if(v2?.control?.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');render();startCloudPolling();return true}await reconcileCloudPending();render();startCloudPolling();return true}
  if(storageV2PrimaryRequested()){if(!v2?.base||!storageV2CloudOutboxActive())throw new Error('kupa_v2_owner_head_required');return false}
  const pending=await getCloudPending();if(!pending||getOutboxRetryDelay(pending)<=0)return false;session.connectionMode='supabase';session.backendReady=true;document.getElementById('connectScreen').style.display='none';await reconcileCloudPending();render();startCloudPolling();return true
}
async function discardCloudPendingAndLoadRemote(){if(!session.cloudConflictPending)return loadSupabaseState();if(!await confirmDialog('טעינת גרסת הענן','פעולה זו תוותר על השינוי המקומי שממתין ותטען את גרסת הענן. מומלץ קודם ללחוץ על ייצא JSON.',{confirmText:'טען גרסת ענן',cancelText:'ביטול',tone:'danger'}))return;if(storageV2CloudOutboxActive()){await loadSupabaseState({discardLocalV2:true});toast('נטענה גרסת הענן');return}const pending=await getCloudPending();if(pending&&!await clearCloudPending(pending.generation))throw new Error('לא ניתן היה למחוק בבטחה את השינוי המקומי');session.cloudConflictPending=false;await loadSupabaseState();toast('נטענה גרסת הענן')}

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

async function effectiveOwnerIntent(requested){
  const pending=storageOwnerAdoption();if(pending){const reserved=await prepareAuthenticatedStorageOwner(pending.intent);return reserved?.intent||pending.intent}
  const reserved=await prepareAuthenticatedStorageOwner(requested);return reserved?.intent||requested
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
function localOwnerPendingError(){const error=new Error('storage_owner_local_pending_requires_upload');error.code='storage_owner_local_pending_requires_upload';return error}

async function openCloudUsingSavedSession({interactive=true}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}if(!supaConfigured())return false;
  const saved=await restoreSupaSession();if(!saved){if(interactive)openSupabaseLoginModal('open');return false}if(blockOrdinaryCloudDuringCutover({interactive}))return false;
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');let localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(!localOwner&&await deferPendingRecovery()){clearCloudRecovery();return true}
    await supaEnsureSession();if(localOwner&&storageV2PrimaryRequested())return await transferLocalV2('load-account');
    const row=await readSupabaseDocument();if(!row){clearCloudRecovery();await showCloudNoDocument();return false}
    let ownerIntent=reserved?.intent||null;if(localOwner&&!ownerIntent)ownerIntent=await effectiveOwnerIntent('load-account');
    const pending=await getCloudPending();
    if(localOwner&&ownerIntent==='load-account'&&pending)throw localOwnerPendingError();
    if(pending){session.connectionMode='supabase';session.backendReady=true;session.dbRevision=Number(row.revision||0);session.serverInfo.lastSavedAt=row.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});if(localOwner)await adoptAuthenticatedStorageOwner(ownerIntent||'load-account');document.getElementById('connectScreen').style.display='none';render();startCloudPolling();clearCloudRecovery();return true}
    await applyCloudRow(row);clearCloudRecovery();return true
  }catch(e){console.error(e);if(isSupabaseAuthError(e)){clearCloudRecovery();storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');if(interactive)openSupabaseLoginModal('open');return false}setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין');scheduleCloudRecovery();if(await openBrowserStateFallback())return true;if(interactive)alert('לא ניתן לפתוח את הקופה מהענן: '+friendlySupabaseError(e));return false}
}

async function enableCloudFromCurrentState(){
  if(!tab.primaryTab){showSecondaryTabGuard();return}if(!supaConfigured())return alert('קובץ הגדרת Supabase חסר או לא תקין.');
  const saved=await restoreSupaSession();if(!saved)return openSupabaseLoginModal('upload');if(blockOrdinaryCloudDuringCutover({interactive:true}))return false;
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');let localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();if(!localOwner&&await deferPendingRecovery())return;
    await supaEnsureSession();if(localOwner&&storageV2PrimaryRequested())return await transferLocalV2('upload-local');
    const existing=await readSupabaseDocument();let ownerIntent=reserved?.intent||null;if(localOwner&&!ownerIntent)ownerIntent=await effectiveOwnerIntent(existing?'load-account':'upload-local');
    if(ownerIntent==='load-account'&&!existing)throw new Error('storage_owner_reserved_account_document_missing');
    if(existing){const pending=await getCloudPending();if(localOwner&&ownerIntent==='load-account'&&pending)throw localOwnerPendingError();if(pending){session.connectionMode='supabase';session.backendReady=true;session.dbRevision=Number(existing.revision||0);session.serverInfo.lastSavedAt=existing.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(existing.state));await reconcileCloudPending(existing);checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});if(localOwner)await adoptAuthenticatedStorageOwner(ownerIntent||'load-account');document.getElementById('connectScreen').style.display='none';render();startCloudPolling()}else await applyCloudRow(existing);toast('כבר קיימת קופה בענן — נטענה הגרסה הקיימת');return}
    if(ownerIntent!=='upload-local')throw new Error('storage_owner_upload_intent_required');if(storageV2PrimaryRequested()||await refreshStorageV2CloudState())throw new Error('kupa_v2_owner_bootstrap_required');
    const localSnapshot=clone(model.state);session.connectionMode='supabase';session.backendReady=true;session.dbRevision=0;session.serverInfo={schemaVersion:6,lastSavedAt:null,databaseFile:'Supabase',backups:[]};localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');await persistSupabaseState(localSnapshot,'הקופה הועלתה לענן והסנכרון הופעל');checksSession.sharedChecksBase=loadSharedChecksBase();await ensureSharedChecksForNewCloud('מאגר הצקים המשותף נוצר וסונכרן');await adoptAuthenticatedStorageOwner(ownerIntent);setConnectedStatus('Supabase מחובר');setCloudHeaderStatus('synced','ענן: מסונכרן');document.getElementById('connectScreen').style.display='none'
  }catch(e){console.error(e);if(isSupabaseAuthError(e)){storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');openSupabaseLoginModal('upload');return}alert('לא ניתן להפעיל את הענן: '+friendlySupabaseError(e))}
}

async function connectSupabaseFromLogin(mode){
  const email=document.getElementById('supaEmail')?.value.trim(),password=document.getElementById('supaPassword')?.value||'';if(!email||!password)return toast('יש להזין אימייל וסיסמה');
  try{
    await supaAuthPassword(email,password);if(storageTransitionPreparing()){closeModal();clearCloudRecovery();setCloudHeaderStatus('conflict','ענן: מעבר Storage V2 דורש השלמה');setConnectUI({title:'ההתחברות חודשה',text:'מעבר Storage V2 עדיין ממתין להשלמה. רענן את הדף כדי להמשיך מאותה תוכנית מעבר שמורה.',showCloud:false});return}let localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(localOwner&&storageV2PrimaryRequested()){await transferLocalV2(mode==='upload'?'upload-local':'load-account');closeModal();return}
    if(!localOwner&&await deferPendingRecovery()){closeModal();return}
    if(mode==='upload'){
      const existing=await readSupabaseDocument();let ownerIntent=reserved?.intent||null;if(localOwner&&!ownerIntent)ownerIntent=await effectiveOwnerIntent(existing?'load-account':'upload-local');
      if(existing){const pending=await getCloudPending();if(localOwner&&ownerIntent==='load-account'&&pending)throw localOwnerPendingError();if(pending){session.connectionMode='supabase';session.backendReady=true;session.dbRevision=Number(existing.revision||0);session.serverInfo.lastSavedAt=existing.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(existing.state));await reconcileCloudPending(existing);checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});if(localOwner)await adoptAuthenticatedStorageOwner(ownerIntent||'load-account');render();startCloudPolling()}else await applyCloudRow(existing);closeModal();toast('כבר קיימת קופה בענן — נטענה הגרסה הקיימת');return}
      if(ownerIntent!=='upload-local')throw new Error('storage_owner_upload_intent_required');if(storageV2PrimaryRequested()||await refreshStorageV2CloudState())throw new Error('kupa_v2_owner_bootstrap_required');const localSnapshot=clone(model.state);session.connectionMode='supabase';session.backendReady=true;session.dbRevision=0;session.serverInfo={schemaVersion:6,lastSavedAt:null,databaseFile:'Supabase',backups:[]};localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');await persistSupabaseState(localSnapshot,'הקופה הועלתה לענן והסנכרון הופעל');checksSession.sharedChecksBase=loadSharedChecksBase();await ensureSharedChecksForNewCloud('מאגר הצקים המשותף נוצר וסונכרן');await adoptAuthenticatedStorageOwner(ownerIntent);setConnectedStatus('Supabase מחובר');setCloudHeaderStatus('synced','ענן: מסונכרן');document.getElementById('connectScreen').style.display='none';closeModal();return
    }
    const row=await readSupabaseDocument();if(!row){closeModal();await showCloudNoDocument();return}let ownerIntent=reserved?.intent||null;if(localOwner&&!ownerIntent)ownerIntent=await effectiveOwnerIntent('load-account');if(ownerIntent==='upload-local'){closeModal();return enableCloudFromCurrentState()}
    const pending=await getCloudPending();if(localOwner&&pending)throw localOwnerPendingError();if(pending){session.connectionMode='supabase';session.backendReady=true;session.dbRevision=Number(row.revision||0);session.serverInfo.lastSavedAt=row.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});if(localOwner)await adoptAuthenticatedStorageOwner(ownerIntent||'load-account');document.getElementById('connectScreen').style.display='none';render();startCloudPolling()}else await applyCloudRow(row);closeModal()
  }catch(e){console.error(e);const msg='לא ניתן להתחבר ל-Supabase: '+friendlySupabaseError(e);const box=document.getElementById('supaLoginError');if(box){box.textContent=msg;box.style.display='block'}else alert(msg)}
}

async function tryAutoOpenSupabase(){
  if(!tab.primaryTab)return false;if(!supaConfigured())return false;const s=await restoreSupaSession();if(!s)return false;if(blockOrdinaryCloudDuringCutover())return false;
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');let localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(localOwner&&storageV2PrimaryRequested())return false;
    if(reserved?.intent==='upload-local'){await enableCloudFromCurrentState();clearCloudRecovery();return storageOwnerCurrent()!=='local'}if(!localOwner&&await deferPendingRecovery()){clearCloudRecovery();return true}
    await supaEnsureSession();const row=await readSupabaseDocument();if(!row){clearCloudRecovery();session.cloudAuthNoDocument=true;setCloudHeaderStatus('auth','ענן: מחובר · אין קופה');return false}
    let ownerIntent=reserved?.intent||null;if(localOwner&&!ownerIntent)ownerIntent=await effectiveOwnerIntent('load-account');const pending=await getCloudPending();if(localOwner&&pending)throw localOwnerPendingError();if(pending){session.connectionMode='supabase';session.backendReady=true;session.dbRevision=Number(row.revision||0);session.serverInfo.lastSavedAt=row.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});if(localOwner)await adoptAuthenticatedStorageOwner(ownerIntent||'load-account');document.getElementById('connectScreen').style.display='none';render();startCloudPolling();clearCloudRecovery();return true}
    await applyCloudRow(row);clearCloudRecovery();return true
  }catch(e){console.error('auto cloud',e);if(isSupabaseAuthError(e)){clearCloudRecovery();storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות')}else{setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין');scheduleCloudRecovery();if(await openBrowserStateFallback())return true}return false}
}

function logoutSupabase(){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  // Logout clears authorization only. activeStorageOwner is durable and remains
  // unchanged, so account data can never fall through to the local namespace.
  clearCloudRecovery();session.cloudPollingEnabled=false;if(session.cloudPollTimer){clearTimeout(session.cloudPollTimer);session.cloudPollTimer=null}storeSupaSession(null);localStorage.removeItem(STORAGE_PREF_KEY);localStorage.removeItem(SUPA_AUTO_KEY);session.cloudAuthNoDocument=false;session.dbRevision=0;session.financeRevision=0;session.financeUpdatedAt=null;session.serverInfo.lastSavedAt=null;checksSession.sharedChecksRevision=0;checksSession.sharedChecksUpdatedAt=null;setCloudHeaderStatus('off','ענן: לא מחובר');if(session.connectionMode==='supabase'){session.backendReady=false;document.getElementById('connectScreen').style.display='flex';showFirstRun()}toast('ההתחברות לענן נמחקה מהמחשב הזה. בעלות האחסון והשינויים המקומיים נשמרו עד להתחברות מחדש.');return true
}

return { discardCloudPendingAndLoadRemote, openSupabaseLoginModal, showCloudNoDocument, openCloudUsingSavedSession, enableCloudFromCurrentState, connectSupabaseFromLogin, tryAutoOpenSupabase, logoutSupabase };
}
