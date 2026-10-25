// @ts-check
import {BANK_AUTO_INTERVAL_MS,CREDIT_AUTO_INTERVAL_MS,financeRefreshDelayMs} from '../../shared/finance-refresh-policy.js';
import {createAutomationPreferences} from './automation-preferences.js';
/** @typedef {import('./automation-preferences.js').FinanceKind} FinanceKind */

// The scheduler owns future provider starts, while a started operation owns its
// independent authorization/commit guard. Stopping never discards a commit.
/** @param {import('../../shared/orders-finance-automation-contracts.js').AutomationPorts} ports */
export function createOrdersFinanceAutomation({access,preferences,readLastSyncAt,commands,onPreferenceFailure=()=>{},timers=globalThis}){
  const accessMethods=/** @type {const} */(['primary','authenticated','online','busy','capture']);
  for(const method of accessMethods)if(typeof access?.[method]!=='function')throw new TypeError(`orders_finance_automation_${method}_required`);
  if(typeof readLastSyncAt!=='function'||typeof commands?.bank!=='function'||typeof commands?.credit!=='function')throw new TypeError('orders_finance_automation_commands_required');
  /** @type {Record<FinanceKind,number|null>} */
  const handles={bank:null,credit:null};
  /** @type {import('../../shared/finance-fence.js').FinanceGuard|null} */
  let guard=null;
  let active=true,disposed=false,epoch=0,readingView=false;
  const preferenceOwner=createAutomationPreferences({preferences,onFailure:(kind,error)=>{clear(kind);if(!readingView)onPreferenceFailure(kind,error)}});
  /** @param {FinanceKind} kind */
  function clear(kind){
    if(handles[kind]!==null){
      timers.clearTimeout(handles[kind]);
      handles[kind]=null;
    }
  }
  function stopAutoSync(){
    active=false;
    epoch++;
    clear('bank');
    clear('credit');
  }
  /** @param {FinanceKind} kind */
  function allowed(kind){
    if(disposed||!active||!access.primary()||!access.authenticated()||!access.online()
      ||!preferenceOwner.tokenConfigured()||!preferenceOwner.eligible(kind)?.enabled)return false;
    try{
      if(!guard)guard=access.capture();
      guard();
      return true;
    }
    catch(error){
      if(!error||typeof error!=='object'||!('code' in error)||error.code!=='FINANCE_OPERATION_SCOPE_CHANGED')throw error;
      stopAutoSync();return false;
    }
  }
  /** @param {unknown} lastSyncAt @param {number} intervalMs */
  function autoWait(lastSyncAt,intervalMs){return Math.max(1000,financeRefreshDelayMs(lastSyncAt,intervalMs)+250)}
  /** @param {FinanceKind} kind */
  function schedule(kind){
    clear(kind);if(!allowed(kind))return;
    const retryWait=preferenceOwner.eligible(kind)?.delay;if(retryWait===undefined)return;
    const wait=Math.max(autoWait(readLastSyncAt(kind),kind==='bank'?BANK_AUTO_INTERVAL_MS:CREDIT_AUTO_INTERVAL_MS),retryWait+250),scheduledEpoch=epoch;
    const handle=timers.setTimeout(()=>{
      if(handles[kind]!==handle||scheduledEpoch!==epoch||!active)return;
      handles[kind]=null;maybeRefresh(kind).catch(error=>console.error(`orders ${kind} auto refresh`,error));
    },wait);handles[kind]=handle;
  }
  /** @param {FinanceKind} kind */
  async function maybeRefresh(kind){
    schedule(kind);if(!allowed(kind)||access.busy()||!preferenceOwner.eligible(kind)?.ready)return false;
    const startedEpoch=epoch;return commands[kind]({interactive:false,auto:true,isCurrent:()=>startedEpoch===epoch});
  }
  function startAutoSync(){
    if(disposed)return false;
    active=true;
    guard=null;
    epoch++;
    schedule('bank');
    schedule('credit');
  }
  // Startup recovery must not revoke the epoch of an in-flight provider
  // operation that the normal cloud-open path has already admitted.
  function resumeAutoSync(){
    if(disposed)return false;
    if(!active)return startAutoSync();
    if(handles.bank===null)schedule('bank');
    if(handles.credit===null)schedule('credit');
    return true;
  }
  function preferenceState(){readingView=true;try{return preferenceOwner.view()}finally{readingView=false}}
  /** @param {FinanceKind} kind @param {boolean} value */
  function setEnabled(kind,value){
    if(disposed)return false;
    const saved=preferenceOwner.setEnabled(kind,value);
    if(saved){
      if(value&&!active)startAutoSync();
      else schedule(kind);
    }
    return saved;
  }
  /** @param {boolean} value */
  function setBankAutoEnabled(value){return setEnabled('bank',value)}
  /** @param {boolean} value */
  function setCreditAutoEnabled(value){return setEnabled('credit',value)}
  /** @param {string} value */
  function setCreditAutoMode(value){
    if(disposed)return false;
    const saved=preferenceOwner.setMode(value);
    if(saved)schedule('credit');
    return saved;
  }
  function dispose(){
    if(disposed)return false;
    disposed=true;
    stopAutoSync();
    return true;
  }
  return {
    startAutoSync,resumeAutoSync,stopAutoSync,dispose,allowed,preferenceState,
    /** @param {FinanceKind} kind */
    markAttempt:kind=>!disposed&&preferenceOwner.markAttempt(kind),
    tokenConfigured:preferenceOwner.tokenConfigured,currentEpoch:()=>epoch,
    scheduleBankAuto:()=>schedule('bank'),scheduleCreditAuto:()=>schedule('credit'),
    maybeAutoRefreshBank:()=>maybeRefresh('bank'),maybeAutoRefreshCredit:()=>maybeRefresh('credit'),
    setBankAutoEnabled,setCreditAutoEnabled,setCreditAutoMode,
  };
}
