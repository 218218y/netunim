import {createStartupTask} from '../shared/startup-task.js';

// Folder/persistence initialization is optional and runs after first safe render.
// Backup captures the current state only after folder readiness and hydration.
export function createOrdersLocalServices({files,storage,folder,backup,onError=(error,phase)=>console.error(phase,error)}){
  if(!files)throw new TypeError('orders_local_services_files_required');
  for(const [name,port,methods] of [
    ['storage',storage,['requestPersistentBrowserStorage','loadDirHandle']],
    ['folder',folder,['refreshPermission','syncStatus','backupAvailable']],
    ['backup',backup,['capture','save']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`orders_local_services_${name}_${method}_required`);
  let started=false;
  const initialize=createStartupTask(async()=>{
    try{await storage.requestPersistentBrowserStorage()}catch(error){onError(error,'persistent browser storage')}
    try{
      files.dirHandle=await storage.loadDirHandle();
      if(files.dirHandle)await folder.refreshPermission(false);else folder.syncStatus();
    }catch(error){onError(error,'folder startup');folder.syncStatus()}
  });
  function start(){started=true;return initialize()}
  const backupAfterHydration=createStartupTask(async()=>{
    if(!started)throw new Error('orders_local_services_not_started');
    try{await initialize()}catch(error){onError(error,'local services startup')}
    try{if(folder.backupAvailable())await backup.save(backup.capture())}
    catch(error){onError(error,'automatic folder backup')}
  });
  return {start,backupAfterHydration};
}
