import {createSharedChecksFlight} from '../shared/shared-checks-flight.js';
import {mergeArray,eq} from './merge-records.js';
import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {clone} from '../core/values.js';

export function createSyncChecks({sharedChecksV2,model,files={},checksSession={},tab,toast,recomputeKupaNetFromCache,renderKupaDependentView,writeStateToFolder,loadSession,refreshCloudTimestamp}){
const flight=createSharedChecksFlight({state:checksSession,pullKey:'checksPullPromise',saveKey:'checksSavePromise',busyKey:'checksCloudBusy'});
function normalizeDeleteIds(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort()}
function protectImplicitDeletes(base,local,deleteIds){const allowed=new Set(normalizeDeleteIds(deleteIds)),safe=normalizeSharedChecks(local||[]),present=new Set(safe.map(x=>x.id));for(const item of normalizeSharedChecks(base||[])){if(item?.id&&!present.has(item.id)&&!allowed.has(item.id)){safe.push(clone(item));present.add(item.id)}}return safe}
function mergeSharedChecks(base,local,remote,{deleteIds=[]}={}){const conflicts=[],b=normalizeSharedChecks(base||[]),r=normalizeSharedChecks(remote||[]),safeLocal=protectImplicitDeletes(b,local,deleteIds),checks=mergeArray(b,safeLocal,r,'id',conflicts,'check');return {checks:normalizeSharedChecks(checks),conflicts}}


async function syncChecksV2({required=false,quiet=false}={}){
  if(!tab.primaryTab||!loadSession()||!navigator.onLine)return false;
  try{
    const ok=await sharedChecksV2.sync(),cloud=await sharedChecksV2.cloudState();
    if(!sharedChecksV2.primaryReady)throw new Error('shared_checks_owner_handoff_required');
    checksSession.checksCloudBase=clone(cloud.base.state.checks);checksSession.checksCloudRevision=cloud.base.revision;
    checksSession.checksCloudUpdatedAt=sharedChecksV2.lastRemoteUpdatedAt||checksSession.checksCloudUpdatedAt;
    checksSession.checksBankEvents=clone(cloud.base.state.bankEvents);checksSession.checksSaveRequested=!!cloud.pending&&!cloud.control?.conflict;
    checksSession.checksCloudLastError=cloud.control?.conflict?'אותו צ׳ק שונה במקביל — נדרשת הכרעה':'';
    recomputeKupaNetFromCache();refreshCloudTimestamp();
    if(files.dirHandle)await writeStateToFolder();if(!quiet)renderKupaDependentView();return ok;
  }catch(error){checksSession.checksCloudLastError=error.message;if(required)throw error;if(!quiet)toast(error.message);return false}
}


async function syncSharedChecksFromCloud({quiet=false,required=false}={}){
  if(!sharedChecksV2?.requested){const error=new Error('shared_checks_v2_required');checksSession.checksCloudLastError=error.message;if(required)throw error;return false}
  return flight.pull(()=>syncChecksV2({quiet,required}));
}

async function saveSharedChecksToCloud(){
  if(!sharedChecksV2?.requested){checksSession.checksCloudLastError='shared_checks_v2_required';return false}
  if(!tab.primaryTab)return false;
  checksSession.checksSaveRequested=true;
  return flight.save(()=>syncChecksV2());
}

async function pollSharedChecks(){
  if(!sharedChecksV2?.requested||!tab.primaryTab||!loadSession()||!navigator.onLine||checksSession.checksSavePromise||checksSession.checksPullPromise)return;
  const before=clone(model.state.checks),synced=await syncSharedChecksFromCloud({quiet:true});
  if(synced&&!eq(before,model.state.checks))renderKupaDependentView();
}

return {mergeSharedChecks,syncSharedChecksFromCloud,saveSharedChecksToCloud,pollSharedChecks};
}
