export function createStorageV2CloudPorts(browser){
  return {
    storageV2CloudOutboxActive:(...args)=>browser.storageV2CloudOutboxActive(...args),
    refreshStorageV2CloudState:(...args)=>browser.refreshStorageV2CloudState(...args),
    initializeStorageV2CloudCursor:(...args)=>browser.initializeStorageV2CloudCursor(...args),
    materializeStorageV2CloudFlight:(...args)=>browser.materializeStorageV2CloudFlight(...args),
    acknowledgeStorageV2CloudFlight:(...args)=>browser.acknowledgeStorageV2CloudFlight(...args),
    rejectStorageV2CloudFlight:(...args)=>browser.rejectStorageV2CloudFlight(...args),
    setStorageV2CloudControl:(...args)=>browser.setStorageV2CloudControl(...args),
    adoptStorageV2CloudHead:(...args)=>browser.adoptStorageV2CloudHead(...args),
    storageV2CommitPromise:()=>browser.storageV2CommitPromise,
  };
}
