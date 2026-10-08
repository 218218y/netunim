import {createSyncChecks} from '../sync/checks.js';

export function composeChecksSync({model,files,checksSession,tab,uiStatus,domainsBankCache,storageFiles,cloudAuth,sharedChecksV2=null}){
  return createSyncChecks({
    model,files,checksSession,tab,sharedChecksV2,
    toast:(...args)=>uiStatus.toast(...args),
    recomputeKupaNetFromCache:(...args)=>domainsBankCache.recomputeKupaNetFromCache(...args),
    renderKupaDependentView:(...args)=>domainsBankCache.renderKupaDependentView(...args),
    writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
    loadSession:(...args)=>cloudAuth.loadSession(...args),
    setCloud:(...args)=>uiStatus.setChecksCloud(...args),
    refreshCloudTimestamp:(...args)=>uiStatus.refreshCloudTimestamp(...args),
  });
}
