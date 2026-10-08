import {createStartupTask} from '../shared/startup-task.js';

// Owns the connection screen's four registrations. Adapters retain their own
// interaction/ownership guards. Disposing bindings never cancels a started save.
export function createKupaConnectionStartup({events,actions,presentation,access}){
  for(const [name,port,methods] of [
    ['events',events,['listen','dispose']],
    ['actions',actions,['chooseFolder','chooseDataFile','openLastFolder','openCloud']],
    ['presentation',presentation,['tryAutoOpenRemembered','showFirstRun']],
    ['access',access,['allowed']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`kupa_connection_${name}_${method}_required`);
  let disposed=false;
  const bind=createStartupTask(()=>{
    if(disposed)throw new Error('kupa_connection_disposed');
    for(const [element,action] of [['chooseFolder','chooseFolder'],['chooseDataFile','chooseDataFile'],['openLastFolder','openLastFolder'],['openCloud','openCloud']])
      events.listen(element,(...args)=>{if(!disposed)return actions[action](...args)});
  });
  const openLocal=createStartupTask(async()=>{
    if(disposed)throw new Error('kupa_connection_disposed');
    if(!access.allowed())return false;
    const opened=await presentation.tryAutoOpenRemembered();
    if(!opened&&!disposed&&access.allowed())presentation.showFirstRun();
    return !!opened;
  });
  function dispose(){if(disposed)return false;disposed=true;events.dispose();return true}
  return {bind,openLocal,dispose};
}
