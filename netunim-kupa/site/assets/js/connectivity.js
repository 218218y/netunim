import {createRuntimeResources} from './shared/runtime-resources.js';

export function createKupaConnectivityRuntime({tab,session,syncDocument,bank,credit,status,environment=globalThis,timers=globalThis}){
  if(!tab||!session)throw new TypeError('kupa_connectivity_context_required');
  for(const [name,port,methods] of [
    ['cloud',syncDocument,['resumeAfterReconnect','cloudPoll']],
    ['bank',bank,['maybeAutoRefreshBankBalance']],
    ['credit',credit,['maybeAutoRefreshCreditSync']],
    ['status',status,['setSaveStatus','setCloudHeaderStatus']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`kupa_connectivity_${name}_${method}_required`);
  const {window,document,navigator}=environment;
  const resources=createRuntimeResources({timers});
  let started=false,disposed=false;
  const allowed=()=>tab.primaryTab&&!session.storageProtocolBlocked;
  const cloudReady=()=>allowed()&&navigator.onLine!==false&&session.connectionMode==='supabase';

  function refreshFinance(){
    resources.schedule('finance',0,()=>{
      if(!allowed()||navigator.onLine===false)return;
      bank.maybeAutoRefreshBankBalance();
      return credit.maybeAutoRefreshCreditSync();
    });
  }

  function online(){
    if(!allowed())return;
    if(session.connectionMode==='supabase')resources.schedule('reconnect',250,()=>{if(cloudReady())return syncDocument.resumeAfterReconnect()});
    refreshFinance();
  }

  function offline(){
    for(const key of ['reconnect','poll','finance'])resources.cancel(key);
    if(!allowed()||session.connectionMode!=='supabase')return;
    status.setSaveStatus('אופליין — שינויים יישמרו מקומית','saving');
    status.setCloudHeaderStatus('offline','ענן: אופליין');
  }

  function visibility(){
    if(document.hidden){resources.cancel('poll');resources.cancel('finance');return}
    if(!allowed())return;
    if(session.connectionMode==='supabase')resources.schedule('poll',100,()=>{if(!document.hidden&&cloudReady())return syncDocument.cloudPoll()});
    refreshFinance();
  }

  function start(){
    if(disposed)throw new Error('kupa_connectivity_disposed');
    if(started)return false;
    resources.listen(window,'online',online);
    resources.listen(window,'offline',offline);
    resources.listen(document,'visibilitychange',visibility);
    started=true;
    return true;
  }

  function dispose(){disposed=true;return resources.dispose()}
  return {start,dispose};
}
