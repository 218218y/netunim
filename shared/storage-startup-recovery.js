/**
 * @typedef {{localEngineActive:boolean}} PrimaryRecoveryContext
 * @typedef {{primary:(context:PrimaryRecoveryContext)=>Promise<unknown>, readOnly:()=>Promise<unknown>}} StartupJournal
 * @typedef {'unbound'|'bound'|'main'|'shared'|'recovered'|'ready'|'unavailable'|'failed'} RecoveryPhase
 */

// Main and Shared form one display boundary. Recovery never grants UI access
// itself: lifecycle activates it after installing the remaining startup guards.
// A failed primary recovery cannot be retried in a partially started runtime.
export function createStorageStartupRecovery({wait=delay=>new Promise(resolve=>setTimeout(resolve,delay))}={}){
  /** @type {{main:StartupJournal,shared:StartupJournal}|null} */
  let journals=null;
  /** @type {{phase:RecoveryPhase,mode:null|'primary'|'read-only',failedAt:RecoveryPhase|null,error:unknown}} */
  let state={phase:'unbound',mode:null,failedAt:null,error:null};
  let task=null;
  if(typeof wait!=='function')throw new TypeError('startup_recovery_wait_required');

  function bind({main,shared}){
    if(journals)throw new Error('startup_recovery_already_bound');
    for(const [name,port] of [['main',main],['shared',shared]])
      for(const method of ['primary','readOnly'])if(typeof port?.[method]!=='function')throw new TypeError(`startup_recovery_${name}_${method}_required`);
    journals={main,shared};state={...state,phase:'bound'};
  }
  function assertBound(){if(!journals)throw new Error('startup_recovery_unbound')}

  async function readOnlyJournal(read){
    for(let attempt=0;attempt<6;attempt++){
      try{const result=await read();if(result)return result}
      catch(error){state={...state,error};if(attempt===5)console.error('secondary read-only recovery',error)}
      if(attempt<5)await wait(60);
    }
    return false;
  }

  async function recover(mode,context){
    try{
      state={...state,phase:'main'};
      const main=mode==='primary'?await journals.main.primary(context):await readOnlyJournal(()=>journals.main.readOnly());
      if(!main){
        if(mode==='primary')throw new Error('startup_main_recovery_required');
        state={...state,phase:'unavailable'};return false;
      }
      state={...state,phase:'shared'};
      const shared=mode==='primary'?await journals.shared.primary(context):await readOnlyJournal(()=>journals.shared.readOnly());
      if(!shared){
        if(mode==='primary')throw new Error('startup_shared_recovery_required');
        state={...state,phase:'unavailable'};return false;
      }
      state={...state,phase:'recovered',error:null};
      return {main,shared};
    }catch(error){state={...state,failedAt:state.phase,phase:'failed',error};throw error}
  }

  function start(mode,context){
    assertBound();
    if(task){if(state.mode!==mode)throw new Error('startup_recovery_mode_changed');return task}
    state={...state,mode};task=Promise.resolve().then(()=>recover(mode,context));return task;
  }
  function activate(){
    if(state.phase==='ready')return false;
    if(state.phase!=='recovered')throw new Error('startup_recovery_not_recovered');
    state={...state,phase:'ready'};return true;
  }
  return {bind,assertBound,primary:context=>start('primary',context),readOnly:()=>start('read-only'),activate,
    isReady:()=>state.phase==='ready',snapshot:()=>Object.freeze({...state})};
}
