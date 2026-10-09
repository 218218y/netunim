import {createRuntimeResources} from '../../shared/runtime-resources.js';

// This capability owns interruption listeners and one pending recovery wakeup.
// Disposal revokes publication and cancels future work, never a started commit.
export function createMorningLifetime({operationScope,getPendingOperationId,recover,onInterrupt,events=globalThis,timers=globalThis}){
  let disposed=false,timer=null;const resources=createRuntimeResources(),tasks=new Map();
  const scopeChanged=error=>error?.code==='MORNING_OPERATION_SCOPE_CHANGED';
  const observe=error=>{if(!scopeChanged(error))console.error('Morning recovery task',error)};
  if(events.addEventListener&&events.removeEventListener)resources.listen(events,'offline',onInterrupt);
  if(events.document?.addEventListener&&events.document?.removeEventListener)resources.listen(events.document,'visibilitychange',()=>{if(events.document.hidden)onInterrupt()});
  function capture(readOnly=false){
    const assertAuth=readOnly?operationScope.captureRead():operationScope.capture();
    return ()=>{if(disposed)throw Object.assign(new Error('Morning נעצר'),{code:'MORNING_OPERATION_SCOPE_CHANGED'});assertAuth()};
  }
  function scheduleRecovery(delay=60_000,assertCurrent){
    try{assertCurrent??=capture();assertCurrent()}catch{return false}
    const operationId=getPendingOperationId();if(disposed||!operationId)return false;
    if(timer!==null){try{timer.assertCurrent();return false}catch(error){if(!scopeChanged(error))throw error;timers.clearTimeout(timer.id);timer=null}}
    const wake={assertCurrent,id:null};timer=wake;
    wake.id=timers.setTimeout(()=>{
      if(timer!==wake)return;timer=null;
      try{assertCurrent();if(getPendingOperationId()!==operationId)return;Promise.resolve(recover({quiet:true,assertCurrent})).catch(observe)}catch(error){observe(error)}
    },delay);return true;
  }
  function pending(key){
    const task=tasks.get(key);if(!task)return false;
    try{task.assertCurrent();return true}catch(error){if(!scopeChanged(error))throw error;return false}
  }
  function join(key,assertCurrent,work){
    assertCurrent();if(pending(key))return tasks.get(key).promise;
    const task={assertCurrent,promise:null};tasks.set(key,task);
    try{task.promise=Promise.resolve(work())}catch(error){task.promise=Promise.reject(error)}
    task.promise=task.promise.finally(()=>{if(tasks.get(key)===task)tasks.delete(key)});return task.promise;
  }
  function dispose(){if(disposed)return false;disposed=true;resources.dispose();if(timer!==null)timers.clearTimeout(timer.id);timer=null;return true}
  return {capture,scheduleRecovery,pending,join,dispose};
}
