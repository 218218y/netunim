import {cloudHeadIsSynced} from '../shared/storage-cloud-status.js';
import {createPollingTask} from '../shared/runtime-polling.js';

// Owns polling for Main; journal and secondary domains remain ports.
export function createCloudPolling({model,session,tab,files,access,state,view,remote,adoption,secondary,write,confirmation}){
  const {storageV2PreparationActive,cloudEnabled,cloudHasLocalWork}=access;
  const {prepareCloudState,sameOrderCloudData,refreshStorageV2CloudState}=state;
  const {setCloud,render,toast}=view;
  const {readCloudMeta,readCloud}=remote;
  const {adoptRemoteRow,writeStateToFolder}=adoption;
  const {pollSharedChecks,refreshKupaReadout}=secondary;
  const {requestCloudSave}=write;
  const {pollViewCurrent,markCloudPollDeferred,confirmCloudPollSynced,markCloudPollFailure}=confirmation;

let cloudPollPromise=null;
const cloudPoller=createPollingTask({run:()=>trackedCloudPoll(),delay:()=>12_000+Math.floor(Math.random()*2_000),
  canRun:()=>session.cloudPollingEnabled&&!storageV2PreparationActive(),
  onError:error=>console.error('orders background cloud poll',error),
  onState:({enabled})=>{session.cloudPollingEnabled=enabled}});
function trackedCloudPoll(){if(cloudPollPromise)return cloudPollPromise;cloudPollPromise=cloudPoll().finally(()=>{cloudPollPromise=null});return cloudPollPromise}
const runtime={
  isPending:()=>!!cloudPollPromise,
  async drain(){do{await cloudPoller.drain();if(cloudPollPromise)await Promise.allSettled([cloudPollPromise])}while(cloudPollPromise)},
};

async function cloudPoll(){
  if(storageV2PreparationActive()||!tab.primaryTab||!cloudEnabled()||session.cloudBusy||!navigator.onLine)return false;
  if(cloudHasLocalWork()){const saved=await requestCloudSave('סונכרנו שינויים מקומיים ועדכון מרחוק');await pollSharedChecks();return saved}
  let dataApiReadOk=false;
  const observation={generation:Number(session.localGeneration||0),local:prepareCloudState(model.state),head:null};
  let ready=false;
  async function readMain(){
    const head=await refreshStorageV2CloudState();observation.head=head;
    if(!pollViewCurrent(observation)||!cloudHeadIsSynced(head,{revision:Number(session.cloudRevision||0)}))return markCloudPollDeferred(head);
    const meta=await readCloudMeta();dataApiReadOk=true;
    if(!pollViewCurrent(observation))return markCloudPollDeferred();
    if(!meta){setCloud('ענן: מסמך לא נמצא','error');return false}
    const metaRevision=Number(meta.revision||0);
    if(!Number.isSafeInteger(metaRevision)||metaRevision<1)throw new Error('orders_v2_remote_revision_invalid');
    if(metaRevision<=session.cloudRevision){session.cloudUpdatedAt=meta.updated_at||session.cloudUpdatedAt;return true}
    const row=await readCloud();
    if(!pollViewCurrent(observation))return markCloudPollDeferred();
    if(!row){setCloud('ענן: מסמך לא נמצא','error');return false}
    const rowRevision=Number(row.revision||0);
    if(!Number.isSafeInteger(rowRevision)||rowRevision<1)throw new Error('orders_v2_remote_revision_invalid');
    if(rowRevision<=session.cloudRevision){session.cloudUpdatedAt=row.updated_at||meta.updated_at||session.cloudUpdatedAt;return true}
    const meaningful=!sameOrderCloudData(model.state,row.state);
    if(!await adoptRemoteRow(row,observation.generation,head,{applyState:meaningful}))return false;
    // The adopted projection replaces the earlier comparison candidate. Shared
    // checks remain independent; only Main's projection is compared here.
    observation.local=prepareCloudState(model.state);
    if(!meaningful){session.lastCloudState=prepareCloudState(row.state||model.state);return true}
    try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
    render();toast('התקבל עדכון מהענן');return true;
  }
  try{
    session.cloudBusy=true;
    ready=await readMain();
  }catch(error){return markCloudPollFailure(error)}
  finally{session.cloudBusy=false;if(dataApiReadOk){await pollSharedChecks();await refreshKupaReadout({renderIfChanged:true})}}
  // The final authoritative read occurs after independent hydration too. An edit
  // during any of those awaits cannot publish a stale "synced" assertion.
  if(!ready)return false;
  try{return await confirmCloudPollSynced(observation,{refreshTimestamp:true})}catch(error){return markCloudPollFailure(error)}
}

async function resumeAfterReconnect(){
  if(storageV2PreparationActive()||!tab.primaryTab||!cloudEnabled()||!navigator.onLine)return false;
  if(session.cloudBusy)return trackedCloudPoll();
  setCloud('ענן: חזרה רשת…');
  try{
    if(cloudHasLocalWork()){
      const saved=await requestCloudSave('שינויים ממתינים סונכרנו');
      if(!saved&&cloudHasLocalWork())return false;
    }
    return await trackedCloudPoll()
  }catch(error){return markCloudPollFailure(error)}
}

return {poll:trackedCloudPoll,resumeAfterReconnect,start:cloudPoller.start,stop:cloudPoller.stop,wake:cloudPoller.wake,runtime};
}
