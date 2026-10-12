import {stamp} from '../core/dates.js';
import {comparableBackupData} from '../state/serialization.js';
import {DATA_FILE} from '../state/constants.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {createFolderWriteRuntime} from './folder-write-runtime.js';

// Native I/O stays at this boundary. The private selection owns preparation;
// every command captures that selection and its detached input at submission.
export function createStorageFiles({files,tab,syncFolderAccessButton,prepareState,writeVerifiedFolderBackup,maybeCreateAutomaticFolderBackup,canWrite=()=>tab.primaryTab}){
  const permissions=createRuntimeTaskOwner();
  let selection=null,active=true,generation=0;
  function readTarget(){
    if(selection?.handle!==files.dirHandle)selection=files.dirHandle?{handle:files.dirHandle,prepared:false}:null;
    return selection;
  }
  const isCurrent=target=>active&&readTarget()===target;
  function selectDirectory(handle){
    if(!active)return false;
    cancelPending();files.dirHandle=handle;
    selection=handle?{handle,prepared:false}:null;
    files.dirPermission=handle?'unknown':'missing';files.folderLastError='';
    syncFolderAccessButton();return true;
  }
  // UI callers retain this identity across awaits, including reselection of the
  // same native handle. It exposes no timer, queue or preparation state.
  const captureSelection=()=>{const target=readTarget(),captured=generation;return ()=>!!target&&captured===generation&&isCurrent(target)&&canWrite()};
  async function writeTextHandle(handle,text){
    const stream=await handle.createWritable();await stream.write(text);await stream.close();
  }
  async function permissionAt(target,interactive){
    const captured=generation,current=()=>captured===generation&&isCurrent(target);
    if(!target){
      if(current()){files.dirPermission='missing';files.folderLastError='';syncFolderAccessButton()}
      return false;
    }
    try{
      let permission=await target.handle.queryPermission({mode:'readwrite'});
      if(!current())return false;
      if(permission!=='granted'&&interactive){
        if(!canWrite())return false;
        permission=await target.handle.requestPermission({mode:'readwrite'});
      }
      if(!current())return false;
      files.dirPermission=permission||'prompt';
      if(permission==='granted')files.folderLastError='';
      syncFolderAccessButton();return permission==='granted';
    }catch(error){
      if(current()){files.dirPermission='prompt';files.folderLastError='';syncFolderAccessButton();console.error('folder permission',error)}
      return false;
    }
  }
  function refreshDirPermission(interactive=false){
    if(!active)return Promise.resolve(false);
    const target=readTarget();return permissions.run(()=>permissionAt(target,interactive));
  }
  function isFolderPermissionError(error){
    return ['NotAllowedError','SecurityError'].includes(error?.name)||/הרשא|permission|not allowed/i.test(String(error?.message||''));
  }
  async function readJsonHandle(handle){
    try{return JSON.parse(await (await handle.getFile()).text())}catch{return null}
  }
  async function findExistingFolderState(target){
    try{
      const dir=await target.handle.getDirectoryHandle('data'),handle=await dir.getFileHandle(DATA_FILE);
      const payload=await readJsonHandle(handle);return payload?{source:'data/'+DATA_FILE,payload}:null;
    }catch(error){if(isFolderPermissionError(error))throw error;return null}
  }
  async function preserveAt(target,incoming,scope){
    if(target.prepared)return scope.begin();
    const existing=await findExistingFolderState(target);
    if(!scope.begin())return false;
    if(existing&&comparableBackupData(existing.payload)!==comparableBackupData(incoming)){
      const dir=await target.handle.getDirectoryHandle('backups',{create:true});
      await writeVerifiedFolderBackup(dir,`orders-backup-before-connect_${stamp()}.json`,existing.payload);
    }
    target.prepared=true;return true;
  }
  async function writeAt(target,payload,command,scope){
    if(!(await permissionAt(target,false))||!scope.isCurrent())return false;
    try{
      if(!(await preserveAt(target,payload,scope)))return false;
      if(command.kind==='preserve')return true;
      const dir=await target.handle.getDirectoryHandle('data',{create:true});
      const handle=await dir.getFileHandle(DATA_FILE,{create:true});
      await writeTextHandle(handle,JSON.stringify(payload,null,2));
      const saved=await readJsonHandle(handle);
      if(!saved||comparableBackupData(saved)!==comparableBackupData(payload))throw new Error('אימות קובץ העבודה המקומי נכשל');
      if(command.forceBackup){
        const backups=await target.handle.getDirectoryHandle('backups',{create:true});
        await writeVerifiedFolderBackup(backups,`orders-backup_${stamp()}.json`,payload);
      }else if(scope.isCurrent())await maybeCreateAutomaticFolderBackup(payload);
      if(scope.isCurrent()){files.folderLastError='';syncFolderAccessButton()}
      return true;
    }catch(error){
      if(scope.isCurrent()){
        if(isFolderPermissionError(error)){files.dirPermission='prompt';files.folderLastError=''}
        else{files.folderLastError=error.message||String(error);console.error('folder write',error)}
        syncFolderAccessButton();
      }
      return false;
    }
  }
  const writer=createFolderWriteRuntime({readTarget,clonePayload:payload=>structuredClone(payload),canStart:()=>active&&canWrite(),write:writeAt,onError:error=>console.error('folder writer',error)});
  const preserveExistingFolderState=()=>writer.preserve(prepareState());
  const writeStateSnapshotToFolder=(payload,forceBackup=false)=>writer.snapshot(payload,forceBackup);
  function writeStateToFolder(forceBackup=false){
    if(!active||!canWrite()||!files.dirHandle)return Promise.resolve(false);
    if(files.dirPermission!=='granted'){syncFolderAccessButton();return Promise.resolve(false)}
    return writer.mirror(prepareState(),forceBackup);
  }
  function cancelPending(){generation++;writer.cancelPending()}
  const runtime={
    cancelPending,
    drain:async()=>{await Promise.all([writer.drain(),permissions.drain()])},
    dispose:()=>{if(!active)return false;active=false;writer.dispose();permissions.close();return true},
    isPending:()=>writer.isPending()||permissions.isPending(),
  };
  return {writeTextHandle,refreshDirPermission,isFolderPermissionError,preserveExistingFolderState,writeStateSnapshotToFolder,writeStateToFolder,selectDirectory,captureSelection,runtime};
}
