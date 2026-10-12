import {createAutomaticBackupRuntime} from '../shared/automatic-backup-runtime.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {comparableBackupData} from '../state/serialization.js';
import {clone} from '../core/values.js';
import {stamp} from '../core/dates.js';
import {AUTO_BACKUP_PREFIX, AUTO_BACKUP_KEEP, AUTO_BACKUP_INTERVAL_MS} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBackup({files, writeTextHandle, timers=globalThis}){
const operations=createRuntimeTaskOwner();
async function latestAutomaticFolderBackup(bdir){let latest=null;for await(const [name,h] of bdir.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();if(!latest||f.lastModified>latest.lastModified)latest={name,handle:h,lastModified:f.lastModified,file:f}}return latest}

async function pruneAutomaticFolderBackups(bdir,max=AUTO_BACKUP_KEEP){const arr=[];for await(const [name,h] of bdir.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();arr.push({name,lastModified:f.lastModified})}arr.sort((a,b)=>b.lastModified-a.lastModified);for(const x of arr.slice(max)){try{await bdir.removeEntry(x.name)}catch(e){console.error('backup prune',e)}}}

async function writeBackupAt(bdir,name,payload){
  const text=JSON.stringify(payload,null,2),handle=await bdir.getFileHandle(name,{create:true});
  await writeTextHandle(handle,text);
  try{
    const saved=JSON.parse(await (await handle.getFile()).text());
    if(comparableBackupData(saved)!==comparableBackupData(payload))throw new Error('אימות תוכן הגיבוי נכשל');
  }catch(error){
    try{await bdir.removeEntry(name)}catch(ignore){}
    throw error;
  }
  return name;
}

function writeVerifiedFolderBackup(bdir,name,payload){
  return operations.isActive()?operations.run(()=>writeBackupAt(bdir,name,clone(payload))):Promise.resolve(null);
}
async function automaticBackup(directory,payload,{defer}){
  const bdir=await directory.getDirectoryHandle('backups',{create:true});
  const latest=await latestAutomaticFolderBackup(bdir);
  let latestPayload=null,latestValid=false;
  if(latest){
    try{latestPayload=JSON.parse(await latest.file.text());latestValid=true}
    catch(error){console.error('backup validation',error)}
  }
  if(latestValid&&comparableBackupData(latestPayload)===comparableBackupData(payload))return null;
  if(latest&&latestValid){
    const remaining=AUTO_BACKUP_INTERVAL_MS-(Date.now()-latest.lastModified);
    if(remaining>0){defer(remaining);return null}
  }
  const name=`${AUTO_BACKUP_PREFIX}${stamp()}.json`;
  await writeBackupAt(bdir,name,payload);
  await pruneAutomaticFolderBackups(bdir);
  return name;
}
const automatic=createAutomaticBackupRuntime({readTarget:()=>files.dirHandle??null,clonePayload:clone,write:automaticBackup,timers,
  onError:error=>console.error('scheduled automatic backup',error)});
const clearPendingAutomaticFolderBackup=automatic.cancelPending,queueAutomaticFolderBackup=automatic.schedule,maybeCreateAutomaticFolderBackup=automatic.submit;
const runtime={cancelPending:automatic.cancelPending,isPending:()=>operations.isPending()||automatic.isPending(),
  async drain(){do{await Promise.all([operations.drain(),automatic.drain()])}while(operations.isPending())},
  dispose(){if(!operations.close())return false;automatic.dispose();return true}};

return { runtime, writeVerifiedFolderBackup, clearPendingAutomaticFolderBackup, queueAutomaticFolderBackup, maybeCreateAutomaticFolderBackup };
}
