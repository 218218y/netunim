// Keeps historical credit IDs in the adopted cloud base until explicit deletion.
export function canonicalCloudSyncBase(raw,project){
  const base=project(raw);
  // The visible model drops expired credits, but the cloud base must retain
  // their server IDs until a flight with explicit delete intents is ACKed.
  base.credits=structuredClone(raw.credits);
  return base;
}
