import {comparableBackupData} from '../state/serialization.js';
import {clone} from '../core/values.js';
import {stamp} from '../core/dates.js';
import {AUTO_BACKUP_PREFIX, AUTO_BACKUP_KEEP, AUTO_BACKUP_INTERVAL_MS} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBackup({files, writeTextHandle}){
async function latestAutomaticFolderBackup(bdir){let latest=null;for await(const [name,h] of bdir.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();if(!latest||f.lastModified>latest.lastModified)latest={name,handle:h,lastModified:f.lastModified,file:f}}return latest}

async function pruneAutomaticFolderBackups(bdir,max=AUTO_BACKUP_KEEP){const arr=[];for await(const [name,h] of bdir.entries()){if(h.kind!=='file'||!name.startsWith(AUTO_BACKUP_PREFIX)||!name.endsWith('.json'))continue;const f=await h.getFile();arr.push({name,lastModified:f.lastModified})}arr.sort((a,b)=>b.lastModified-a.lastModified);for(const x of arr.slice(max)){try{await bdir.removeEntry(x.name)}catch(e){console.error('backup prune',e)}}}

async function writeVerifiedFolderBackup(bdir,name,payload){const text=JSON.stringify(payload,null,2),h=await bdir.getFileHandle(name,{create:true});await writeTextHandle(h,text);try{const saved=JSON.parse(await (await h.getFile()).text());if(comparableBackupData(saved)!==comparableBackupData(payload))throw new Error('אימות תוכן הגיבוי נכשל')}catch(e){try{await bdir.removeEntry(name)}catch(ignore){}throw e}return name}

function clearPendingAutomaticFolderBackup(){files.pendingAutoBackupPayload=null;if(files.autoBackupTimer){clearTimeout(files.autoBackupTimer);files.autoBackupTimer=null}}

function queueAutomaticFolderBackup(payload,delay){files.pendingAutoBackupPayload=clone(payload);if(files.autoBackupTimer)return;files.autoBackupTimer=setTimeout(async()=>{files.autoBackupTimer=null;const pending=files.pendingAutoBackupPayload;files.pendingAutoBackupPayload=null;if(!pending)return;try{await maybeCreateAutomaticFolderBackup(pending)}catch(e){console.error('scheduled automatic backup',e)}},Math.max(1000,delay))}

async function maybeCreateAutomaticFolderBackup(payload){if(!files.dirHandle||!payload)return null;const bdir=await files.dirHandle.getDirectoryHandle('backups',{create:true}),latest=await latestAutomaticFolderBackup(bdir);let latestPayload=null,latestValid=false;if(latest){try{latestPayload=JSON.parse(await latest.file.text());latestValid=true}catch(e){console.error('backup validation',e)}}if(latestValid&&comparableBackupData(latestPayload)===comparableBackupData(payload)){clearPendingAutomaticFolderBackup();return null}if(latest&&latestValid){const remaining=AUTO_BACKUP_INTERVAL_MS-(Date.now()-latest.lastModified);if(remaining>0){queueAutomaticFolderBackup(payload,remaining);return null}}const name=`${AUTO_BACKUP_PREFIX}${stamp()}.json`;await writeVerifiedFolderBackup(bdir,name,payload);await pruneAutomaticFolderBackups(bdir);clearPendingAutomaticFolderBackup();return name}

return { latestAutomaticFolderBackup, pruneAutomaticFolderBackups, writeVerifiedFolderBackup, clearPendingAutomaticFolderBackup, queueAutomaticFolderBackup, maybeCreateAutomaticFolderBackup };
}
