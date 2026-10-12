import {createAutomaticBackupRuntime} from '../shared/automatic-backup-runtime.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {clone} from '../core/values.js';
import {payloadFromState, comparableBackupPayload} from '../state/serialization.js';
import {DATA_FILE, INITIAL_STATE, BACKUP_PREFIX, AUTO_BACKUP_PREFIX, AUTO_BACKUP_KEEP, AUTO_BACKUP_INTERVAL_MS} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBackup({files, model, session, normalizeState, writeJsonHandle, readJsonHandle, timers=globalThis}){
const operations=createRuntimeTaskOwner();
let validatedBackupDirectory=null,validatedBackupAt=0,validatedBackupUntil=0,listedBackupDirectory=null;
async function ensureDirectoryFile(root){const dataDir=await root.getDirectoryHandle('data',{create:true});files.backupRootDirHandle=root;files.backupsDirHandle=await root.getDirectoryHandle('backups',{create:true});let h;try{h=await dataDir.getFileHandle(DATA_FILE)}catch(e){if(e.name!=='NotFoundError')throw e;h=await dataDir.getFileHandle(DATA_FILE,{create:true});await writeJsonHandle(h,payloadFromState(normalizeState(clone(INITIAL_STATE)),1))}return h}

async function listBackups(directory=files.backupsDirHandle){const arr=[];if(!directory)return arr;try{for await (const [name,h] of directory.entries()){if(h.kind==='file'&&name.endsWith('.json')&&name.startsWith(BACKUP_PREFIX)){const f=await h.getFile();arr.push({name,size:f.size,lastModified:f.lastModified})}}}catch(e){}arr.sort((a,b)=>b.lastModified-a.lastModified);return arr}

async function pruneAutomaticBackups(max=AUTO_BACKUP_KEEP,directory=files.backupsDirHandle){if(!directory)return;const arr=[];for await(const [name,h] of directory.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();arr.push({name,lastModified:f.lastModified})}arr.sort((a,b)=>b.lastModified-a.lastModified);for(const x of arr.slice(max)){try{await directory.removeEntry(x.name)}catch(e){console.error('backup prune',e)}}}

function backupTimestamp(){const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3,'0')}`}

function backupName(label=''){const safe=String(label||'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');return `${BACKUP_PREFIX}${safe?safe+'_':''}${backupTimestamp()}.json`}

async function latestAutomaticBackup(directory=files.backupsDirHandle){if(!directory)return null;let latest=null;for await(const [name,h] of directory.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();if(!latest||f.lastModified>latest.lastModified)latest={name,handle:h,file:f,lastModified:f.lastModified}}return latest}

async function writeBackupAt(directory,name,payload){
  if(!directory||!payload)return null;
  const handle=await directory.getFileHandle(name,{create:true});
  await writeJsonHandle(handle,payload);
  try{
    const saved=await readJsonHandle(handle);
    if(comparableBackupPayload(saved)!==comparableBackupPayload(payload))throw new Error('אימות תוכן הגיבוי נכשל');
  }catch(error){
    try{await directory.removeEntry(name)}catch(ignore){}
    throw error;
  }
  return name;
}

function writeVerifiedBackup(name,payload){
  if(!operations.isActive())return Promise.resolve(null);
  const directory=files.backupsDirHandle;
  if(!directory||!payload)return Promise.resolve(null);
  return operations.run(()=>writeBackupAt(directory,name,clone(payload)));
}
function createManualBackup(payload,label=''){return writeVerifiedBackup(backupName(label),payload)}

async function automaticBackup(directory,payload,{defer}){
  const now=Date.now();
  if(validatedBackupDirectory===directory&&now>=validatedBackupAt&&now<validatedBackupUntil){
    defer(validatedBackupUntil-now);return null;
  }
  const latest=await latestAutomaticBackup(directory);
  let previous=null,valid=false;
  if(latest){
    try{
      previous=await readJsonHandle(latest.handle);valid=true;
      validatedBackupDirectory=directory;validatedBackupAt=now;
      validatedBackupUntil=latest.lastModified+AUTO_BACKUP_INTERVAL_MS;
    }catch(error){console.error('backup validation',error)}
  }
  if(valid&&comparableBackupPayload(previous)===comparableBackupPayload(payload))return null;
  if(latest&&valid){
    const remaining=AUTO_BACKUP_INTERVAL_MS-(Date.now()-latest.lastModified);
    if(remaining>0){defer(remaining);return null}
  }
  const name=`${AUTO_BACKUP_PREFIX}${backupTimestamp()}.json`;
  await writeBackupAt(directory,name,payload);
  validatedBackupDirectory=directory;validatedBackupAt=Date.now();
  validatedBackupUntil=validatedBackupAt+AUTO_BACKUP_INTERVAL_MS;
  await pruneAutomaticBackups(AUTO_BACKUP_KEEP,directory);
  return name;
}

const automatic=createAutomaticBackupRuntime({readTarget:()=>files.backupsDirHandle??null,clonePayload:clone,write:automaticBackup,timers,
  onError:error=>console.error('scheduled automatic backup',error)});
const clearPendingAutomaticBackup=automatic.cancelPending,queueAutomaticBackup=automatic.schedule,maybeCreateAutomaticBackup=automatic.submit;
function backupSnapshotToComputer(snapshot=model.state,revision=session.dbRevision){
  if(!operations.isActive()||!files.backupsDirHandle)return Promise.resolve(null);
  const directory=files.backupsDirHandle,payload=payloadFromState(snapshot,revision);
  return operations.run(async()=>{
    try{
      const name=await maybeCreateAutomaticBackup(payload);
      if(operations.isActive()&&files.backupsDirHandle===directory&&(name||listedBackupDirectory!==directory)){
        const catalog=await listBackups(directory);
        if(operations.isActive()&&files.backupsDirHandle===directory){session.serverInfo.backups=catalog;listedBackupDirectory=directory}
      }
      return name;
    }catch(error){console.error('automatic local backup failed',error);return null}
  });
}
const runtime={cancelPending:automatic.cancelPending,isPending:()=>operations.isPending()||automatic.isPending(),
  async drain(){do{await Promise.all([operations.drain(),automatic.drain()])}while(operations.isPending())},
  dispose(){if(!operations.close())return false;automatic.dispose();return true}};

return { runtime, ensureDirectoryFile, listBackups, writeVerifiedBackup, createManualBackup, clearPendingAutomaticBackup, queueAutomaticBackup, maybeCreateAutomaticBackup, backupSnapshotToComputer };
}
