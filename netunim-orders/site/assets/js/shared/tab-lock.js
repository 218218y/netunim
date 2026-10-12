// @ts-check
import {createBrowserTabLockPlatform} from './browser-tab-lock-platform.js';

const HEARTBEAT_MS=1500;
const LEASE_MS=5000;
/** @typedef {{primaryTab:boolean,primaryTabReady:boolean,readOnlyTab?:boolean,lockDiagnostic?:string}} PrimaryTabState */
/** @typedef {{id:string,expiresAt:number}} Lease */
/** @param {string|null} raw @returns {Lease|null} */
function parseLease(raw){
  try{
    const value=JSON.parse(raw||'null');
    return value&&typeof value.id==='string'&&Number.isFinite(Number(value.expiresAt))?{id:value.id,expiresAt:Number(value.expiresAt)}:null;
  }catch{return null}
}

/**
 * Owns the native lock hold or fallback lease and all its runtime resources.
 * A denied/demoted document stays read-only until reload, as before.
 * @param {{lockName:string,tab:PrimaryTabState,showSecondaryTabGuard:()=>void,platform?:import('./browser-tab-lock-platform.js').PrimaryTabPlatform,onError?:(message:string,error:unknown)=>void}} ports
 */
export function createPrimaryTabLock({lockName,tab,showSecondaryTabGuard,platform=createBrowserTabLockPlatform(),onError=(message,error)=>console.error(message,error)}){
  if(typeof lockName!=='string'||!lockName.trim())throw new Error('tab_lock_name_required');
  const key=`netunim:primary:${lockName}`,clock=platform.clock;
  let active=true,initialized=false,fallbackStarted=false,id='';
  /** @type {number|null} */ let heartbeatTimer=null;
  /** @type {number|null} */ let retryTimer=null;
  /** @type {number|null} */ let settleTimer=null;
  /** @type {import('./browser-tab-lock-platform.js').PrimaryTabChannel|null} */ let channel=null;
  /** @type {Array<()=>void>} */ const releases=[];
  /** @type {(()=>void)|null} */ let releaseNative=null;
  /** @type {(()=>void)|null} */ let settleFallback=null;
  /** @type {Promise<boolean>|null} */ let acquisition=null;
  /** @type {Promise<void>|null} */ let nativeTask=null;
  /** @type {Promise<void>|null} */ let fallbackTask=null;
  /** @type {(value:boolean)=>void} */ let complete=()=>{};
  /** @param {boolean} value */
  function setPrimary(value){
    if(!active||tab.readOnlyTab)value=false;
    if(!value)tab.readOnlyTab=true;
    const changed=tab.primaryTab!==value||!tab.primaryTabReady;
    tab.primaryTab=value;tab.primaryTabReady=true;
    if(changed)showSecondaryTabGuard();return value;
  }
  /** @param {string} code @param {unknown} [error] */
  function failClosed(code,error){tab.lockDiagnostic=code;if(error)onError('tab writer fallback',error);setPrimary(false)}
  function currentLease(){
    try{
      const raw=platform.lease.getItem(key),lease=parseLease(raw);
      if(raw!==null&&!lease){failClosed('fallback_lease_corrupt');return {invalid:true}}
      return lease;
    }catch(error){failClosed('fallback_storage_unavailable',error);return {invalid:true}}
  }
  function writeLease(){
    try{platform.lease.setItem(key,JSON.stringify({id,expiresAt:clock.now()+LEASE_MS}));const lease=currentLease();return lease&&'id' in lease&&lease.id===id}
    catch(error){failClosed('fallback_lease_write_failed',error);return false}
  }
  function scheduleElection(delay=100+Math.floor(clock.random()*250)){
    if(!active||tab.readOnlyTab)return;
    if(retryTimer!==null)clock.clearTimeout(retryTimer);
    retryTimer=clock.setTimeout(()=>{
      retryTimer=null;if(!active||tab.readOnlyTab)return;
      const lease=currentLease();
      if(lease&&'invalid' in lease){scheduleElection(1000);return}
      if(!lease||lease.expiresAt<=clock.now())claimFallbackLease();
    },delay);
  }
  function claimFallbackLease(){
    if(!active||tab.readOnlyTab){setPrimary(false);return false}
    const lease=currentLease();
    if(lease&&'invalid' in lease){failClosed('fallback_lock_unproven');scheduleElection(1000);return false}
    if(lease&&lease.id!==id&&lease.expiresAt>clock.now()){
      setPrimary(false);scheduleElection(Math.max(250,lease.expiresAt-clock.now()+Math.floor(clock.random()*250)));return false;
    }
    const won=!!writeLease();setPrimary(won);if(won)channel?.notify(id);return won;
  }
  function heartbeat(){
    if(!active)return;
    const lease=currentLease();
    if(lease&&'invalid' in lease){failClosed('fallback_lock_unproven');scheduleElection(1000);return}
    if(tab.primaryTab){
      if(lease&&lease.id!==id&&lease.expiresAt>clock.now()){setPrimary(false);scheduleElection();return}
      if(!writeLease()){failClosed('fallback_lease_refresh_failed');scheduleElection()}
    }else if(!tab.readOnlyTab&&(!lease||lease.expiresAt<=clock.now()))scheduleElection();
  }
  async function acquireFallback(){
    if(!active)return false;
    fallbackStarted=true;
    try{
      id=platform.identity();
      channel=platform.events.channel(`${key}:channel`,other=>{
        if(!active||other===id)return;
        const lease=currentLease();if(!lease||'id' in lease&&lease.id!==id)setPrimary(false);
      });
      releases.push(platform.events.storage(key,raw=>{
        if(!active)return;
        const lease=parseLease(raw);
        if(raw!==null&&!lease){failClosed('fallback_lease_corrupt');return}
        if(lease?.id!==id&&Number(lease?.expiresAt||0)>clock.now())setPrimary(false);
        else if(!tab.readOnlyTab)scheduleElection();
      }));
      claimFallbackLease();heartbeatTimer=clock.setInterval(heartbeat,HEARTBEAT_MS);
      await new Promise(resolve=>{
        settleFallback=()=>resolve(undefined);
        settleTimer=clock.setTimeout(()=>{settleTimer=null;settleFallback=null;resolve(undefined)},50+Math.floor(clock.random()*100));
      });
      if(!active)return false;
      heartbeat();return tab.primaryTab;
    }catch(error){if(active){failClosed('fallback_backend_failed',error);scheduleElection(1000)}return false}
  }
  function startFallback(){
    if(fallbackStarted||!active)return;
    fallbackTask=acquireFallback().then(result=>complete(active&&result)).finally(()=>{fallbackTask=null});
  }
  /** @param {boolean} granted */
  async function holdNative(granted){
    if(!active||tab.readOnlyTab){setPrimary(false);complete(false);return}
    if(!granted){setPrimary(false);complete(false);return}
    const held=new Promise(resolve=>{releaseNative=()=>resolve(undefined)});
    complete(setPrimary(true));await held;releaseNative=null;
  }
  function acquirePrimaryTabLock(){
    if(!active)return Promise.resolve(false);
    if(acquisition)return acquisition;
    if(initialized)return Promise.resolve(tab.primaryTab&&!tab.readOnlyTab);
    initialized=true;
    acquisition=new Promise(resolve=>{complete=resolve});
    try{
      releases.push(platform.events.pageHide(dispose));
      if(platform.requestNative){
        nativeTask=Promise.resolve(platform.requestNative(lockName,holdNative)).catch(error=>{
          if(active){onError('tab writer lock',error);startFallback()}
        }).finally(()=>{nativeTask=null});
      }else startFallback();
    }catch(error){if(active){onError('tab writer lock',error);startFallback()}else complete(false)}
    const pending=acquisition;
    void pending.finally(()=>{if(acquisition===pending)acquisition=null});return pending;
  }
  function dispose(){
    if(!active)return false;active=false;
    if(heartbeatTimer!==null)clock.clearInterval(heartbeatTimer);heartbeatTimer=null;
    if(retryTimer!==null)clock.clearTimeout(retryTimer);retryTimer=null;
    if(settleTimer!==null)clock.clearTimeout(settleTimer);settleTimer=null;
    settleFallback?.();settleFallback=null;
    for(const release of releases.splice(0))try{release()}catch(error){onError('tab writer cleanup',error)}
    try{channel?.close()}catch(error){onError('tab writer cleanup',error)}channel=null;
    if(fallbackStarted&&id){
      try{if(parseLease(platform.lease.getItem(key))?.id===id)platform.lease.removeItem(key)}catch{/* Unavailable storage cannot justify deleting another lease. */}
    }
    releaseNative?.();releaseNative=null;complete(false);setPrimary(false);return true;
  }
  async function drain(){
    while(acquisition||nativeTask||fallbackTask)await Promise.allSettled([acquisition,nativeTask,fallbackTask].filter(Boolean));
  }
  return {acquirePrimaryTabLock,runtime:{dispose,drain,isPending:()=>!!acquisition||!!nativeTask||!!fallbackTask}};
}
