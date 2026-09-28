import {createSharedChecksFlight} from '../shared/shared-checks-flight.js';
import {clone} from '../core/values.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {jsonEq,mergeRecordArray,mergeRecordArrayPreferLocal} from './merge-records.js';

export function createSyncChecks({sharedChecksV2,checksSession={},model,session,files={},tab,toast,render,setSaveStatus,setCloudHeaderStatus,backupSnapshotToComputer,refreshCloudHeaderTimestamp}){
const flight=createSharedChecksFlight({state:checksSession,pullKey:'sharedChecksPullPromise',saveKey:'sharedChecksSavePromise',busyKey:'sharedChecksBusy'});
function normalizeDeleteIds(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort()}
function protectImplicitDeletes(base,local,deleteIds){const allowed=new Set(normalizeDeleteIds(deleteIds)),safe=normalizeSharedChecks(local||[]),present=new Set(safe.map(x=>x.id));for(const item of normalizeSharedChecks(base||[])){if(item?.id&&!present.has(item.id)&&!allowed.has(item.id)){safe.push(clone(item));present.add(item.id)}}return safe}
function mergeSharedChecks(base,local,remote,{preferLocalConflicts=false,deleteIds=[]}={}){const b=normalizeSharedChecks(base||[]),rawLocal=normalizeSharedChecks(local||[]),r=normalizeSharedChecks(remote||[]),repair=checksSession.sharedChecksBootstrapActive&&!rawLocal.length&&r.length>0&&b.length>0&&jsonEq(b,r)&&!normalizeDeleteIds(deleteIds).length;checksSession.sharedChecksBootstrapActive=false;if(repair)return{checks:clone(r),conflicts:[],repairedEmptyBootstrap:true};const l=protectImplicitDeletes(b,rawLocal,deleteIds),conflicts=[];let checks=mergeRecordArray(b,l,r,'id','checks',conflicts);if(preferLocalConflicts&&conflicts.length)checks=mergeRecordArrayPreferLocal(b,l,r,'id');return{checks:normalizeSharedChecks(checks),conflicts,repairedEmptyBootstrap:false}}

async function syncChecksV2({required=false,quiet=false}={}){
  if(!tab.primaryTab||!session.backendReady||session.connectionMode!=='supabase'||!navigator.onLine)return false;
  try{
    const ok=await sharedChecksV2.sync(),cloud=await sharedChecksV2.cloudState();
    if(!sharedChecksV2.primaryReady)throw new Error('shared_checks_owner_handoff_required');
    checksSession.sharedChecksBase=clone(cloud.base.state.checks);checksSession.sharedChecksRevision=cloud.base.revision;
    checksSession.sharedChecksUpdatedAt=sharedChecksV2.lastRemoteUpdatedAt||checksSession.sharedChecksUpdatedAt;
    checksSession.sharedChecksBankEvents=clone(cloud.base.state.bankEvents);checksSession.sharedChecksSaveRequested=!!cloud.pending&&!cloud.control?.conflict;
    checksSession.sharedChecksLastError=cloud.control?.conflict?'אותו צק שונה במקביל — נדרשת הכרעה':'';
    setSaveStatus(ok?'מסונכרן לענן':checksSession.sharedChecksLastError||'צקים ממתינים לסנכרון',ok?'ok':'saving');
    setCloudHeaderStatus(ok?'synced':'syncing',ok?'ענן: מסונכרן':'ענן: ממתין לסנכרון');refreshCloudHeaderTimestamp();
    if(files.backupsDirHandle)await backupSnapshotToComputer(model.state,session.dbRevision);if(!quiet)render();return ok;
  }catch(error){checksSession.sharedChecksLastError=error.message;if(required)throw error;if(!quiet)toast(error.message);return false}
}


async function syncSharedChecksFromCloud({quiet=false,required=false}={}){
  if(!sharedChecksV2?.requested){const error=new Error('shared_checks_v2_required');checksSession.sharedChecksLastError=error.message;if(required)throw error;return false}
  return flight.pull(()=>syncChecksV2({quiet,required}));
}

async function saveSharedChecksToCloud(){
  if(!sharedChecksV2?.requested){checksSession.sharedChecksLastError='shared_checks_v2_required';return false}
  if(!tab.primaryTab)return false;
  checksSession.sharedChecksSaveRequested=true;
  return flight.save(()=>syncChecksV2());
}

async function pollSharedChecks(){
  if(!sharedChecksV2?.requested||!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!navigator.onLine||checksSession.sharedChecksSavePromise||checksSession.sharedChecksPullPromise)return;
  const before=clone(model.state.checks),synced=await syncSharedChecksFromCloud({quiet:true});
  if(synced&&!jsonEq(before,model.state.checks)){render();refreshCloudHeaderTimestamp()}
}

return {mergeSharedChecks,syncSharedChecksFromCloud,saveSharedChecksToCloud,pollSharedChecks};
}
