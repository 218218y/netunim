import {createSharedChecksFlight} from '../shared/shared-checks-flight.js';
import {clone} from '../core/values.js';
import {createSharedChecksMerge} from './checks-merge.js';
import {jsonEq} from './merge-records.js';
import {sharedChecksHeadIsSynced} from '../shared/shared-checks-status.js';

export function createSyncChecks({sharedChecksV2,checksSession={},model,session,files={},tab,toast,render,setSaveStatus,setCloudHeaderStatus,backupSnapshotToComputer,refreshCloudHeaderTimestamp,loadSession=()=>null,isOnline=()=>globalThis.navigator?.onLine!==false}){
const slots={};
let disposed=false;
const flight=createSharedChecksFlight({state:slots,pullKey:'pull',saveKey:'save',busyKey:'busy'});
Object.defineProperty(checksSession,'sharedChecksBusy',{configurable:true,enumerable:true,get:()=>slots.busy});
const runtime={
  isSaving:()=>!!slots.save,
  isPending:()=>!!(slots.pull||slots.save),
  async drain(){while(slots.pull||slots.save)await Promise.allSettled([slots.pull,slots.save].filter(Boolean))},
  dispose(){if(disposed)return false;disposed=true;return true},
};
const mergeSharedChecks=createSharedChecksMerge({checksSession});

function rememberCloud(cloud){
  checksSession.sharedChecksBase=clone(cloud.base.state.checks);checksSession.sharedChecksRevision=cloud.base.revision;
  checksSession.sharedChecksUpdatedAt=sharedChecksV2.lastRemoteUpdatedAt||checksSession.sharedChecksUpdatedAt;
  checksSession.sharedChecksBankEvents=clone(cloud.base.state.bankEvents);checksSession.sharedChecksSaveRequested=!!cloud.pending&&!cloud.control?.conflict;
  checksSession.sharedChecksLastError=cloud.control?.conflict?'אותו צק שונה במקביל — נדרשת הכרעה':cloud.control?.retry?.lastErrorCode||'';
}
async function syncChecksV2({required=false,quiet=false}={}){
  const account=loadSession()?.user?.id;
  const current=()=>!disposed&&!!account&&loadSession()?.user?.id===account&&tab.primaryTab&&session.backendReady&&session.connectionMode==='supabase'&&isOnline();
  if(!current())return false;
  setCloudHeaderStatus('syncing','ענן: בודק צ׳קים…');
  try{
    const ok=await sharedChecksV2.sync();if(!current())return false;
    const observed=await sharedChecksV2.cloudState();if(!current())return false;
    if(!sharedChecksV2.primaryReady)throw new Error('shared_checks_owner_handoff_required');
    rememberCloud(observed);
    let cloud=observed;
    if(files.backupsDirHandle){await backupSnapshotToComputer(model.state,session.dbRevision);cloud=await sharedChecksV2.cloudState()}
    if(!current())return false;
    if(!sharedChecksV2.primaryReady)throw new Error('shared_checks_owner_handoff_required');
    if(cloud.base?.owner!==observed.base?.owner||cloud.base?.epoch!==observed.base?.epoch)return false;
    const synced=!!ok&&sharedChecksHeadIsSynced(cloud,{checks:model.state.checks,hasLocalWork:sharedChecksV2.hasLocalWork,observedHead:observed});
    if(cloud!==observed)rememberCloud(cloud);
    const conflict=!!cloud.control?.conflict;
    setSaveStatus(synced?'מסונכרן לענן':checksSession.sharedChecksLastError||'צקים ממתינים לסנכרון',conflict?'error':synced?'ok':'saving');
    setCloudHeaderStatus(conflict?'conflict':synced?'synced':'syncing',conflict?'ענן: התנגשות בצ׳קים':synced?'ענן: מסונכרן':'ענן: ממתין לסנכרון');refreshCloudHeaderTimestamp();
    if(!quiet)render();return synced;
  }catch(error){if(current()){checksSession.sharedChecksLastError=error.message;setSaveStatus('בדיקת ענן הצ׳קים נכשלה','error');setCloudHeaderStatus('syncing','ענן: ממתין להתאוששות הצ׳קים');if(!quiet)toast(error.message)}if(required)throw error;return false}
}


async function syncSharedChecksFromCloud({quiet=false,required=false}={}){
  if(disposed)return false;
  if(!sharedChecksV2?.requested){const error=new Error('shared_checks_v2_required');checksSession.sharedChecksLastError=error.message;if(required)throw error;return false}
  return flight.pull(()=>syncChecksV2({quiet,required}));
}

async function saveSharedChecksToCloud(){
  if(disposed)return false;
  if(!sharedChecksV2?.requested){checksSession.sharedChecksLastError='shared_checks_v2_required';return false}
  if(!tab.primaryTab)return false;
  checksSession.sharedChecksSaveRequested=true;
  return flight.save(()=>syncChecksV2());
}

async function pollSharedChecks(){
  if(disposed||!sharedChecksV2?.requested||!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!isOnline()||runtime.isPending())return;
  const before=clone(model.state.checks),synced=await syncSharedChecksFromCloud({quiet:true});
  if(!disposed&&synced&&!jsonEq(before,model.state.checks)){render();refreshCloudHeaderTimestamp()}
}

return {mergeSharedChecks,syncSharedChecksFromCloud,saveSharedChecksToCloud,pollSharedChecks,runtime};
}
