// Owns a recurring wakeup, not the durability operation it invokes. Stop cancels
// queued work; an operation already running is allowed to finish before restart.
export function createPollingTask({run,delay,onError,canRun=()=>true,onState=()=>{},timers=globalThis}){
  if(typeof run!=='function'||typeof delay!=='function'||typeof onError!=='function')throw new Error('polling_task_ports_required');
  let enabled=false,timer=null,running=false,epoch=0,queued=null,current=null;
  const publish=()=>onState({enabled,timer});
  function stop(){
    const changed=enabled||timer!==null;
    enabled=false;epoch++;queued=null;
    if(timer!==null)timers.clearTimeout(timer);
    timer=null;publish();return changed;
  }
  function schedule(){
    if(!enabled||running||timer!==null)return;
    if(!allowed())return;
    const task={epoch};queued=task;
    try{
    timer=timers.setTimeout(()=>{
      if(queued!==task||task.epoch!==epoch||!enabled)return;
      queued=null;timer=null;publish();
      if(allowed())execute(task);
    },delay());
    publish();
    }catch(error){stop();onError(error)}
  }
  function allowed(){try{if(canRun())return true;stop()}catch(error){stop();onError(error)}return false}
  function execute(task){
    running=true;
    // Immediate wakeups and timer delivery join one operation. The live receipt
    // fences work not yet started; stopping never aborts an existing commit.
    const isCurrent=()=>enabled&&task.epoch===epoch&&allowed();
    current=Promise.resolve().then(()=>{if(isCurrent())return run({isCurrent})})
      .catch(onError).finally(()=>{running=false;current=null;schedule()});
    return current;
  }
  function start(){if(enabled){allowed();return false}enabled=true;publish();schedule();return enabled}
  function wake(){
    if(!enabled)start();
    if(!enabled||!allowed())return Promise.resolve(false);
    if(running)return current;
    if(timer!==null)timers.clearTimeout(timer);
    timer=null;queued=null;publish();return execute({epoch});
  }
  return {start,stop,wake};
}
