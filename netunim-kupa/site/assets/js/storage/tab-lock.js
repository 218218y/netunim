import {TAB_LOCK} from '../state/constants.js';

const HEARTBEAT_MS=1500;
const LEASE_MS=5000;
const FALLBACK_KEY=`netunim:primary:${TAB_LOCK}`;

function parseLease(raw){try{const value=JSON.parse(raw||'null');return value&&typeof value.id==='string'&&Number.isFinite(Number(value.expiresAt))?value:null}catch{return null}}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageTabLock({tab,showSecondaryTabGuard}){
  const tabId=(()=>{try{const existing=sessionStorage.getItem(`${FALLBACK_KEY}:id`);if(existing)return existing;const value=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;sessionStorage.setItem(`${FALLBACK_KEY}:id`,value);return value}catch{return crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`}})();
  let heartbeatTimer=null,retryTimer=null,channel=null;
  function setPrimary(value){const changed=tab.primaryTab!==value||!tab.primaryTabReady;tab.primaryTab=value;tab.primaryTabReady=true;if(changed)showSecondaryTabGuard()}
  function failClosed(code,error){tab.lockDiagnostic=code;if(error)console.error('tab writer fallback',error);setPrimary(false)}
  function currentLease(){try{const raw=localStorage.getItem(FALLBACK_KEY),lease=parseLease(raw);if(raw!==null&&!lease){failClosed('fallback_lease_corrupt');return {invalid:true}}return lease}catch(error){failClosed('fallback_storage_unavailable',error);return {invalid:true}}}
  function writeLease(){const lease={id:tabId,expiresAt:Date.now()+LEASE_MS};try{localStorage.setItem(FALLBACK_KEY,JSON.stringify(lease));return currentLease()?.id===tabId}catch(error){failClosed('fallback_lease_write_failed',error);return false}}
  function scheduleElection(delay=100+Math.floor(Math.random()*250)){clearTimeout(retryTimer);retryTimer=setTimeout(()=>{const lease=currentLease();if(lease?.invalid){scheduleElection(1000);return}if(!lease||Number(lease.expiresAt)<=Date.now())claimFallbackLease()},delay)}
  function claimFallbackLease(){const lease=currentLease();if(lease?.invalid){failClosed('fallback_lock_unproven');scheduleElection(1000);return false}if(lease&&lease.id!==tabId&&Number(lease.expiresAt)>Date.now()){setPrimary(false);scheduleElection(Math.max(250,Number(lease.expiresAt)-Date.now()+Math.floor(Math.random()*250)));return false}const won=writeLease();setPrimary(won);if(won)channel?.postMessage({type:'primary-heartbeat',id:tabId});return won}
  function heartbeat(){const lease=currentLease();if(lease?.invalid){failClosed('fallback_lock_unproven');scheduleElection(1000);return}if(tab.primaryTab){if(lease&&lease.id!==tabId&&Number(lease.expiresAt)>Date.now()){setPrimary(false);scheduleElection();return}if(!writeLease()){failClosed('fallback_lease_refresh_failed');scheduleElection()}}else if(!lease||Number(lease.expiresAt)<=Date.now())scheduleElection()}
  function releaseFallbackLease(){clearInterval(heartbeatTimer);clearTimeout(retryTimer);const lease=currentLease();if(lease?.id===tabId)try{localStorage.removeItem(FALLBACK_KEY)}catch{}try{channel?.close()}catch{}}
  async function acquireFallbackLock(){try{channel=typeof BroadcastChannel==='function'?new BroadcastChannel(`${FALLBACK_KEY}:channel`):null;channel?.addEventListener('message',event=>{if(event.data?.type==='primary-heartbeat'&&event.data.id!==tabId){const lease=currentLease();if(!lease?.invalid&&lease?.id!==tabId)setPrimary(false)}});window.addEventListener('storage',event=>{if(event.key!==FALLBACK_KEY)return;const lease=parseLease(event.newValue);if(event.newValue!==null&&!lease){failClosed('fallback_lease_corrupt');return}if(lease?.id!==tabId&&Number(lease?.expiresAt||0)>Date.now())setPrimary(false);else scheduleElection()});window.addEventListener('pagehide',releaseFallbackLease,{once:true});claimFallbackLease();heartbeatTimer=setInterval(heartbeat,HEARTBEAT_MS);await new Promise(resolve=>setTimeout(resolve,50+Math.floor(Math.random()*100)));heartbeat();return tab.primaryTab}catch(error){failClosed('fallback_backend_failed',error);scheduleElection(1000);return false}}
  async function acquirePrimaryTabLock(){if(!navigator.locks?.request)return acquireFallbackLock();let settled=false;return await new Promise(resolve=>{try{navigator.locks.request(TAB_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){setPrimary(false);if(!settled){settled=true;resolve(false)}return}setPrimary(true);if(!settled){settled=true;resolve(true)}await new Promise(r=>{tab.primaryLockRelease=r})}).catch(error=>{console.error('tab writer lock',error);acquireFallbackLock().then(result=>{if(!settled){settled=true;resolve(result)}})})}catch(error){console.error('tab writer lock',error);acquireFallbackLock().then(result=>{if(!settled){settled=true;resolve(result)}})}})}
  return {acquirePrimaryTabLock};
}
