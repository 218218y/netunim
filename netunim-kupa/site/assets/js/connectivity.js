import {createRuntimeResources} from './shared/runtime-resources.js';

export function createKupaConnectivityRuntime({access,cloud,bank,credit,status,environment=globalThis,timers=globalThis}){
  for(const [name,port,methods] of [
    ['access',access,['primary','blocked']],
    ['cloud',cloud,['connected','resumeAfterReconnect','cloudPoll']],
    ['bank',bank,['startAutoSync','stopAutoSync']],
    ['credit',credit,['startAutoSync','stopAutoSync']],
    ['status',status,['setSaveStatus','setCloudHeaderStatus']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`kupa_connectivity_${name}_${method}_required`);
  const {window,document,navigator}=environment;
  const resources=createRuntimeResources({timers});
  let started=false,disposed=false;
  const allowed=()=>access.primary()&&!access.blocked();
  const cloudReady=()=>allowed()&&navigator.onLine!==false&&cloud.connected();

  function refreshFinance(){
    resources.schedule('finance',0,()=>{
      if(!allowed()||navigator.onLine===false)return;
      bank.startAutoSync();
      return credit.startAutoSync();
    });
  }

  function online(){
    if(!allowed())return;
    if(cloud.connected())resources.schedule('reconnect',250,()=>{if(cloudReady())return cloud.resumeAfterReconnect()});
    refreshFinance();
  }

  function offline(){
    for(const key of ['reconnect','poll','finance'])resources.cancel(key);
    bank.stopAutoSync();credit.stopAutoSync();
    if(!allowed()||!cloud.connected())return;
    status.setSaveStatus('אופליין — שינויים יישמרו מקומית','saving');
    status.setCloudHeaderStatus('offline','ענן: אופליין');
  }

  function visibility(){
    if(document.hidden){resources.cancel('poll');resources.cancel('finance');return}
    if(!allowed())return;
    if(cloud.connected())resources.schedule('poll',100,()=>{if(!document.hidden&&cloudReady())return cloud.cloudPoll()});
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

  function dispose(){if(disposed)return false;disposed=true;bank.stopAutoSync();credit.stopAutoSync();return resources.dispose()}
  return {start,dispose};
}
