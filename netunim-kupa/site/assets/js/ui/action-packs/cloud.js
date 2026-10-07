// Cloud owns these delegated UI actions and its local event ports.
export function createCloudActions({syncDocument,uiCloud}){
const cloudPoll=(...args)=>syncDocument.cloudPoll(...args);
const discardCloudPendingAndLoadRemote=(...args)=>uiCloud.discardCloudPendingAndLoadRemote(...args);
const enableCloudFromCurrentState=(...args)=>uiCloud.enableCloudFromCurrentState(...args);
const loadSupabaseState=(...args)=>syncDocument.loadSupabaseState(...args);
const logoutSupabase=(...args)=>uiCloud.logoutSupabase(...args);
const openSupabaseLoginModal=(...args)=>uiCloud.openSupabaseLoginModal(...args);
const resetLocalSiteStorage=(...args)=>uiCloud.resetLocalSiteStorage(...args);
return {
  'load-supabase-state':(element,event)=>{loadSupabaseState()},
  'logout-supabase':(element,event)=>{logoutSupabase()},
  'reset-local-site-storage':()=>resetLocalSiteStorage(),
  'cloud-poll':(element,event)=>{cloudPoll()},
  'discard-cloud-pending-and-load-remote':(element,event)=>{discardCloudPendingAndLoadRemote()},
  'enable-cloud-from-current-state':(element,event)=>{enableCloudFromCurrentState()},
  'open-supabase-login-modal':(element,event)=>{openSupabaseLoginModal('open')},
};
}
