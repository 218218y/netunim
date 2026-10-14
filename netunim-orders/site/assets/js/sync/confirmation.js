import {cloudHeadIsSynced} from '../shared/storage-cloud-status.js';
import {normalizeCloudError} from '../shared/cloud-sync.js';

// Owns confirmation for Main; journal and secondary domains remain ports.
export function createCloudConfirmation({model,session,tab,access,state,view}){
  const {storageV2PreparationActive,cloudEnabled,cloudHasLocalWork,writeScopeCurrent}=access;
  const {sameOrderCloudData,refreshStorageV2CloudState}=state;
  const {setCloud,refreshCloudTimestamp}=view;


function pollAccessCurrent(){return !storageV2PreparationActive()&&tab.primaryTab&&cloudEnabled()&&navigator.onLine&&!session.syncCapabilitiesError&&!session.syncCapabilitiesChecking}

function pollViewCurrent({generation,local}={}){return pollAccessCurrent()&&!session.cloudConflictBlocked&&Number(session.localGeneration||0)===generation&&!session.cloudSaveRequested&&!cloudHasLocalWork()&&(!local||sameOrderCloudData(model.state,local))}

function markCloudPollDeferred(head){
  if(storageV2PreparationActive()||!tab.primaryTab||!cloudEnabled())return false;
  if(!navigator.onLine)setCloud('ענן: אופליין','offline');
  else if(head?.control?.conflict||session.cloudConflictBlocked)setCloud('ענן: התנגשות','error');
  else setCloud('ענן: ממתין לסנכרון');
  return false;
}

function markCloudSynced(head,observation){
  if(!pollViewCurrent(observation)||!cloudHeadIsSynced(head,{revision:Number(session.cloudRevision||0),observedHead:observation.head}))return markCloudPollDeferred(head);
  setCloud('ענן: מסונכרן','synced');return true;
}

async function confirmCloudPollSynced(observation,{refreshTimestamp=false,scope=null}={}){
  const head=await refreshStorageV2CloudState();
  if(scope&&!writeScopeCurrent(scope,head))return false;
  const synced=markCloudSynced(head,observation);
  if(synced&&refreshTimestamp)refreshCloudTimestamp();return synced;
}

function markCloudPollFailure(error){
  const normalized=normalizeCloudError(error),transient=['network','timeout','service_unavailable','rate_limited'].includes(normalized.kind);
  if(!navigator.onLine)setCloud('ענן: אופליין','offline');
  else if(transient)setCloud('ענן: ממתין להתאוששות');
  else setCloud('ענן: שגיאת סנכרון','error');
  if(transient)console.warn('orders cloud poll deferred',error?.message||error);else console.error(error);
  return false
}

return {pollAccessCurrent,pollViewCurrent,markCloudPollDeferred,markCloudSynced,confirmCloudPollSynced,markCloudPollFailure};
}
