// @ts-check
import {createDebouncedTask} from './debounced-task.js';
import {createRuntimeTaskOwner} from './runtime-task-owner.js';

/** @typedef {{defer:(delay:number)=>boolean}} BackupContinuation */

// An automatic backup owns its captured target and detached snapshot. Pending
// requests replace older wakeups; started file work finishes on its own target.
/**
 * @template {object} Target
 * @template Payload,Result
 * @param {{readTarget:()=>Target|null,clonePayload:(payload:Payload)=>Payload,
 *   write:(target:Target,payload:Payload,continuation:BackupContinuation)=>Promise<Result|null>,
 *   timers?:import('./debounced-task.js').DebounceTimers,onError:(error:unknown)=>void}} ports
 */
export function createAutomaticBackupRuntime({readTarget,clonePayload,write,timers=globalThis,onError}){
  if([readTarget,clonePayload,write,onError].some(port=>typeof port!=='function'))throw new TypeError('automatic_backup_ports_required');
  /** @typedef {{target:Target,payload:Payload,scheduled:boolean,accepted:number}} Job */
  /** @type {Job|null} */
  let latest=null;
  let tail=Promise.resolve();
  const work=createRuntimeTaskOwner();
  const wakeup=createDebouncedTask({delay:1000,timers,onError});
  /** @param {Job} job */
  const current=job=>work.isActive()&&latest===job&&readTarget()===job.target;

  /** @param {Job} job @param {number} delay */
  function defer(job,delay){
    if(!current(job))return false;
    if(!Number.isFinite(delay)||delay<0)throw new TypeError('automatic_backup_delay_required');
    job.scheduled=wakeup.schedule(()=>{job.scheduled=false;return run(job)},Math.min(2_147_483_647,Math.max(1000,delay)));
    return job.scheduled;
  }
  /** @param {Job} job @returns {Promise<Result|null>} */
  function run(job){
    if(!current(job)){
      if(latest===job&&job.accepted===0)latest=null;
      return Promise.resolve(null);
    }
    job.accepted++;
    return work.run(()=>{
      const result=tail.then(()=>current(job)?write(job.target,job.payload,{defer:delay=>defer(job,delay)}):null);
      tail=result.then(()=>{},()=>{});
      return result.finally(()=>{job.accepted--;if(latest===job&&!job.scheduled&&job.accepted===0)latest=null});
    });
  }
  function cancelPending(){
    const existed=latest!==null;
    latest=null;wakeup.cancel();return existed;
  }
  /** @param {Payload} payload @returns {Job|null} */
  function capture(payload){
    if(!work.isActive())return null;
    const target=readTarget();
    if(target===null||payload===null||payload===undefined)return null;
    const job={target,payload:clonePayload(payload),scheduled:false,accepted:0};
    cancelPending();latest=job;return job;
  }
  /** @param {Payload} payload @returns {Promise<Result|null>} */
  function submit(payload){const job=capture(payload);return job?run(job):Promise.resolve(null)}
  /** @param {Payload} payload @param {number} delay */
  function schedule(payload,delay){
    if(!Number.isFinite(delay)||delay<0)throw new TypeError('automatic_backup_delay_required');
    const job=capture(payload);return job?defer(job,delay):false;
  }
  async function drain(){do{await work.drain();await wakeup.drain()}while(work.isPending())}
  function dispose(){if(!work.close())return false;cancelPending();wakeup.dispose();return true}
  return {submit,schedule,cancelPending,drain,dispose,isPending:()=>work.isPending()||wakeup.isPending()};
}
