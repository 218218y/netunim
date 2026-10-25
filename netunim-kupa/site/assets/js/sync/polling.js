import {cloudWriteScopeHasIdentity} from '../shared/cloud-write-scope.js';
import {jsonEq} from './merge-records.js';
import {createPollingTask} from '../shared/runtime-polling.js';

// Owns polling for Main; journal and secondary domains remain ports.
/** @param {import('../shared/sync-document-contracts.js').KupaPollingPorts} ports */
export function createCloudPolling({model,session,tab,access,state,view,remote,adoption,secondary,write,confirmation}){
  const {getCloudWriteScope,writeScopeCurrent,isOnline,storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner}=access;
  const {prepareKupaCloudState,refreshStorageV2CloudState}=state;
  const {setSaveStatus,setCloudHeaderStatus,toast}=view;
  const {readSupabaseDocument}=remote;
  const {reviewCleanConflict,applyFinanceOnlyRow,applyCloudRow,setStorageV2CloudControl}=adoption;
  const {pollSharedChecks,pollIndependentFinance,refreshOrdersFinanceSummary}=secondary;
  const {requestStorageV2CloudSave}=write;
  const {pollAccessCurrent,markCloudPollSynced,markCloudPollFailure}=confirmation;

/** @type {Promise<boolean>|null} */
let cloudPollPromise=null;
const cloudPoller=createPollingTask({run:()=>trackedCloudPoll(),delay:()=>12_000+Math.floor(Math.random()*2_000),
  canRun:()=>!!session.cloudPollingEnabled&&!storageV2PreparationActive(),
  onError:error=>console.error('kupa background cloud poll',error),
  onState:({enabled})=>{session.cloudPollingEnabled=enabled}});
function trackedCloudPoll(){if(cloudPollPromise)return cloudPollPromise;cloudPollPromise=cloudPoll().finally(()=>{cloudPollPromise=null});return cloudPollPromise}
const runtime={
  isPending:()=>!!cloudPollPromise,
  async drain(){do{await cloudPoller.drain();if(cloudPollPromise)await Promise.allSettled([cloudPollPromise])}while(cloudPollPromise)},
};

async function cloudPoll(){
  if(storageV2PreparationActive()||!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!isOnline())return false;
  const scope=getCloudWriteScope(),current=()=>writeScopeCurrent(scope);if(!current())return false;
  if(session.cloudSyncBusy||session.cloudWriteBusy){await pollSharedChecks();return false}
  let v2=await refreshStorageV2CloudState();if(!writeScopeCurrent(scope,v2))return false;
  if(!storageV2CloudOutboxActive()){setSaveStatus('ראש ענן V2 חסר — הסנכרון נעצר','error');setCloudHeaderStatus('conflict','ענן: נדרש שחזור אחסון מקומי');return false}
  if(v2?.control?.conflict)v2=await reviewCleanConflict(v2);
  if(!current()||!tab.primaryTab||!v2?.base||!storageV2CloudOutboxActive())return false;
  if(v2?.control?.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');await pollIndependentFinance({isCurrent:current});if(current())await pollSharedChecks();return false}
  if(v2?.pending||v2?.flight){const generation=Number(session.localGeneration||0),saved=await requestStorageV2CloudSave();if(!current())return false;await pollIndependentFinance({isCurrent:current});if(current())await pollSharedChecks();return current()&&saved&&await markCloudPollSynced(generation,v2,{scope})}
  if(session.cloudConflictPending){await pollIndependentFinance({isCurrent:current});if(current())await pollSharedChecks();return false}
  const pollGeneration=Number(session.localGeneration||0),pollHead=v2,localBefore=prepareKupaCloudState(model.state);
  try{
    session.cloudSyncBusy=true;const row=await readSupabaseDocument();
    if(!current()||!pollAccessCurrent())return false;
    assertAccountOwner();
    if(!row){setSaveStatus('מסמך הענן אינו זמין','error');setCloudHeaderStatus('auth','ענן: מסמך לא נמצא');return false}
    v2=await refreshStorageV2CloudState();const localAdvanced=Number(session.localGeneration||0)!==pollGeneration||!!(v2?.pending||v2?.flight)||!jsonEq(localBefore,prepareKupaCloudState(model.state));
    if(!writeScopeCurrent(scope,v2)||!pollAccessCurrent())return false;
    if(v2?.control){if(v2.control.conflict)setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
    if(localAdvanced){session.cloudSyncBusy=false;await requestStorageV2CloudSave();return false}
    const kupaChanged=Number(row.revision||0)>Number(session.dbRevision||0),financeChanged=!!row&&Number(row.financeRevision||0)>Number(session.financeRevision||0);
    if(!kupaChanged&&financeChanged){if(!await applyFinanceOnlyRow(row,{isCurrent:current}))return false}
    if(kupaChanged){
      const base=v2?.base?.state,clean=!!base&&jsonEq(prepareKupaCloudState(model.state),base);
      if(clean){await applyCloudRow(row,{isCurrent:current});if(!current())return false;toast('התקבל עדכון ממחשב אחר')}
      else{
      const conflict={kind:'storage-v2-dirty-head',domain:'kupa',message:'Local state differs from its cloud base without a pending journal operation',baseRevision:Number(v2?.base?.revision||session.dbRevision||0),currentRemoteRevision:Number(row.revision||0),at:new Date().toISOString()};
      await setStorageV2CloudControl({conflict},{expectedScope:scope,isCurrent:current});if(!current())return false;session.cloudConflictPending=true;
      setSaveStatus('התנגשות באחסון המקומי','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false;
      }
    }
  }catch(error){return current()?markCloudPollFailure(error):false}finally{if(cloudWriteScopeHasIdentity(scope,getCloudWriteScope()))session.cloudSyncBusy=false;if(current())await Promise.all([pollSharedChecks(),refreshOrdersFinanceSummary({renderIfChanged:true})])}
  if(!current())return false;
  try{return await markCloudPollSynced(pollGeneration,pollHead,{scope})}catch(error){return current()?markCloudPollFailure(error):false}
}

async function resumeAfterReconnect(){
  if(storageV2PreparationActive()||!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!isOnline())return false;
  if(session.cloudSyncBusy||session.cloudWriteBusy)return trackedCloudPoll();
  setSaveStatus('חזרה רשת — מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: חזרה רשת…');
  try{return await trackedCloudPoll()}catch(error){return markCloudPollFailure(error)}
}

return {poll:trackedCloudPoll,resumeAfterReconnect,start:cloudPoller.start,stop:cloudPoller.stop,wake:cloudPoller.wake,runtime};
}
