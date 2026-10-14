import {STORAGE_PREF_KEY,SUPA_AUTO_KEY} from '../state/constants.js';

// Owns session commands; application startup supplies its narrow ports.
export function createCloudSession({session,tab,checksSession,auth={},view={},main={},recovery}){
  const {storeSupaSession}=auth;
  const {toast,setCloudHeaderStatus,showSecondaryTabGuard,showFirstRun}=view;
  const {stopCloudPolling}=main;
  const clearCloudRecovery=(...args)=>recovery.reset(...args);

function logoutSupabase(){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  // Logout clears authorization only. activeStorageOwner is durable and remains
  // unchanged, so account data can never fall through to the local namespace.
  clearCloudRecovery();stopCloudPolling();storeSupaSession(null);localStorage.removeItem(STORAGE_PREF_KEY);localStorage.removeItem(SUPA_AUTO_KEY);session.cloudAuthNoDocument=false;session.dbRevision=0;session.financeRevision=0;session.financeUpdatedAt=null;session.serverInfo.lastSavedAt=null;checksSession.sharedChecksRevision=0;checksSession.sharedChecksUpdatedAt=null;setCloudHeaderStatus('off','ענן: לא מחובר');if(session.connectionMode==='supabase'){session.backendReady=false;document.getElementById('connectScreen').style.display='flex';showFirstRun()}toast('ההתחברות לענן נמחקה מהמחשב הזה. בעלות האחסון והשינויים המקומיים נשמרו עד להתחברות מחדש.');return true
}

return {logoutSupabase};
}
