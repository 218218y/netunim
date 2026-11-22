import {createStartupTask} from '../shared/startup-task.js';

// Folder/persistence initialization is optional and runs after first safe render.
// Backup captures the current state only after folder readiness and hydration.
export function createOrdersLocalServices({files,storage,folder,backup,canBackup=()=>true,onError=(error,phase)=>console.error(phase,error)}){
  if(!files)throw new TypeError('orders_local_services_files_required');
  for(const [name,port,methods] of [
    ['storage',storage,['requestPersistentBrowserStorage','loadDirHandle']],
    ['folder',folder,['refreshPermission','syncStatus','backupAvailable']],
    ['backup',backup,['capture','save']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`orders_local_services_${name}_${method}_required`);
  let started=false;
  async function requestPersistence(){
    try{await storage.requestPersistentBrowserStorage()}catch(error){onError(error,'persistent browser storage')}
  }
  const restoreFolder=createStartupTask(async()=>{
    let handle=null;
    try{
      handle=await storage.loadDirHandle();
      if(files.dirHandle)return;
      files.dirHandle=handle;
      if(handle)await folder.refreshPermission(false);
      else{files.dirPermission='missing';folder.syncStatus()}
    }catch(error){
      onError(error,'folder startup');
      if(!files.dirHandle||files.dirHandle===handle){
        files.dirPermission=files.dirHandle?'prompt':'missing';folder.syncStatus();
      }
    }
  });
  const initialize=createStartupTask(async()=>{await Promise.all([requestPersistence(),restoreFolder()])});
  function start(){started=true;return initialize()}
  const backupAfterHydration=createStartupTask(async()=>{
    if(!started)throw new Error('orders_local_services_not_started');
    await restoreFolder();
    try{if(canBackup()&&folder.backupAvailable())await backup.save(backup.capture())}
    catch(error){onError(error,'automatic folder backup')}
  });
  return {start,backupAfterHydration};
}
