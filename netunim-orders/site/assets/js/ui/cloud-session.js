import {CLOUD_AUTO_KEY} from '../state/constants.js';

// Owns session commands; application startup supplies its narrow ports.
export function createCloudSession({session,checksSession,auth={},view={},main={},secondary={},recovery}){
  const {saveSession}=auth;
  const {toast,setCloud,renderSettings}=view;
  const {stopPolling}=main;
  const {stopFinanceAutoSync=()=>{}}=secondary;
  const clearCloudRecovery=(...args)=>recovery.reset(...args);

function logoutCloud(){
  // Logout clears authorization only. activeStorageOwner is durable and remains
  // unchanged, so account data can never fall through to the local namespace.
  clearCloudRecovery();stopPolling();stopFinanceAutoSync();saveSession(null);localStorage.removeItem(CLOUD_AUTO_KEY);session.cloudRevision=0;session.cloudUpdatedAt=null;checksSession.checksCloudRevision=0;checksSession.checksCloudUpdatedAt=null;session.cloudConflictBlocked=false;session.cloudSaveRequested=false;setCloud('ענן: לא פעיל','off');renderSettings();toast('נותקת מהענן; בעלות האחסון והנתונים המקומיים נשמרו עד להתחברות מחדש');return true
}

return {logoutCloud};
}
