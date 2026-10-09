// @ts-check

/**
 * @typedef {'smart'|'quick'|'forecast'|'recovery'} CreditAutoMode
 * @typedef {{getItem:(key:string)=>string|null,setItem:(key:string,value:string)=>void,removeItem:(key:string)=>void}} PreferencesStorage
 * @typedef {{code:'CREDIT_PREFERENCES_UNAVAILABLE'|'CREDIT_PREFERENCES_QUOTA'|'CREDIT_PREFERENCES_INVALID',operation:'read'|'write'}} PreferenceFailure
 * @typedef {{enabled:boolean,mode:string|null,attemptAt:number}} CreditPreferences
 */
/**
 * @template T
 * @typedef {{ok:true,value:T}|{ok:false,error:PreferenceFailure}} PreferenceResult
 */

// Historical computer-local keys, outside Finance and Main/Shared journals.
// Construction never touches storage.
const ENABLED='netunim_kupa_credit_auto_daily_v1';
const MODE='netunim_kupa_credit_auto_mode_v1';
const ATTEMPT='netunim_kupa_credit_auto_attempt_v1';
const MODES=new Set(['smart','quick','forecast','recovery']);

/** @param {{storage?:PreferencesStorage,now?:()=>number}} [ports] */
export function createCreditPreferences({storage={
  getItem:key=>globalThis.localStorage.getItem(key),
  setItem:(key,value)=>globalThis.localStorage.setItem(key,value),
  removeItem:key=>globalThis.localStorage.removeItem(key),
},now=()=>Date.now()}={}){
  /**
   * @template T
   * @param {'read'|'write'} operation
   * @param {()=>T} run
   * @returns {PreferenceResult<T>}
   */
  function access(operation,run){
    try{return {ok:true,value:run()}}
    catch(error){return {ok:false,error:{operation,code:error instanceof Error&&error.name==='QuotaExceededError'?'CREDIT_PREFERENCES_QUOTA':'CREDIT_PREFERENCES_UNAVAILABLE'}}}
  }
  /** @returns {PreferenceResult<CreditPreferences>} */
  function read(){
    const result=access('read',()=>({enabled:storage.getItem(ENABLED)!=='0',mode:storage.getItem(MODE),attemptAt:Number(storage.getItem(ATTEMPT)||0)}));
    if(result.ok&&(!Number.isSafeInteger(result.value.attemptAt)||result.value.attemptAt<0))return {ok:false,error:{operation:'read',code:'CREDIT_PREFERENCES_INVALID'}};
    return result;
  }
  /** @param {boolean} enabled */
  function setEnabled(enabled){return access('write',()=>storage.setItem(ENABLED,enabled?'1':'0'))}
  /** @param {CreditAutoMode} mode */
  function setMode(mode){
    if(!MODES.has(mode))return /** @type {PreferenceResult<void>} */ ({ok:false,error:{operation:'write',code:'CREDIT_PREFERENCES_INVALID'}});
    return access('write',()=>storage.setItem(MODE,mode));
  }
  function markAttempt(){
    const at=now();
    if(!Number.isSafeInteger(at)||at<0)return /** @type {PreferenceResult<void>} */ ({ok:false,error:{operation:'write',code:'CREDIT_PREFERENCES_INVALID'}});
    return access('write',()=>storage.setItem(ATTEMPT,String(at)));
  }
  // localStorage has no multi-key transaction. Partial reset is unsuccessful;
  // disable is written first, and no historical key is renamed.
  function reset(){return access('write',()=>{storage.setItem(ENABLED,'0');storage.setItem(MODE,'smart');storage.removeItem(ATTEMPT)})}
  return {read,setEnabled,setMode,markAttempt,reset};
}
