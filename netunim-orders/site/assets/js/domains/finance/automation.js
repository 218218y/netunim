import {BANK_AUTO_INTERVAL_MS,CREDIT_AUTO_INTERVAL_MS} from '../../shared/finance-refresh-policy.js';
import {createAutomationPreferences} from './automation-preferences.js';

// The scheduler owns future provider starts, while a started operation owns its
// independent authorization/commit guard. Stopping never discards a commit.
export function createOrdersFinanceAutomation({access,preferences,readLastSyncAt,commands,onPreferenceFailure=()=>{},timers=globalThis}){
  for(const method of ['primary','authenticated','online','busy','capture'])if(typeof access?.[method]!=='function')throw new TypeError(`orders_finance_automation_${method}_required`);
  if(typeof readLastSyncAt!=='function'||typeof commands?.bank!=='function'||typeof commands?.credit!=='function')throw new TypeError('orders_finance_automation_commands_required');
  const handles={bank:null,credit:null};
  let active=true,guard=null,epoch=0,readingView=false;
  const preferenceOwner=createAutomationPreferences({preferences,onFailure:(kind,error)=>{clear(kind);if(!readingView)onPreferenceFailure(kind,error)}});
  function clear(kind){if(handles[kind]!==null){timers.clearTimeout(handles[kind]);handles[kind]=null}}
  function stopAutoSync(){active=false;epoch++;clear('bank');clear('credit')}
  function allowed(kind){
    if(!active||!access.primary()||!access.authenticated()||!access.online()||!preferenceOwner.tokenConfigured()||!preferenceOwner.eligible(kind)?.enabled)return false;
    try{if(!guard)guard=access.capture();guard();return true}catch(error){if(error?.code!=='FINANCE_OPERATION_SCOPE_CHANGED')throw error;stopAutoSync();return false}
  }
  function autoWait(lastSyncAt,intervalMs){const time=lastSyncAt?Date.parse(lastSyncAt):NaN;return Number.isFinite(time)?Math.max(1000,time+intervalMs-Date.now()+250):1000}
  function schedule(kind){
    clear(kind);if(!allowed(kind))return;
    const retryWait=preferenceOwner.eligible(kind)?.delay;if(retryWait===undefined)return;
    const wait=Math.max(autoWait(readLastSyncAt(kind),kind==='bank'?BANK_AUTO_INTERVAL_MS:CREDIT_AUTO_INTERVAL_MS),retryWait+250),scheduledEpoch=epoch;
    const handle=timers.setTimeout(()=>{
      if(handles[kind]!==handle||scheduledEpoch!==epoch||!active)return;
      handles[kind]=null;maybeRefresh(kind).catch(error=>console.error(`orders ${kind} auto refresh`,error));
    },wait);handles[kind]=handle;
  }
  async function maybeRefresh(kind){
    schedule(kind);if(!allowed(kind)||access.busy()||!preferenceOwner.eligible(kind)?.ready)return false;
    const startedEpoch=epoch;return commands[kind]({interactive:false,auto:true,isCurrent:()=>startedEpoch===epoch});
  }
  function startAutoSync(){active=true;guard=null;epoch++;schedule('bank');schedule('credit')}
  function preferenceState(){readingView=true;try{return preferenceOwner.view()}finally{readingView=false}}
  function setEnabled(kind,value){const saved=preferenceOwner.setEnabled(kind,value);if(saved){if(value&&!active)startAutoSync();else schedule(kind)}return saved}
  function setBankAutoEnabled(value){return setEnabled('bank',value)}
  function setCreditAutoEnabled(value){return setEnabled('credit',value)}
  function setCreditAutoMode(value){const saved=preferenceOwner.setMode(value);if(saved)schedule('credit');return saved}
  return {startAutoSync,stopAutoSync,allowed,preferenceState,markAttempt:preferenceOwner.markAttempt,tokenConfigured:preferenceOwner.tokenConfigured,currentEpoch:()=>epoch,scheduleBankAuto:()=>schedule('bank'),scheduleCreditAuto:()=>schedule('credit'),maybeAutoRefreshBank:()=>maybeRefresh('bank'),maybeAutoRefreshCredit:()=>maybeRefresh('credit'),setBankAutoEnabled,setCreditAutoEnabled,setCreditAutoMode};
}
