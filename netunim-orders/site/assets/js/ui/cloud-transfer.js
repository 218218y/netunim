import {CLOUD_AUTO_KEY} from '../state/constants.js';

// Owns transfer commands; application startup supplies its narrow ports.
export function createCloudTransfer({model,session,checksSession,auth={},view={},storage={},main={},secondary={},recovery}){
  const {loadSession}=auth;
  const {setCloud,render}=view;
  const {storageOwnerCurrent=()=>null,startStorageV2OwnerTransfer=async()=>{throw new Error('storage_transfer_unavailable')}}=storage;
  const {prepareCloudState,startPolling}=main;
  const {startFinanceAutoSync=()=>{}}=secondary;
  const clearCloudRecovery=(...args)=>recovery.reset(...args);

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

return {transferLocalV2};
}
