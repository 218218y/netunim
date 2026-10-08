import {createSharedChecksFlight} from '../shared/shared-checks-flight.js';
import {mergeArray,eq} from './merge-records.js';
import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {clone} from '../core/values.js';
import {sharedChecksHeadIsSynced} from '../shared/shared-checks-status.js';

export function createSyncChecks({sharedChecksV2,model,files={},checksSession={},tab,toast,recomputeKupaNetFromCache,renderKupaDependentView,writeStateToFolder,loadSession,setCloud,refreshCloudTimestamp}){
const flight=createSharedChecksFlight({state:checksSession,pullKey:'checksPullPromise',saveKey:'checksSavePromise',busyKey:'checksCloudBusy'});
function normalizeDeleteIds(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort()}
function protectImplicitDeletes(base,local,deleteIds){const allowed=new Set(normalizeDeleteIds(deleteIds)),safe=normalizeSharedChecks(local||[]),present=new Set(safe.map(x=>x.id));for(const item of normalizeSharedChecks(base||[])){if(item?.id&&!present.has(item.id)&&!allowed.has(item.id)){safe.push(clone(item));present.add(item.id)}}return safe}
function mergeSharedChecks(base,local,remote,{deleteIds=[]}={}){const conflicts=[],b=normalizeSharedChecks(base||[]),r=normalizeSharedChecks(remote||[]),safeLocal=protectImplicitDeletes(b,local,deleteIds),checks=mergeArray(b,safeLocal,r,'id',conflicts,'check');return {checks:normalizeSharedChecks(checks),conflicts}}

function rememberCloud(cloud){
  checksSession.checksCloudBase=clone(cloud.base.state.checks);checksSession.checksCloudRevision=cloud.base.revision;
  checksSession.checksCloudUpdatedAt=sharedChecksV2.lastRemoteUpdatedAt||checksSession.checksCloudUpdatedAt;
  checksSession.checksBankEvents=clone(cloud.base.state.bankEvents);checksSession.checksSaveRequested=!!cloud.pending&&!cloud.control?.conflict;
  checksSession.checksCloudLastError=cloud.control?.conflict?'אותו צ׳ק שונה במקביל — נדרשת הכרעה':cloud.control?.retry?.lastErrorCode||'';
  recomputeKupaNetFromCache();
}

async function syncChecksV2({required=false,quiet=false}={}){
  const account=loadSession()?.user?.id;
  const current=()=>!!account&&tab.primaryTab&&navigator.onLine&&loadSession()?.user?.id===account;
  if(!current())return false;
  setCloud('ענן: בודק צ׳קים…');
  try{
    const ok=await sharedChecksV2.sync();if(!current())return false;
    const observed=await sharedChecksV2.cloudState();if(!current())return false;
    if(!sharedChecksV2.primaryReady)throw new Error('shared_checks_owner_handoff_required');
    rememberCloud(observed);
    let cloud=observed;
    if(files.dirHandle){await writeStateToFolder();cloud=await sharedChecksV2.cloudState()}
    if(!current())return false;
    if(!sharedChecksV2.primaryReady)throw new Error('shared_checks_owner_handoff_required');
    if(cloud.base?.owner!==observed.base?.owner||cloud.base?.epoch!==observed.base?.epoch)return false;
    const synced=!!ok&&sharedChecksHeadIsSynced(cloud,{checks:model.state.checks,hasLocalWork:sharedChecksV2.hasLocalWork,observedHead:observed});
    if(cloud!==observed)rememberCloud(cloud);
    setCloud(cloud.control?.conflict?'ענן: התנגשות בצ׳קים':synced?'ענן: מסונכרן':'ענן: צ׳קים ממתינים לסנכרון',cloud.control?.conflict?'error':synced?'synced':'',checksSession.checksCloudLastError);
    refreshCloudTimestamp();
    if(!quiet)renderKupaDependentView();return synced;
  }catch(error){if(current()){checksSession.checksCloudLastError=error.message;setCloud('ענן: בדיקת הצ׳קים נכשלה','error',error.message);if(!quiet)toast(error.message)}if(required)throw error;return false}
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
