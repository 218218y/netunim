// @ts-check
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
/** @typedef {import('../../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */
/** @typedef {import('../../core/morning-operation-scope.js').MorningOperationScope} MorningOperationScope */
/** @typedef {Partial<Pick<EventTarget,'addEventListener'|'removeEventListener'>> & {document?:Partial<Pick<Document,'addEventListener'|'removeEventListener'|'hidden'>>}} MorningEvents */
/** @typedef {{setTimeout:(run:()=>void,delay:number)=>number,clearTimeout:(id:number)=>void}} MorningTimers */
/** @typedef {{assertCurrent:MorningAssertion,promise:Promise<unknown>}} MorningTask */
/** @typedef {{operationId:string,assertCurrent:MorningAssertion,id:number|null}} RecoveryWake */
/** @typedef {{
 * capture:(readOnly?:boolean)=>MorningAssertion,
 * scheduleRecovery:(delay?:number,assertCurrent?:MorningAssertion)=>boolean,
 * pending:(key:string)=>boolean,
 * join:<T>(key:string,assertCurrent:MorningAssertion,work:()=>T|PromiseLike<T>)=>Promise<T>,
 * run:<T>(work:()=>T|PromiseLike<T>)=>Promise<T>,
 * cancelPending:()=>void,dispose:()=>boolean,drain:()=>Promise<void>,isPending:()=>boolean
 * }} MorningLifetime */
/** @param {unknown} error */
function scopeChanged(error){return error!==null&&typeof error==='object'&&'code' in error&&error.code==='MORNING_OPERATION_SCOPE_CHANGED'}

/**
 * Current flights coalesce, while the accepted-work owner retains superseded
 * flights and delivered wakes until drain. Disposal revokes future authority,
 * cancels queued wakes/listeners and never aborts an already started commit.
 * @param {{
 * operationScope:MorningOperationScope,
 * getPendingOperationId:()=>string|null|undefined,
 * recover:(options:{quiet:boolean,assertCurrent:MorningAssertion})=>unknown,
 * onInterrupt:()=>void,events?:MorningEvents,timers?:MorningTimers
 * }} ports
 * @returns {MorningLifetime}
 */
export function createMorningLifetime({operationScope,getPendingOperationId,recover,onInterrupt,events=globalThis,timers=globalThis}){
  let disposed=false;
  /** @type {RecoveryWake|null} */ let timer=null;
  /** @type {Map<string,MorningTask>} */ const tasks=new Map();
  /** @type {Array<()=>void>} */ const listeners=[];
  const accepted=createRuntimeTaskOwner();
  const observe=/** @param {unknown} error */ error=>{if(!scopeChanged(error))console.error('Morning recovery task',error)};
  function assertActive(){if(disposed)throw Object.assign(new Error('Morning נעצר'),{code:'MORNING_OPERATION_SCOPE_CHANGED'})}
  /** @param {MorningEvents} target @param {string} name @param {()=>void} run */
  function listen(target,name,run){
    if(!target.addEventListener||!target.removeEventListener)return;
    const handler=()=>{if(!disposed)run()};target.addEventListener(name,handler);
    listeners.push(()=>target.removeEventListener?.(name,handler));
  }
  try{listen(events,'offline',onInterrupt);if(events.document)listen(events.document,'visibilitychange',()=>{if(events.document?.hidden)onInterrupt()})}
  catch(error){for(const stop of listeners)stop();throw error}
  /** @param {boolean} [readOnly] @returns {MorningAssertion} */
  function capture(readOnly=false){
    assertActive();const assertAuth=readOnly?operationScope.captureRead():operationScope.capture();
    return ()=>{assertActive();assertAuth()};
  }
  function cancelPending(){if(timer?.id!==null&&timer?.id!==undefined)timers.clearTimeout(timer.id);timer=null}
  /** @param {number} [delay] @param {MorningAssertion} [assertCurrent] */
  function scheduleRecovery(delay=60_000,assertCurrent){
    try{assertActive();assertCurrent??=capture();assertCurrent()}catch{return false}
    const operationId=getPendingOperationId();if(!operationId)return false;
    if(timer!==null){
      try{timer.assertCurrent();if(timer.operationId===operationId)return false}catch(error){if(!scopeChanged(error))throw error}
      cancelPending();
    }
    const guard=assertCurrent;
    /** @type {RecoveryWake} */ const wake={operationId,assertCurrent:guard,id:null};timer=wake;
    wake.id=timers.setTimeout(()=>{
      if(disposed||timer!==wake)return;timer=null;
      try{guard();if(getPendingOperationId()!==operationId)return;void accepted.run(()=>recover({quiet:true,assertCurrent:guard})).catch(observe)}catch(error){observe(error)}
    },delay);return true;
  }
  /** @param {string} key */
  function pending(key){
    const task=tasks.get(key);if(disposed||!task)return false;
    try{task.assertCurrent();return true}catch(error){if(!scopeChanged(error))throw error;return false}
  }
  /** Each named flight has one caller-defined result type. Replacements retain
   * accepted completion independently of the current-flight map.
   * @template T @param {string} key @param {MorningAssertion} assertCurrent
   * @param {()=>T|PromiseLike<T>} work @returns {Promise<T>}
   */
  function join(key,assertCurrent,work){
    assertActive();assertCurrent();
    if(pending(key))return /** @type {Promise<T>} */ (tasks.get(key)?.promise);
    /** @type {MorningTask} */ const task={assertCurrent,promise:Promise.resolve()};tasks.set(key,task);
    const promise=accepted.run(()=>{try{return work()}catch(error){return Promise.reject(error)}})
      .finally(()=>{if(tasks.get(key)===task)tasks.delete(key)});
    task.promise=promise;return promise;
  }
  /** @template T @param {()=>T|PromiseLike<T>} work @returns {Promise<T>} */
  function run(work){assertActive();return accepted.run(work)}
  function dispose(){if(disposed)return false;disposed=true;accepted.close();cancelPending();for(const stop of listeners.splice(0))stop();return true}
  return {capture,scheduleRecovery,pending,join,run,cancelPending,dispose,drain:accepted.drain,isPending:accepted.isPending};
}
