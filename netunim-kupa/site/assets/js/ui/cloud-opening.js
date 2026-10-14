import {SUPA_EMAIL_KEY} from '../state/constants.js';
import {esc} from '../core/values.js';

// Owns opening commands; application startup supplies its narrow ports.
export function createCloudOpening({session,tab,auth={},view={},storage={},main={},recovery,transfer,authentication}){
  const {supaConfigured,loadSupaSession,restoreSupaSession,storeSupaSession,isSupabaseAuthError,friendlySupabaseError,supaEnsureSession}=auth;
  const {configureCloudConnectButton,supaProjectRef,setCloudHeaderStatus,setConnectUI,showSecondaryTabGuard,render}=view;
  const {storageV2CloudOutboxActive=()=>false,storageV2PrimaryRequested=()=>false,refreshStorageV2CloudState=async()=>null,storageOwnerCurrent=()=> 'local',storageOwnerAdoption=()=>null}=storage;
  const {recoverBrowserV2State,readSupabaseDocument,applyCloudRow,requestStorageV2CloudSave,startCloudPolling}=main;
  const clearCloudRecovery=(...args)=>recovery.reset(...args);
  const scheduleCloudRecovery=(...args)=>recovery.schedule(...args);
  const transferLocalV2=(...args)=>transfer.transferLocalV2(...args);
  const openSupabaseLoginModal=(...args)=>authentication.openSupabaseLoginModal(...args);

async function deferPendingRecovery(){
  const v2=await refreshStorageV2CloudState();
  if(!v2?.base||!storageV2CloudOutboxActive())throw new Error('kupa_v2_owner_head_required');
  if(!(v2.pending||v2.flight||v2.control?.conflict))return false;
  session.connectionMode='supabase';session.backendReady=true;document.getElementById('connectScreen').style.display='none';
  if(v2.control?.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');render();startCloudPolling();return true}
  await requestStorageV2CloudSave();render();startCloudPolling();return true;
}

async function showCloudNoDocument(){
  session.cloudAuthNoDocument=true;setCloudHeaderStatus('auth','ענן: מחובר · טרם הועלתה קופה');
  const ses=loadSupaSession(),email=ses?.user?.email||localStorage.getItem(SUPA_EMAIL_KEY)||'משתמש מחובר';
  setConnectUI({title:'מחובר ל-Supabase — עדיין אין קופה בענן',text:`ההתחברות הצליחה כ־<b>${esc(email)}</b> לפרויקט <b>${esc(supaProjectRef())}</b>, אבל למשתמש הזה עדיין אין מסמך קופה בשם <b>${esc(session.cloudDocumentName)}</b>.`,note:'זה לא כשל התחברות. אם זה המשתמש הנכון — פתח את הקופה המקומית, עבור אל <b>הגדרות וגיבוי</b> ולחץ <b>הפעל ענן והעלה את הקופה הנוכחית</b>. אם זה משתמש אחר, לחץ <b>התחבר עם משתמש אחר</b>.',showChoose:true,showFile:!window.showDirectoryPicker,showCloud:true});
  configureCloudConnectButton('התחבר עם משתמש אחר','reauth');
}

async function openCloudUsingSavedSession({interactive=true}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}if(!supaConfigured())return false;
  const saved=await restoreSupaSession();if(!saved){if(interactive)openSupabaseLoginModal('open');return false}
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');const localOwner=storageOwnerCurrent()==='local';
    if(!localOwner&&await deferPendingRecovery()){clearCloudRecovery();return true}
    await supaEnsureSession();if(localOwner&&storageV2PrimaryRequested())return await transferLocalV2('load-account');
    const row=await readSupabaseDocument();if(!row){clearCloudRecovery();await showCloudNoDocument();return false}
    await applyCloudRow(row);clearCloudRecovery();return true
  }catch(e){console.error(e);if(isSupabaseAuthError(e)){clearCloudRecovery();storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');if(interactive)openSupabaseLoginModal('open');return false}setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין');scheduleCloudRecovery();if(await recoverBrowserV2State())return true;if(interactive)alert('לא ניתן לפתוח את הקופה מהענן: '+friendlySupabaseError(e));return false}
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

async function tryAutoOpenSupabase(){
  if(!tab.primaryTab)return false;if(!supaConfigured())return false;const s=await restoreSupaSession();if(!s)return false;
  try{
    setCloudHeaderStatus('syncing','ענן: בודק…');const localOwner=storageOwnerCurrent()==='local',reserved=storageOwnerAdoption();
    if(localOwner&&storageV2PrimaryRequested())return false;
    if(reserved?.intent==='upload-local'){await enableCloudFromCurrentState();clearCloudRecovery();return storageOwnerCurrent()!=='local'}if(!localOwner&&await deferPendingRecovery()){clearCloudRecovery();return true}
    await supaEnsureSession();const row=await readSupabaseDocument();if(!row){clearCloudRecovery();session.cloudAuthNoDocument=true;setCloudHeaderStatus('auth','ענן: מחובר · אין קופה');return false}
    await applyCloudRow(row);clearCloudRecovery();return true
  }catch(e){console.error('auto cloud',e);if(isSupabaseAuthError(e)){clearCloudRecovery();storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות')}else{setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין להתאוששות':'ענן: אופליין');scheduleCloudRecovery();if(await recoverBrowserV2State())return true}return false}
}

return {deferPendingRecovery,showCloudNoDocument,openCloudUsingSavedSession,enableCloudFromCurrentState,tryAutoOpenSupabase};
}
