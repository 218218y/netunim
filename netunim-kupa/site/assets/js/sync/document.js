import {createMainSaveOperation} from './save-operation.js';
import {createRemoteAdoption} from './remote-adoption.js';
import {createCloudWriteAuthority} from '../shared/cloud-write-authority.js';
import {createCloudWriteFlight} from './write-flight.js';
import {createCloudAckPublication} from './ack-publication.js';
import {createCloudConfirmation} from './confirmation.js';
import {createCloudPolling} from './polling.js';



// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncDocument({model,session,tab,access,journal,checkpoint,recovery,projection,transport,view,mirror,secondary}){
const {getCloudWriteScope,storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner,isOnline,markCloudMode}=access;
const {refreshStorageV2CloudState,materializeStorageV2CloudFlight,acknowledgeStorageV2CloudFlight,rejectStorageV2CloudFlight,setStorageV2CloudControl,storageV2CommitPromise}=journal;
const {clearStorageV2CloudControl,replaceStorageV2CurrentState,queueStorageV2CloudNormalization,adoptStorageV2CloudHead,resetStorageV2CloudHead}=checkpoint;
const {readStorageV2CloudRecovery,commitStorageV2CloudRecovery,cancelCloudRecovery}=recovery;
const {prepareKupaCloudState,applyKupaCloudState,mergeKupaCloudState3Way,domainRevisions}=projection;
const {readSupabaseDocument,readFinanceSyncDocument,rpcSaveCloudV2}=transport;
const {hideConnectScreen,reportError,setSaveStatus,setConnectedStatus,setCloudHeaderStatus,showSecondaryTabGuard,toast,render}=view;
const {listBackups,backupSnapshotToComputer}=mirror;
const {syncSharedChecksFromCloud,pollSharedChecks,refreshOrdersFinanceSummary}=secondary;

const {isCurrent:writeScopeCurrent,setControl:setWriteControl}=createCloudWriteAuthority({
  scope:{read:getCloudWriteScope},
  leadership:{primary:()=>tab.primaryTab,preparing:storageV2PreparationActive},
  control:{write:setStorageV2CloudControl},
});






const {replaceVisibleState,applyKupaCoreState,applyAcknowledgedCoreState,applyFinanceOnlyRow,pollIndependentFinance,reviewCleanConflict,applyCloudRow,loadSupabaseState}=createRemoteAdoption({
  model,session,tab,access:{storageV2CloudOutboxActive,assertAccountOwner,markCloudMode},
  journal:{refreshStorageV2CloudState,replaceStorageV2CurrentState,clearStorageV2CloudControl,adoptStorageV2CloudHead,setStorageV2CloudControl,queueStorageV2CloudNormalization,resetStorageV2CloudHead},
  projection:{domainRevisions,prepareKupaCloudState,applyKupaCloudState},transport:{readSupabaseDocument,readFinanceSyncDocument},
  view:{setSaveStatus,setCloudHeaderStatus,hideConnectScreen,setConnectedStatus,render},mirror:{listBackups,backupSnapshotToComputer},
  secondary:{syncSharedChecksFromCloud,refreshOrdersFinanceSummary},write:{requestStorageV2CloudSave,startCloudPolling},
});
function requestStorageV2CloudSave(...args){return saveOperation.request(...args)}
function persistSupabaseState(...args){return saveOperation.persistSupabaseState(...args)}

function startCloudPolling(){return polling.start()}
function stopCloudPolling(){saveOperation.stop();return polling.stop()}
const {publishAcknowledgedFlight}=createCloudAckPublication({
  model,
  session,
  tab,
  access:{writeScopeCurrent},
  journal:{refreshStorageV2CloudState,acknowledgeStorageV2CloudFlight,setWriteControl},
  projection:{prepareKupaCloudState,mergeKupaCloudState3Way,applyKupaCoreState,applyAcknowledgedCoreState},
  view:{setSaveStatus,setCloudHeaderStatus,reportError,render},
  mirror:{backupSnapshotToComputer},
  recovery:{readStorageV2CloudRecovery,commitStorageV2CloudRecovery},
});
const {saveStorageV2CloudFlight}=createCloudWriteFlight({
  model,
  session,
  access:{writeScopeCurrent,getCloudWriteScope},
  journal:{refreshStorageV2CloudState,materializeStorageV2CloudFlight,rejectStorageV2CloudFlight,setWriteControl},
  projection:{prepareKupaCloudState,mergeKupaCloudState3Way,applyKupaCoreState,replaceVisibleState},
  transport:{rpcSaveCloudV2,readSupabaseDocument},
  view:{setSaveStatus,setCloudHeaderStatus,reportError,render},
  publication:{publishAcknowledgedFlight},
});
const confirmation=createCloudConfirmation({
  model,
  session,
  tab,
  access:{isOnline,storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner,writeScopeCurrent},
  state:{prepareKupaCloudState,refreshStorageV2CloudState},
  view:{setSaveStatus,setCloudHeaderStatus},
});
const saveOperation=createMainSaveOperation({session,tab,
  access:{getCloudWriteScope,writeScopeCurrent,setWriteControl,isOnline,storageV2CloudOutboxActive},
  journal:{refreshStorageV2CloudState,materializeStorageV2CloudFlight,storageV2CommitPromise},
  write:{saveStorageV2CloudFlight,wake:()=>polling.wake()},confirmation,
  view:{setSaveStatus,setCloudHeaderStatus,showSecondaryTabGuard,toast},
});
const polling=createCloudPolling({
  model,
  session,
  tab,
  access:{isOnline,storageV2PreparationActive,storageV2CloudOutboxActive,assertAccountOwner},
  state:{prepareKupaCloudState,refreshStorageV2CloudState},
  view:{setSaveStatus,setCloudHeaderStatus,toast},
  remote:{readSupabaseDocument},
  adoption:{reviewCleanConflict,applyFinanceOnlyRow,applyCloudRow,setStorageV2CloudControl},
  secondary:{pollSharedChecks,pollIndependentFinance,refreshOrdersFinanceSummary},
  write:{requestStorageV2CloudSave},
  confirmation,
});
const trackedCloudPoll=polling.poll,resumeAfterReconnect=polling.resumeAfterReconnect;
const runtime={
  isPending:()=>saveOperation.runtime.isPending()||polling.runtime.isPending(),
  async drain(){
    do{
      await saveOperation.runtime.drain();await polling.runtime.drain();
    }while(saveOperation.runtime.isPending()||polling.runtime.isPending());
  },
};
async function quiesceForStorageCutover(){
  stopCloudPolling();
  cancelCloudRecovery();
  saveOperation.cancelRetry();
  await runtime.drain();
  saveOperation.cancelRetry();return true;
}

return { applyCloudRow, loadSupabaseState, rpcSaveCloudV2, persistSupabaseState, requestStorageV2CloudSave, cloudPoll:trackedCloudPoll, resumeAfterReconnect, startCloudPolling,stopCloudPolling,quiesceForStorageCutover,runtime };
}
