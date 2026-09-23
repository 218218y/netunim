export function createStorageV2CloudPorts(browser){
  return {
    storageV2CloudOutboxActive:(...args)=>browser.storageV2CloudOutboxActive(...args),
    refreshStorageV2CloudState:(...args)=>browser.refreshStorageV2CloudState(...args),
    initializeStorageV2UploadLocalHead:(...args)=>browser.initializeStorageV2UploadLocalHead(...args),
    initializeStorageV2BootstrapHead:(...args)=>browser.initializeStorageV2BootstrapHead(...args),
    initializeStorageV2CloudCursor:(...args)=>browser.initializeStorageV2CloudCursor(...args),
    materializeStorageV2CloudFlight:(...args)=>browser.materializeStorageV2CloudFlight(...args),
    acknowledgeStorageV2CloudFlight:(...args)=>browser.acknowledgeStorageV2CloudFlight(...args),
    rejectStorageV2CloudFlight:(...args)=>browser.rejectStorageV2CloudFlight(...args),
    setStorageV2CloudControl:(...args)=>browser.setStorageV2CloudControl(...args),
    replaceStorageV2AuthoritativeState:(...args)=>browser.replaceStorageV2AuthoritativeState(...args),
    clearStorageV2CloudControl:(...args)=>browser.clearStorageV2CloudControl(...args),
    replaceStorageV2CurrentState:(...args)=>browser.replaceStorageV2CurrentState(...args),
    queueStorageV2CloudNormalization:(...args)=>browser.queueStorageV2CloudNormalization(...args),
    adoptStorageV2CloudHead:(...args)=>browser.adoptStorageV2CloudHead(...args),
    resetStorageV2CloudHead:(...args)=>browser.resetStorageV2CloudHead(...args),
    storageV2CommitPromise:()=>browser.storageV2CommitPromise,
  };
}
