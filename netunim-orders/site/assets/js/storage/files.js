import {stamp} from '../core/dates.js';
import {comparableBackupData} from '../state/serialization.js';
import {DATA_FILE} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageFiles({files, tab, syncFolderAccessButton, prepareState, writeVerifiedFolderBackup, maybeCreateAutomaticFolderBackup}){
async function writeTextHandle(handle,text){const w=await handle.createWritable();await w.write(text);await w.close()}

async function refreshDirPermission(interactive=false){if(!files.dirHandle){files.dirPermission='missing';files.folderLastError='';syncFolderAccessButton();return false}try{let p=await files.dirHandle.queryPermission({mode:'readwrite'});if(p!=='granted'&&interactive)p=await files.dirHandle.requestPermission({mode:'readwrite'});files.dirPermission=p||'prompt';if(files.dirPermission==='granted')files.folderLastError='';syncFolderAccessButton();return p==='granted'}catch(e){console.error('folder permission',e);files.dirPermission='prompt';files.folderLastError='';syncFolderAccessButton();return false}}

function isFolderPermissionError(e){return ['NotAllowedError','SecurityError'].includes(e?.name)||/הרשא|permission|not allowed/i.test(String(e?.message||''))}

async function localDataDirectory(create=false){if(!files.dirHandle)return null;return await files.dirHandle.getDirectoryHandle('data',{create})}

async function readJsonHandle(handle){try{return JSON.parse(await (await handle.getFile()).text())}catch(e){return null}}

async function findExistingFolderState(){if(!files.dirHandle)return null;try{const d=await localDataDirectory(false),h=await d.getFileHandle(DATA_FILE),payload=await readJsonHandle(h);return payload?{source:'data/'+DATA_FILE,payload}:null}catch(e){if(isFolderPermissionError(e))throw e;return null}}

async function preserveExistingFolderState(){if(files.folderWritePrepared||!files.dirHandle)return;const existing=await findExistingFolderState();if(existing){const incoming=prepareState(),a=comparableBackupData(existing.payload),b=comparableBackupData(incoming);if(a!==b){const bdir=await files.dirHandle.getDirectoryHandle('backups',{create:true});await writeVerifiedFolderBackup(bdir,`orders-backup-before-connect_${stamp()}.json`,existing.payload)}}files.folderWritePrepared=true}

async function writeStateSnapshotToFolder(payload,forceBackup=false){if(!files.dirHandle)return false;if(!(await refreshDirPermission(false))){syncFolderAccessButton();return false}try{await preserveExistingFolderState();const data=JSON.stringify(payload,null,2),ddir=await localDataDirectory(true),fh=await ddir.getFileHandle(DATA_FILE,{create:true});await writeTextHandle(fh,data);const saved=await readJsonHandle(fh);if(!saved||comparableBackupData(saved)!==comparableBackupData(payload))throw new Error('אימות קובץ העבודה המקומי נכשל');const bdir=await files.dirHandle.getDirectoryHandle('backups',{create:true});if(forceBackup)await writeVerifiedFolderBackup(bdir,`orders-backup_${stamp()}.json`,payload);else await maybeCreateAutomaticFolderBackup(payload);files.folderLastError='';syncFolderAccessButton();return true}catch(e){if(isFolderPermissionError(e)){files.dirPermission='prompt';files.folderLastError='';syncFolderAccessButton();return false}files.folderLastError=e.message||String(e);syncFolderAccessButton();console.error('folder write',e);return false}}

async function writeStateToFolder(forceBackup=false){if(!files.dirHandle||!tab.primaryTab)return false;if(files.dirPermission!=='granted'){syncFolderAccessButton();return false}files.folderWritePending=true;files.folderForceBackupPending=files.folderForceBackupPending||forceBackup;if(files.folderWritePromise)return files.folderWritePromise;let lastResult=true;files.folderWritePromise=(async()=>{while(files.folderWritePending){files.folderWritePending=false;const force=files.folderForceBackupPending;files.folderForceBackupPending=false;const payload=prepareState();lastResult=await writeStateSnapshotToFolder(payload,force);if(!lastResult)break}return lastResult})();try{return await files.folderWritePromise}finally{files.folderWritePromise=null;if(files.folderWritePending&&files.dirPermission==='granted')setTimeout(()=>writeStateToFolder(),0)}}

return { writeTextHandle, refreshDirPermission, isFolderPermissionError, localDataDirectory, readJsonHandle, findExistingFolderState, preserveExistingFolderState, writeStateSnapshotToFolder, writeStateToFolder };
}
