import {cloudHeadIsSynced} from '../shared/storage-cloud-status.js';
import {jsonEq} from './merge-records.js';
import {normalizeCloudError} from '../shared/cloud-sync.js';

// Owns confirmation for Main; journal and secondary domains remain ports.
export function createCloudConfirmation({model,session,tab,access,state,view}){
  const {storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner,writeScopeCurrent}=access;
  const {prepareKupaCloudState,refreshStorageV2CloudState}=state;
  const {setSaveStatus,setCloudHeaderStatus}=view;


function pollAccessCurrent(){return !storageV2PreparationActive()&&tab.primaryTab&&navigator.onLine&&session.connectionMode==='supabase'&&session.backendReady&&storageV2CloudOutboxActive()&&!session.syncCapabilitiesError&&!session.syncCapabilitiesChecking}

function cloudScopeAccess(force=false){
  if(storageV2PreparationActive()||session.storageProtocolBlocked||!tab.primaryTab||!storageV2CloudOutboxActive()||session.syncCapabilitiesError||session.syncCapabilitiesChecking||(!force&&(session.connectionMode!=='supabase'||!session.backendReady)))return false;
  try{assertAccountOwner();return true}catch(error){console.warn('Kupa cloud confirmation denied by account fence',error);return false}
}

function cloudConfirmationAccess(force=false){return navigator.onLine&&cloudScopeAccess(force)}

function sameCloudScope(head,observedHead){return !!head?.base&&!!observedHead?.base&&head.base.owner===observedHead.base.owner&&head.base.epoch===observedHead.base.epoch}

async function confirmCloudSynced(generation,observedHead,{force=false,scope=null}={}){
  let head;
  try{head=await refreshStorageV2CloudState()}catch(error){
    if((!scope||writeScopeCurrent(scope))&&cloudScopeAccess(force))markCloudPollFailure(error);else console.warn('Kupa cloud confirmation read deferred after access loss',error);
    return {synced:false,head:null,advanced:false};
  }
  if(scope&&!writeScopeCurrent(scope,head))return {synced:false,head,advanced:false};
  if(!cloudConfirmationAccess(force)||!sameCloudScope(head,observedHead)){
    if(!navigator.onLine&&cloudScopeAccess(force)&&sameCloudScope(head,observedHead)){setSaveStatus('אופליין — שינוי שמור מקומית וממתין','saving');setCloudHeaderStatus('offline','ענן: אופליין')}
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

async function markCloudPollSynced(generation,observedHead){return (await confirmCloudSynced(generation,observedHead)).synced}

function markCloudPollFailure(error){
  const normalized=normalizeCloudError(error),transient=['network','timeout','service_unavailable','rate_limited'].includes(normalized.kind);
  if(!navigator.onLine){setSaveStatus?.('אופליין — שינויים יישמרו מקומית','saving');setCloudHeaderStatus?.('offline','ענן: אופליין')}
  else if(transient){setSaveStatus?.('ממתין לחידוש חיבור הענן','saving');setCloudHeaderStatus?.('syncing','ענן: ממתין להתאוששות')}
  else{setSaveStatus?.('בדיקת הענן נכשלה','error');setCloudHeaderStatus?.('conflict','ענן: שגיאת סנכרון')}
  if(transient)console.warn('cloud poll deferred',error?.message||error);else console.error('cloud poll',error);
  return false
}

return {pollAccessCurrent,cloudScopeAccess,cloudConfirmationAccess,sameCloudScope,confirmCloudSynced,markCloudPollSynced,markCloudPollFailure};
}
