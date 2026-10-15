// Serializes local mirrors and coalesces cloud publication without owning the
// journal commit. Preserve the outstanding mirror when storage mode changes.
export function createSavePublication({model,session,access,projection,cloud,mirror,view}){
const {storageV2Primary}=access;
const {prepareKupaCloudState,normalizeState}=projection;
const {persistSupabaseState}=cloud;
const {setSaveStatus}=view;
let saveQueue=Promise.resolve(),cloudSavePromise=null,cloudSaveRequest=null;
function requestCloudSave(snapshot,msg,generation){
  cloudSaveRequest={snapshot,msg,generation};
  if(cloudSavePromise)return cloudSavePromise;
  // Preserve the ordering with an outstanding file save when changing storage mode.
  cloudSavePromise=(saveQueue||Promise.resolve()).catch(error=>{console.error('previous save queue',error)}).then(async()=>{
    let ok=true;
    while(cloudSaveRequest){
      const next=cloudSaveRequest;cloudSaveRequest=null;
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

async function persistState(snapshot,msg,generation=session.localGeneration){
  if(!storageV2Primary()){setSaveStatus('אחסון V2 אינו מוכן — השמירה נעצרה','error');return false}
  if(!session.backendReady){setSaveStatus('לא מחובר למקור נתונים','error');return false}
  if(generation===session.localGeneration)snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(model.state):normalizeState(model.state);
  if(session.connectionMode==='supabase')return persistSupabaseState(prepareKupaCloudState(snapshot),msg,generation);
  return mirror.persistState(snapshot,msg,generation);
}

function saveFile(snapshot,msg,generation){
  saveQueue=saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,generation));
  return saveQueue;
}
return {requestCloudSave,saveFile,persistState};
}
