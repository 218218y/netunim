// Keeps historical credit IDs in the adopted cloud base until explicit deletion.
/** @param {import('../shared/storage-json.js').StorageJsonObject} raw @param {(raw:import('../shared/storage-json.js').StorageJsonObject)=>import('../shared/storage-json.js').StorageJsonObject} project */
export function canonicalCloudSyncBase(raw,project){
  const base=project(raw);
  // The visible model drops expired credits, but the cloud base must retain
  // their server IDs until a flight with explicit delete intents is ACKed.
  if(raw.credits===undefined)delete base.credits;else base.credits=structuredClone(raw.credits);
  return base;
}
