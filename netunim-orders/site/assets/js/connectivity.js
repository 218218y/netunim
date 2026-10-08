import {createRuntimeResources} from './shared/runtime-resources.js';

export function createOrdersConnectivityRuntime({access,cloud,checks,finance,morning,status,environment=globalThis,timers=globalThis}){
  for(const [name,port,methods] of [
    ['access',access,['primary','blocked','authenticated']],
    ['cloud',cloud,['enabled','resumeAfterReconnect']],
    ['checks',checks,['pollSharedChecks']],
    ['finance',finance,['startAutoSync']],
    ['morning',morning,['recoverPendingMorningOperation']],
    ['status',status,['startupDomainLocked','setCloud']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`orders_connectivity_${name}_${method}_required`);
  const {window,document,navigator}=environment;
  const resources=createRuntimeResources({timers});
  let started=false,disposed=false;
  const allowed=()=>!access.blocked()&&navigator.onLine!==false;
  const checksReady=()=>allowed()&&access.authenticated()&&!status.startupDomainLocked('checks');
  const morningReady=()=>allowed()&&access.primary()&&access.authenticated();

  function scheduleChecks(delay){resources.schedule('checks',delay,()=>{if(checksReady())return checks.pollSharedChecks()})}
  function scheduleMorning(delay){resources.schedule('morning',delay,()=>{if(morningReady())return morning.recoverPendingMorningOperation({quiet:true})})}
  function scheduleFinance(){resources.schedule('finance',0,()=>{if(allowed()&&!status.startupDomainLocked('finance'))return finance.startAutoSync()})}

  function online(){
    if(access.blocked())return;
    if(access.primary()&&cloud.enabled())resources.schedule('reconnect',250,()=>{if(allowed()&&access.primary()&&cloud.enabled())return cloud.resumeAfterReconnect()});
    else if(checksReady())scheduleChecks(300);
    if(morningReady())scheduleMorning(450);
    if(!status.startupDomainLocked('finance'))scheduleFinance();
  }

  function offline(){
    for(const key of ['reconnect','checks','morning','finance'])resources.cancel(key);
    if(cloud.enabled())status.setCloud('ענן: אופליין','offline');
  }

  function visibility(){
    if(document.hidden){for(const key of ['checks','morning','finance'])resources.cancel(key);return}
    if(access.blocked())return;
    if(checksReady())scheduleChecks(120);
    if(morningReady())scheduleMorning(180);
    if(!status.startupDomainLocked('finance'))scheduleFinance();
  }

  function start(){
    if(disposed)throw new Error('orders_connectivity_disposed');
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
