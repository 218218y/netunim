import {STORAGE_PREF_KEY,SUPA_AUTO_KEY} from '../state/constants.js';

// Owns transfer commands; application startup supplies its narrow ports.
export function createCloudTransfer({session,checksSession,model,auth={},view={},storage={},main={},recovery}){
  const {loadSupaSession}=auth;
  const {setCloudHeaderStatus,render,setConnectedStatus}=view;
  const {storageOwnerCurrent=()=> 'local',startStorageV2OwnerTransfer=async()=>{throw new Error('storage_transfer_unavailable')}}=storage;
  const {prepareKupaCloudState,startCloudPolling}=main;
  const clearCloudRecovery=(...args)=>recovery.reset(...args);

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

return {transferLocalV2};
}
