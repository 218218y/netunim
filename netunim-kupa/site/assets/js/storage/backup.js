import {clone} from '../core/values.js';
import {payloadFromState, comparableBackupPayload} from '../state/serialization.js';
import {DATA_FILE, INITIAL_STATE, BACKUP_PREFIX, AUTO_BACKUP_PREFIX, AUTO_BACKUP_KEEP, AUTO_BACKUP_INTERVAL_MS} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBackup({files, model, session, normalizeState, writeJsonHandle, readJsonHandle}){
async function ensureDirectoryFile(root){const dataDir=await root.getDirectoryHandle('data',{create:true});files.backupRootDirHandle=root;files.backupsDirHandle=await root.getDirectoryHandle('backups',{create:true});let h;try{h=await dataDir.getFileHandle(DATA_FILE)}catch(e){if(e.name!=='NotFoundError')throw e;h=await dataDir.getFileHandle(DATA_FILE,{create:true});await writeJsonHandle(h,payloadFromState(normalizeState(clone(INITIAL_STATE)),1))}return h}

async function listBackups(){const arr=[];if(!files.backupsDirHandle)return arr;try{for await (const [name,h] of files.backupsDirHandle.entries()){if(h.kind==='file'&&name.endsWith('.json')&&name.startsWith(BACKUP_PREFIX)){const f=await h.getFile();arr.push({name,size:f.size,lastModified:f.lastModified})}}}catch(e){}arr.sort((a,b)=>b.lastModified-a.lastModified);return arr}

async function pruneAutomaticBackups(max=AUTO_BACKUP_KEEP){if(!files.backupsDirHandle)return;const arr=[];for await(const [name,h] of files.backupsDirHandle.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();arr.push({name,lastModified:f.lastModified})}arr.sort((a,b)=>b.lastModified-a.lastModified);for(const x of arr.slice(max)){try{await files.backupsDirHandle.removeEntry(x.name)}catch(e){console.error('backup prune',e)}}}

function backupTimestamp(){const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3,'0')}`}

function backupName(label=''){const safe=String(label||'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');return `${BACKUP_PREFIX}${safe?safe+'_':''}${backupTimestamp()}.json`}

async function latestAutomaticBackup(){if(!files.backupsDirHandle)return null;let latest=null;for await(const [name,h] of files.backupsDirHandle.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();if(!latest||f.lastModified>latest.lastModified)latest={name,handle:h,file:f,lastModified:f.lastModified}}return latest}

async function writeVerifiedBackup(name,payload){if(!files.backupsDirHandle||!payload)return null;const h=await files.backupsDirHandle.getFileHandle(name,{create:true});await writeJsonHandle(h,payload);try{const saved=await readJsonHandle(h);if(comparableBackupPayload(saved)!==comparableBackupPayload(payload))throw new Error('אימות תוכן הגיבוי נכשל')}catch(e){try{await files.backupsDirHandle.removeEntry(name)}catch(ignore){}throw e}return name}

async function createManualBackup(payload,label=''){const name=backupName(label);await writeVerifiedBackup(name,payload);return name}

function clearPendingAutomaticBackup(){files.pendingAutoBackupPayload=null;if(files.autoBackupTimer){clearTimeout(files.autoBackupTimer);files.autoBackupTimer=null}}

function queueAutomaticBackup(payload,delay){files.pendingAutoBackupPayload=clone(payload);if(files.autoBackupTimer)return;files.autoBackupTimer=setTimeout(async()=>{files.autoBackupTimer=null;const pending=files.pendingAutoBackupPayload;files.pendingAutoBackupPayload=null;if(!pending)return;try{await maybeCreateAutomaticBackup(pending)}catch(e){console.error('scheduled automatic backup',e)}},Math.max(1000,delay))}

async function maybeCreateAutomaticBackup(payload){if(!files.backupsDirHandle||!payload)return null;const latest=await latestAutomaticBackup();let previous=null,valid=false;if(latest){try{previous=await readJsonHandle(latest.handle);valid=true}catch(e){console.error('backup validation',e)}}if(valid&&comparableBackupPayload(previous)===comparableBackupPayload(payload)){clearPendingAutomaticBackup();return null}if(latest&&valid){const remaining=AUTO_BACKUP_INTERVAL_MS-(Date.now()-latest.lastModified);if(remaining>0){queueAutomaticBackup(payload,remaining);return null}}const name=`${AUTO_BACKUP_PREFIX}${backupTimestamp()}.json`;await writeVerifiedBackup(name,payload);await pruneAutomaticBackups();clearPendingAutomaticBackup();return name}

async function backupSnapshotToComputer(snapshot=model.state,revision=session.dbRevision){if(!files.backupsDirHandle)return null;try{const name=await maybeCreateAutomaticBackup(payloadFromState(clone(snapshot),revision));session.serverInfo.backups=await listBackups();return name}catch(e){console.error('automatic local backup failed',e);return null}}

return { ensureDirectoryFile, listBackups, pruneAutomaticBackups, backupTimestamp, backupName, latestAutomaticBackup, writeVerifiedBackup, createManualBackup, clearPendingAutomaticBackup, queueAutomaticBackup, maybeCreateAutomaticBackup, backupSnapshotToComputer };
}
