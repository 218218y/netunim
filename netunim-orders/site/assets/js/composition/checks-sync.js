import {createSyncChecks} from '../sync/checks.js';

export function composeChecksSync({model,files,checksSession,tab,storageBrowser,storageChecks,uiStatus,domainsBankCache,syncChecksPersistence,storageFiles,cloudAuth,cloudTransport,stateSnapshots,domainRevisions,sharedChecksV2Shadow,sharedChecksV2=null}){
  return createSyncChecks({
    model,files,checksSession,tab,sharedChecksV2,
    localSnapshot:(...args)=>storageBrowser.localSnapshot(...args),
    refreshStorageV2CloudState:(...args)=>storageBrowser.refreshStorageV2CloudState(...args),
    replaceStorageV2CurrentState:(...args)=>storageBrowser.replaceStorageV2CurrentState(...args),
    observeSharedChecksBoundary:sharedChecksV2Shadow.boundary,
    persistChecksBase:(...args)=>storageChecks.persistChecksBase(...args),
    markChecksPending:(...args)=>storageChecks.markChecksPending(...args),
    getChecksPending:(...args)=>storageChecks.getChecksPending(...args),
    clearChecksPending:(...args)=>storageChecks.clearChecksPending(...args),
    toast:(...args)=>uiStatus.toast(...args),
    recomputeKupaNetFromCache:(...args)=>domainsBankCache.recomputeKupaNetFromCache(...args),
    renderKupaDependentView:(...args)=>domainsBankCache.renderKupaDependentView(...args),
    queueSharedChecksSave:(...args)=>syncChecksPersistence.queueSharedChecksSave(...args),
    writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
    loadSession:(...args)=>cloudAuth.loadSession(...args),
    readSharedChecksCloud:(...args)=>cloudTransport.readSharedChecksCloud(...args),
    checksPendingExists:(...args)=>storageChecks.checksPendingExists(...args),
    rpcSaveSharedChecks:(...args)=>cloudTransport.rpcSaveSharedChecks(...args),
    checksHaveLocalWork:(...args)=>stateSnapshots.checksHaveLocalWork(...args),
    readSharedChecksCloudMeta:(...args)=>cloudTransport.readSharedChecksCloudMeta(...args),
    refreshCloudTimestamp:(...args)=>uiStatus.refreshCloudTimestamp(...args),
    touchChecksRevision:()=>domainRevisions.touch('checks'),
  });
}
