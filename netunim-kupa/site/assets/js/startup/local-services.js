import {createStartupTask} from '../shared/startup-task.js';

// Only optional browser persistence and backup-target initialization belong
// here. Main/Shared recovery errors must never cross this failure boundary.
export function createKupaLocalServices({storage,backup,onError=(error,phase)=>console.error(phase,error)}){
  for(const [name,port,method] of [
    ['storage',storage,'requestPersistentBrowserStorage'],['backup',backup,'restoreTarget'],
  ])if(typeof port?.[method]!=='function')throw new TypeError(`kupa_local_services_${name}_${method}_required`);
  async function optional(run,phase){try{await run()}catch(error){onError(error,phase)}}
  const start=createStartupTask(()=>Promise.all([
    optional(()=>storage.requestPersistentBrowserStorage(),'persistent browser storage'),
    optional(()=>backup.restoreTarget(),'backup target startup'),
  ]));
  return {start};
}
