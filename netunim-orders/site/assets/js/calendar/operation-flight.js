// @ts-check
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
/** @typedef {{assertCurrent:()=>void}} FlightAuthority */
/** @typedef {{isCurrent:()=>boolean,release:()=>boolean}} FlightControl */

/**
 * Coalesces only a current authority. Replacing an obsolete flight never loses
 * its accepted work: drain still observes every former and current operation.
 * @template [T=boolean|void]
 * @param {{isObsolete:(error:unknown)=>boolean}} ports
 */
export function createCalendarOperationFlight({isObsolete}){
  const tasks=createRuntimeTaskOwner();
  /** @type {{authority:FlightAuthority,promise:Promise<T|false>}|null} */ let flight=null;
  function current(){
    if(!tasks.isActive()||!flight)return null;
    try{flight.authority.assertCurrent();return flight.promise}catch(error){if(!isObsolete(error))throw error;return null}
  }
  /** @param {FlightAuthority} authority @param {(control:FlightControl)=>T|PromiseLike<T>} work @param {(control:FlightControl)=>void} [settled] @returns {Promise<T|false>} */
  function run(authority,work,settled=()=>{}){
    if(!tasks.isActive())return Promise.resolve(false);
    const pending=current();if(pending)return pending;
    /** @type {{authority:FlightAuthority,promise:Promise<T|false>}} */
    const task={authority,promise:Promise.resolve(/** @type {T|false} */ (false))};flight=task;
    const isCurrent=()=>{if(!tasks.isActive())return false;try{authority.assertCurrent();return true}catch(error){if(!isObsolete(error))throw error;return false}};
    const release=()=>{if(flight!==task)return false;flight=null;return true};
    const control={isCurrent,release};
    // Status ownership must settle even when revocation skips the work body.
    task.promise=tasks.run(()=>Promise.resolve().then(()=>isCurrent()?work(control):false).finally(()=>{try{settled(control)}finally{release()}}));
    return task.promise;
  }
  function dispose(){return tasks.close()}
  return {current,run,dispose,drain:tasks.drain,isPending:tasks.isPending};
}
