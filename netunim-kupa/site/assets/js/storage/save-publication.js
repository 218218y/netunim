// @ts-check
/**
 * @template State, Snapshot
 * @typedef {object} SavePublicationPorts
 * @property {{state:State}} model
 * @property {{connectionMode:string,backendReady:boolean,localGeneration:number}} session
 * @property {{storageV2Primary:()=>boolean}} access
 * @property {{normalizeState:(state:State)=>State,prepareKupaCloudState:(state:State|Snapshot)=>Snapshot}} projection
 * @property {{persistSupabaseState:(snapshot:Snapshot,message:string,generation:number)=>Promise<boolean>}} cloud
 * @property {{persistState:(snapshot:State|Snapshot,message:string,generation:number)=>Promise<boolean>}} mirror
 * @property {{setSaveStatus:(message:string,mode:string)=>unknown}} view
 */
/** @template State, Snapshot @typedef {{requestCloudSave:(snapshot:Snapshot,message:string,generation:number)=>Promise<boolean>,saveFile:(snapshot:State|Snapshot,message:string,generation:number)=>Promise<boolean>,persistState:(snapshot:State|Snapshot,message:string,generation?:number)=>Promise<boolean>}} SavePublication */
// Serializes local mirrors and coalesces cloud publication without owning the
// journal commit. Preserve the outstanding mirror when storage mode changes.
/** @template State, Snapshot @param {SavePublicationPorts<State,Snapshot>} ports @returns {SavePublication<State,Snapshot>} */
export function createSavePublication({model,session,access,projection,cloud,mirror,view}){
const {storageV2Primary}=access;
const {prepareKupaCloudState,normalizeState}=projection;
const {persistSupabaseState}=cloud;
const {setSaveStatus}=view;
/** @type {Promise<boolean|void>} */ let saveQueue=Promise.resolve();
/** @type {Promise<boolean>|null} */ let cloudSavePromise=null;
/** @type {{snapshot:Snapshot,msg:string,generation:number}|null} */ let cloudSaveRequest=null;
/** @param {Snapshot} snapshot @param {string} msg @param {number} generation @returns {Promise<boolean>} */
function requestCloudSave(snapshot,msg,generation){
  cloudSaveRequest={snapshot,msg,generation};
  if(cloudSavePromise)return cloudSavePromise;
  // Preserve the ordering with an outstanding file save when changing storage mode.
  cloudSavePromise=(saveQueue||Promise.resolve()).catch(error=>{console.error('previous save queue',error)}).then(async()=>{
    let ok=true;
    while(cloudSaveRequest){
      /** @type {{snapshot:Snapshot,msg:string,generation:number}} */ const next=cloudSaveRequest;cloudSaveRequest=null;
      try{ok=await persistSupabaseState(next.snapshot,next.msg,next.generation)}
      catch(error){console.error('cloud save failed before durable staging',error);setSaveStatus('השינוי לא נשמר באחסון המקומי — אין לסגור את החלון','error');ok=false}
      // Offline, retry-after and conflicts resume from the V2 journal flight.
      if(!ok)break;
    }
    return ok;
  }).finally(()=>{cloudSavePromise=null});
  saveQueue=cloudSavePromise;
  return cloudSavePromise;
}

/** @param {State|Snapshot} snapshot @param {string} msg @param {number} [generation] @returns {Promise<boolean>} */
async function persistState(snapshot,msg,generation=session.localGeneration){
  if(!storageV2Primary()){setSaveStatus('אחסון V2 אינו מוכן — השמירה נעצרה','error');return false}
  if(!session.backendReady){setSaveStatus('לא מחובר למקור נתונים','error');return false}
  if(generation===session.localGeneration)snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(model.state):normalizeState(model.state);
  if(session.connectionMode==='supabase')return persistSupabaseState(prepareKupaCloudState(snapshot),msg,generation);
  return mirror.persistState(snapshot,msg,generation);
}

/** @param {State|Snapshot} snapshot @param {string} msg @param {number} generation @returns {Promise<boolean>} */
function saveFile(snapshot,msg,generation){
  const queued=saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,generation));
  saveQueue=queued;
  return queued;
}
return {requestCloudSave,saveFile,persistState};
}
