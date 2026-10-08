// Owns only these event registrations and wakeup tasks. Disposing never aborts
// a durability operation that has already started inside a capability.
export function createRuntimeResources({timers=globalThis,onError=(error,key)=>console.error('runtime wakeup',key,error)}={}){
  const listeners=[],tasks=new Map();
  let disposed=false;

  function listen(target,event,handler,options){
    if(disposed)throw new Error('runtime_resources_disposed');
    target.addEventListener(event,handler,options);
    listeners.push(()=>target.removeEventListener(event,handler,options));
  }

  function schedule(key,delay,run){
    if(disposed||tasks.has(key))return false;
    const task={timer:null,running:false};
    tasks.set(key,task);
    task.timer=timers.setTimeout(()=>{
      task.timer=null;
      if(disposed||tasks.get(key)!==task)return;
      task.running=true;
      Promise.resolve().then(()=>{if(!disposed)return run()})
        .catch(error=>onError(error,key))
        .finally(()=>{if(tasks.get(key)===task)tasks.delete(key)});
    },delay);
    return true;
  }

  function cancel(key){
    const task=tasks.get(key);
    if(!task||task.running)return false;
    timers.clearTimeout(task.timer);
    tasks.delete(key);
    return true;
  }

  function dispose(){
    if(disposed)return false;
    disposed=true;
    for(const remove of listeners)remove();
    listeners.length=0;
    for(const key of tasks.keys())cancel(key);
    return true;
  }

  return {listen,schedule,cancel,dispose};
}
