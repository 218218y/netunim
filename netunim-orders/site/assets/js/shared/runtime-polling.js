// Owns a recurring wakeup, not the durability operation it invokes. Stop cancels
// queued work; an operation already running is allowed to finish before restart.
export function createPollingTask({run,delay,onError,canRun=()=>true,onState=()=>{},timers=globalThis}){
  if(typeof run!=='function'||typeof delay!=='function'||typeof onError!=='function')throw new Error('polling_task_ports_required');
  let enabled=false,timer=null,running=false,epoch=0,queued=null;
  const publish=()=>onState({enabled,timer});
  function stop(){
    const changed=enabled||timer!==null;
    enabled=false;epoch++;queued=null;
    if(timer!==null)timers.clearTimeout(timer);
    timer=null;publish();return changed;
  }
  function schedule(){
    if(!enabled||running||timer!==null)return;
    if(!canRun()){stop();return}
    const task={epoch};queued=task;
    timer=timers.setTimeout(()=>{
      if(queued!==task||task.epoch!==epoch||!enabled)return;
      queued=null;timer=null;publish();
      if(!canRun()){stop();return}
      running=true;
      // Native timers ignore returned promises. Observe the task here so an
      // unexpected rejection is reported by its owner, including finally work.
      Promise.resolve().then(()=>{if(enabled&&task.epoch===epoch&&canRun())return run()})
        .catch(onError)
        .finally(()=>{running=false;schedule()});
    },delay());
    publish();
  }
  function start(){if(enabled){if(!canRun())stop();return false}enabled=true;publish();schedule();return enabled}
  return {start,stop};
}
