// @ts-check

/**
 * @typedef {{localEngineActive:boolean}} PrimaryRecoveryContext
 * @typedef {{primary:(context:PrimaryRecoveryContext)=>Promise<unknown>, readOnly:()=>Promise<unknown>}} StartupJournal
 * @typedef {'unbound'|'bound'|'main'|'shared'|'recovered'|'ready'|'unavailable'|'failed'} RecoveryPhase
 * @typedef {{main:StartupJournal,shared:StartupJournal}} StartupJournals
 * @typedef {{mode:'primary',context:PrimaryRecoveryContext}|{mode:'read-only'}} RecoveryRequest
 * @typedef {{main:unknown,shared:unknown}|false} RecoveryResult
 */

// Main and Shared form one display boundary. Recovery never grants UI access
// itself: lifecycle activates it after installing the remaining startup guards.
// A failed primary recovery cannot be retried in a partially started runtime.
/** @param {{wait?:(delay:number)=>Promise<unknown>}} [ports] */
export function createStorageStartupRecovery({wait=delay=>new Promise(resolve=>setTimeout(resolve,delay))}={}){
  /** @type {StartupJournals|null} */
  let journals=null;
  /** @type {{phase:RecoveryPhase,mode:null|'primary'|'read-only',failedAt:RecoveryPhase|null,error:unknown}} */
  let state={phase:'unbound',mode:null,failedAt:null,error:null};
  /** @type {Promise<RecoveryResult>|null} */
  let task=null;
  if(typeof wait!=='function')throw new TypeError('startup_recovery_wait_required');

  /** @param {StartupJournals} ports */
  function bind({main,shared}){
    if(journals)throw new Error('startup_recovery_already_bound');
    /** @type {Array<[string,StartupJournal]>} */
    const ports=[['main',main],['shared',shared]];
    for(const [name,port] of ports)
      for(const method of /** @type {const} */ (['primary','readOnly']))if(typeof port?.[method]!=='function')throw new TypeError(`startup_recovery_${name}_${method}_required`);
    journals={main,shared};state={...state,phase:'bound'};
  }
  function boundJournals(){if(!journals)throw new Error('startup_recovery_unbound');return journals}
  function assertBound(){boundJournals()}

  /** @param {()=>Promise<unknown>} read */
  async function readOnlyJournal(read){
    for(let attempt=0;attempt<6;attempt++){
      try{const result=await read();if(result)return result}
      catch(error){state={...state,error};if(attempt===5)console.error('secondary read-only recovery',error)}
      if(attempt<5)await wait(60);
    }
    return false;
  }

  /** @param {StartupJournals} bound @param {RecoveryRequest} request @returns {Promise<RecoveryResult>} */
  async function recover(bound,request){
    try{
      state={...state,phase:'main'};
      const main=request.mode==='primary'?await bound.main.primary(request.context):await readOnlyJournal(()=>bound.main.readOnly());
      if(!main){
        if(request.mode==='primary')throw new Error('startup_main_recovery_required');
        state={...state,phase:'unavailable'};return false;
      }
      state={...state,phase:'shared'};
      const shared=request.mode==='primary'?await bound.shared.primary(request.context):await readOnlyJournal(()=>bound.shared.readOnly());
      if(!shared){
        if(request.mode==='primary')throw new Error('startup_shared_recovery_required');
        state={...state,phase:'unavailable'};return false;
      }
      state={...state,phase:'recovered',error:null};
      return {main,shared};
    }catch(error){state={...state,failedAt:state.phase,phase:'failed',error};throw error}
  }

  /** @param {RecoveryRequest} request */
  function start(request){
    const bound=boundJournals();
    if(task){if(state.mode!==request.mode)throw new Error('startup_recovery_mode_changed');return task}
    state={...state,mode:request.mode};task=Promise.resolve().then(()=>recover(bound,request));return task;
  }
  function activate(){
    if(state.phase==='ready')return false;
    if(state.phase!=='recovered')throw new Error('startup_recovery_not_recovered');
    state={...state,phase:'ready'};return true;
  }
  /** @param {PrimaryRecoveryContext} context */
  const primary=context=>start({mode:'primary',context});
  return {bind,assertBound,primary,readOnly:()=>start({mode:'read-only'}),activate,
    isReady:()=>state.phase==='ready',snapshot:()=>Object.freeze({...state})};
}
