// @ts-check

/** @typedef {'bank'|'credit'} FinanceKind */
/** @typedef {{code:'FINANCE_PREFERENCES_UNAVAILABLE'|'FINANCE_PREFERENCES_QUOTA'|'FINANCE_PREFERENCES_INVALID',operation:'read'|'write'}} PreferenceFailure */
/** @typedef {{enabled:boolean,mode:string,delay:number,ready:boolean}} AutomaticPreferences */
/**
 * @typedef {{getBridgeToken:()=>string,bankAutoEnabled:()=>boolean,creditAutoEnabled:()=>boolean,creditAutoMode:()=>string,
 * bankAttemptDelayMs?:()=>number,creditAttemptDelayMs?:()=>number,bankAttemptReady?:()=>boolean,creditAttemptReady?:()=>boolean,
 * markBankAttempt?:()=>void,markCreditAttempt?:()=>void,setBankAutoEnabled?:(value:boolean)=>void,
 * setCreditAutoEnabled?:(value:boolean)=>void,setCreditAutoMode?:(value:string)=>void}} PreferencesPort
 */
/** @template T @typedef {{ok:true,value:T}|{ok:false,error:PreferenceFailure}} PreferenceResult */

export const AUTOMATION_PREFERENCE_WARNING='העדכון האוטומטי הושהה: לא ניתן לאמת או לשמור את ההגדרות במחשב הזה. לאחר תיקון האחסון יש להפעיל אותו מחדש במפורש. השהיה שלא נשמרה עשויה לא לשרוד פתיחה מחדש.';

// These are computer-local permissions/cooldowns, never a Finance outbox. A
// successful read or login cannot silently renew permission after a failed write.
/** @param {{preferences:PreferencesPort,onFailure:(kind:FinanceKind,error:PreferenceFailure)=>undefined}} ports */
export function createAutomationPreferences({preferences,onFailure}){
  /** @type {Record<FinanceKind,PreferenceFailure|null>} */
  const failures={bank:null,credit:null};
  let lastMode='smart';
  /** @param {FinanceKind} kind @param {PreferenceFailure} error */
  function fail(kind,error){const previous=failures[kind];failures[kind]=error;if(previous?.code!==error.code||previous.operation!==error.operation)onFailure(kind,error)}
  /** @template T @param {FinanceKind} kind @param {'read'|'write'} operation @param {()=>T} run @returns {PreferenceResult<T>} */
  function access(kind,operation,run){
    try{return {ok:true,value:run()}}
    catch(error){
      const name=error instanceof Error?error.name:'',code=name==='QuotaExceededError'?'FINANCE_PREFERENCES_QUOTA':name==='FinancePreferencesInvalid'?'FINANCE_PREFERENCES_INVALID':'FINANCE_PREFERENCES_UNAVAILABLE';
      const failure=/** @type {PreferenceFailure} */({code,operation});fail(kind,failure);return {ok:false,error:failure};
    }
  }
  /** @param {FinanceKind} kind @returns {PreferenceResult<AutomaticPreferences>} */
  function read(kind){
    return access(kind,'read',()=>{
      const enabled=kind==='bank'?preferences.bankAutoEnabled():preferences.creditAutoEnabled(),mode=kind==='credit'?preferences.creditAutoMode():'smart',delay=(kind==='bank'?preferences.bankAttemptDelayMs?.():preferences.creditAttemptDelayMs?.())??0;
      const ready=(kind==='bank'?preferences.bankAttemptReady?.():preferences.creditAttemptReady?.())??delay===0;
      if(typeof enabled!=='boolean'||typeof mode!=='string'||!Number.isSafeInteger(delay)||delay<0||typeof ready!=='boolean')throw Object.assign(new Error(),{name:'FinancePreferencesInvalid'});
      if(kind==='credit')lastMode=mode;
      return {enabled,mode,delay,ready};
    });
  }
  /** @param {FinanceKind} kind */
  function eligible(kind){const result=read(kind);return result.ok&&!failures[kind]?result.value:null}
  /** @param {FinanceKind} kind */
  function markAttempt(kind){if(!eligible(kind)?.enabled)return false;return access(kind,'write',()=>{const write=kind==='bank'?preferences.markBankAttempt:preferences.markCreditAttempt;if(!write)throw new Error();write.call(preferences)}).ok}
  /** @param {FinanceKind} kind @param {boolean} value */
  function setEnabled(kind,value){
    const result=access(kind,'write',()=>{const write=kind==='bank'?preferences.setBankAutoEnabled:preferences.setCreditAutoEnabled;if(!write)throw new Error();write.call(preferences,value)});
    if(!result.ok)return false;
    const confirmed=read(kind);if(!confirmed.ok)return false;
    if(confirmed.value.enabled!==value){fail(kind,{operation:'write',code:'FINANCE_PREFERENCES_INVALID'});return false}
    failures[kind]=null;return true;
  }
  /** @param {string} value */
  function setMode(value){return access('credit','write',()=>{if(!preferences.setCreditAutoMode)throw new Error();preferences.setCreditAutoMode(value)}).ok&&read('credit').ok}
  function tokenConfigured(){const result=access('bank','read',()=>!!preferences.getBridgeToken());if(!result.ok){fail('credit',result.error);return false}return result.value}
  function view(){
    const bank=read('bank'),credit=read('credit'),bridgeTokenConfigured=tokenConfigured();
    return {bankAutoEnabled:bank.ok&&!failures.bank&&bank.value.enabled,creditAutoEnabled:credit.ok&&!failures.credit&&credit.value.enabled,creditAutoMode:lastMode,bridgeTokenConfigured,
      bankAutomationWarning:failures.bank?AUTOMATION_PREFERENCE_WARNING:'',bankAutomationWarningCode:failures.bank?.code||'',
      creditAutomationWarning:failures.credit?AUTOMATION_PREFERENCE_WARNING:'',creditAutomationWarningCode:failures.credit?.code||''};
  }
  return {eligible,markAttempt,setEnabled,setMode,tokenConfigured,view};
}
