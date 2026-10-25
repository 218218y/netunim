import {responseProperty} from '../shared/response-evidence.js';
import {cloudHeadIsSynced} from '../shared/storage-cloud-status.js';
import {jsonEq} from './merge-records.js';
import {normalizeCloudError} from '../shared/cloud-sync.js';

// Owns confirmation for Main; journal and secondary domains remain ports.
/** @param {import('../shared/sync-document-contracts.js').KupaConfirmationPorts} ports */
export function createCloudConfirmation({model,session,tab,access,state,view}){
  const {isOnline,storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner,writeScopeCurrent}=access;
  const {prepareKupaCloudState,refreshStorageV2CloudState}=state;
  const {setSaveStatus,setCloudHeaderStatus}=view;


function pollAccessCurrent(){return !storageV2PreparationActive()&&tab.primaryTab&&isOnline()&&session.connectionMode==='supabase'&&!!session.backendReady&&storageV2CloudOutboxActive()&&!session.syncCapabilitiesError&&!session.syncCapabilitiesChecking}

function cloudScopeAccess(force=false){
  if(storageV2PreparationActive()||session.storageProtocolBlocked||!tab.primaryTab||!storageV2CloudOutboxActive()||session.syncCapabilitiesError||session.syncCapabilitiesChecking||(!force&&(session.connectionMode!=='supabase'||!session.backendReady)))return false;
  try{assertAccountOwner();return true}catch(error){console.warn('Kupa cloud confirmation denied by account fence',error);return false}
}

function cloudConfirmationAccess(force=false){return isOnline()&&cloudScopeAccess(force)}

/** @param {import('../shared/sync-document-contracts.js').Head} head @param {import('../shared/sync-document-contracts.js').Head} observedHead */
function sameCloudScope(head,observedHead){return !!head?.base&&!!observedHead?.base&&head.base.owner===observedHead.base.owner&&head.base.epoch===observedHead.base.epoch}

/** @type {import('../shared/sync-document-contracts.js').Confirmation['confirmCloudSynced']} */
async function confirmCloudSynced(generation,observedHead,{force=false,scope=null}={}){
  let head;
  try{head=await refreshStorageV2CloudState()}catch(error){
    if((!scope||writeScopeCurrent(scope))&&cloudScopeAccess(force))markCloudPollFailure(error);else console.warn('Kupa cloud confirmation read deferred after access loss',error);
    return {synced:false,head:null,advanced:false};
  }
  if(scope&&!writeScopeCurrent(scope,head))return {synced:false,head,advanced:false};
  if(!head?.base||!observedHead?.base||!cloudConfirmationAccess(force)||!sameCloudScope(head,observedHead)){
    if(!isOnline()&&cloudScopeAccess(force)&&sameCloudScope(head,observedHead)){setSaveStatus('אופליין — שינוי שמור מקומית וממתין','saving');setCloudHeaderStatus('offline','ענן: אופליין')}
    return {synced:false,head,advanced:false};
  }
  const advanced=Number(session.localGeneration||0)!==generation||head.seq!==observedHead.seq;
  if(advanced||session.cloudConflictPending||!cloudHeadIsSynced(head,{revision:Number(session.dbRevision||0),observedHead})||!jsonEq(prepareKupaCloudState(model.state),head.base.state)){
    if(head?.control?.conflict||session.cloudConflictPending)setCloudHeaderStatus('conflict','ענן: התנגשות');
    else{setSaveStatus('שינוי שמור מקומית וממתין לסנכרון','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון')}
    return {synced:false,head,advanced};
  }
  setSaveStatus?.('מסונכרן לענן','ok');setCloudHeaderStatus?.('synced','ענן: מסונכרן');return {synced:true,head,advanced:false};
}

/** @type {import('../shared/sync-document-contracts.js').Confirmation['markCloudPollSynced']} */
async function markCloudPollSynced(generation,observedHead,options={}){return (await confirmCloudSynced(generation,observedHead,options)).synced}

/** @param {unknown} error @returns {false} */
function markCloudPollFailure(error){
  const normalized=normalizeCloudError(error),transient=['network','timeout','service_unavailable','rate_limited'].includes(normalized.kind);
  if(!isOnline()){setSaveStatus?.('אופליין — שינויים יישמרו מקומית','saving');setCloudHeaderStatus?.('offline','ענן: אופליין')}
  else if(transient){setSaveStatus?.('ממתין לחידוש חיבור הענן','saving');setCloudHeaderStatus?.('syncing','ענן: ממתין להתאוששות')}
  else{setSaveStatus?.('בדיקת הענן נכשלה','error');setCloudHeaderStatus?.('conflict','ענן: שגיאת סנכרון')}
  if(transient)console.warn('cloud poll deferred',responseProperty(error,'message')||error);else console.error('cloud poll',error);
  return false
}

return {pollAccessCurrent,cloudScopeAccess,cloudConfirmationAccess,sameCloudScope,confirmCloudSynced,markCloudPollSynced,markCloudPollFailure};
}
