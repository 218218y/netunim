import {jsonEq} from './merge-records.js';
import {createPollingTask} from '../shared/runtime-polling.js';

// Owns polling for Main; journal and secondary domains remain ports.
export function createCloudPolling({model,session,tab,access,state,view,remote,adoption,secondary,write,confirmation}){
  const {storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner}=access;
  const {prepareKupaCloudState,refreshStorageV2CloudState}=state;
  const {setSaveStatus,setCloudHeaderStatus,toast}=view;
  const {readSupabaseDocument}=remote;
  const {reviewCleanConflict,applyFinanceOnlyRow,applyCloudRow,setStorageV2CloudControl}=adoption;
  const {pollSharedChecks,pollIndependentFinance,refreshOrdersFinanceSummary}=secondary;
  const {requestStorageV2CloudSave}=write;
  const {pollAccessCurrent,markCloudPollSynced,markCloudPollFailure}=confirmation;

let cloudPollPromise=null;
const cloudPoller=createPollingTask({run:()=>trackedCloudPoll(),delay:()=>12_000+Math.floor(Math.random()*2_000),
  canRun:()=>session.cloudPollingEnabled&&!storageV2PreparationActive(),
  onError:error=>console.error('kupa background cloud poll',error),
  onState:({enabled})=>{session.cloudPollingEnabled=enabled}});
function trackedCloudPoll(){if(cloudPollPromise)return cloudPollPromise;cloudPollPromise=cloudPoll().finally(()=>{cloudPollPromise=null});return cloudPollPromise}
const runtime={
  isPending:()=>!!cloudPollPromise,
  async drain(){do{await cloudPoller.drain();if(cloudPollPromise)await Promise.allSettled([cloudPollPromise])}while(cloudPollPromise)},
};

async function cloudPoll(){
  if(storageV2PreparationActive()||!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!navigator.onLine)return false;
  if(session.cloudSyncBusy||session.cloudWriteBusy){await pollSharedChecks();return false}
  let v2=await refreshStorageV2CloudState();
  if(!storageV2CloudOutboxActive()){setSaveStatus('ראש ענן V2 חסר — הסנכרון נעצר','error');setCloudHeaderStatus('conflict','ענן: נדרש שחזור אחסון מקומי');return false}
  if(v2?.control?.conflict)v2=await reviewCleanConflict(v2);
  if(!tab.primaryTab||!v2?.base||!storageV2CloudOutboxActive())return false;
  if(v2?.control?.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');await pollIndependentFinance();await pollSharedChecks();return false}
  if(v2?.pending||v2?.flight){const generation=Number(session.localGeneration||0),saved=await requestStorageV2CloudSave();await pollIndependentFinance();await pollSharedChecks();return saved&&await markCloudPollSynced(generation,v2)}
  if(session.cloudConflictPending){await pollIndependentFinance();await pollSharedChecks();return false}
  const pollGeneration=Number(session.localGeneration||0),pollHead=v2,localBefore=prepareKupaCloudState(model.state);
  try{
    session.cloudSyncBusy=true;const row=await readSupabaseDocument();
    if(!pollAccessCurrent())return false;
    assertAccountOwner();
    if(!row){setSaveStatus('מסמך הענן אינו זמין','error');setCloudHeaderStatus('auth','ענן: מסמך לא נמצא');return false}
    v2=await refreshStorageV2CloudState();const localAdvanced=Number(session.localGeneration||0)!==pollGeneration||!!(v2?.pending||v2?.flight)||!jsonEq(localBefore,prepareKupaCloudState(model.state));
    if(!pollAccessCurrent())return false;
    if(v2?.control){if(v2.control.conflict)setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
    if(localAdvanced){session.cloudSyncBusy=false;await requestStorageV2CloudSave();return false}
    const kupaChanged=Number(row.revision||0)>Number(session.dbRevision||0),financeChanged=!!row&&Number(row.financeRevision||0)>Number(session.financeRevision||0);
    if(!kupaChanged&&financeChanged){if(!await applyFinanceOnlyRow(row))return false}
    if(kupaChanged){
      const base=v2?.base?.state,clean=!!base&&jsonEq(prepareKupaCloudState(model.state),base);
      if(clean){await applyCloudRow(row);toast('התקבל עדכון ממחשב אחר')}
      else{
      const conflict={kind:'storage-v2-dirty-head',domain:'kupa',message:'Local state differs from its cloud base without a pending journal operation',baseRevision:Number(v2?.base?.revision||session.dbRevision||0),currentRemoteRevision:Number(row.revision||0),at:new Date().toISOString()};
      await setStorageV2CloudControl({conflict});session.cloudConflictPending=true;
      setSaveStatus('התנגשות באחסון המקומי','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false;
      }
    }
  }catch(error){return markCloudPollFailure(error)}finally{session.cloudSyncBusy=false;await Promise.all([pollSharedChecks(),refreshOrdersFinanceSummary({renderIfChanged:true})])}
  try{return await markCloudPollSynced(pollGeneration,pollHead)}catch(error){return markCloudPollFailure(error)}
}

async function resumeAfterReconnect(){
  if(storageV2PreparationActive()||!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!navigator.onLine)return false;
  if(session.cloudSyncBusy||session.cloudWriteBusy)return trackedCloudPoll();
  setSaveStatus('חזרה רשת — מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: חזרה רשת…');
  try{return await trackedCloudPoll()}catch(error){return markCloudPollFailure(error)}
}

return {poll:trackedCloudPoll,resumeAfterReconnect,start:cloudPoller.start,stop:cloudPoller.stop,wake:cloudPoller.wake,runtime};
}
