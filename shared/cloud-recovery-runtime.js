// @ts-check
import {createRuntimeTaskOwner} from './runtime-task-owner.js';

const DELAYS=[15_000,30_000,60_000,120_000];

/**
 * @param {{isEligible:()=>boolean,run:()=>unknown,onError:(error:unknown)=>void,
 * timers?:{setTimeout:(run:()=>void,delay:number)=>number,clearTimeout:(timer:number)=>void}}} ports
 */
export function createCloudRecoveryRuntime({isEligible,run,onError,timers=globalThis}){
  if(typeof isEligible!=='function'||typeof run!=='function'||typeof onError!=='function')throw new TypeError('cloud_recovery_ports_required');
  const work=createRuntimeTaskOwner();
  /** @type {{timer:number|null}|null} */
  let queued=null;
  let attempt=0;

  function cancel(){
    if(!queued)return false;
    if(queued.timer!==null)timers.clearTimeout(queued.timer);
    queued=null;return true;
  }
  function reset(){const cancelled=cancel();attempt=0;return cancelled}
  function eligible(){try{return work.isActive()&&isEligible()}catch(error){onError(error);return false}}
  function schedule(){
    if(queued||!eligible())return false;
    const delay=DELAYS[attempt]??15_000;attempt=Math.min(attempt+1,DELAYS.length-1);
    const task={timer:/** @type {number|null} */(null)};queued=task;
    try{
      task.timer=timers.setTimeout(()=>{
        if(queued!==task)return;
        queued=null;
        if(eligible())void work.run(run).catch(onError);
      },delay);
    }catch(error){queued=null;onError(error);return false}
    return true;
  }
  function dispose(){const closed=work.close();cancel();return closed}
  return {schedule,cancel,reset,dispose,drain:work.drain,isPending:()=>!!queued||work.isPending()};
}
