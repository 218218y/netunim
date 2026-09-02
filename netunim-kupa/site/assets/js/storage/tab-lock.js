import {TAB_LOCK} from '../state/constants.js';

const HEARTBEAT_MS=1500;
const LEASE_MS=5000;
const FALLBACK_KEY=`netunim:primary:${TAB_LOCK}`;

function parseLease(raw){try{const value=JSON.parse(raw||'null');return value&&typeof value.id==='string'&&Number.isFinite(Number(value.expiresAt))?value:null}catch{return null}}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageTabLock({tab, showSecondaryTabGuard}){
const tabId=(()=>{try{const existing=sessionStorage.getItem(`${FALLBACK_KEY}:id`);if(existing)return existing;const value=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;sessionStorage.setItem(`${FALLBACK_KEY}:id`,value);return value}catch{return crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`}})();
let heartbeatTimer=null,retryTimer=null,channel=null;
function setPrimary(value){const changed=tab.primaryTab!==value||!tab.primaryTabReady;tab.primaryTab=value;tab.primaryTabReady=true;if(changed)showSecondaryTabGuard()}
function currentLease(){try{return parseLease(localStorage.getItem(FALLBACK_KEY))}catch{return null}}
function writeLease(){const lease={id:tabId,expiresAt:Date.now()+LEASE_MS};try{localStorage.setItem(FALLBACK_KEY,JSON.stringify(lease));return currentLease()?.id===tabId}catch{return false}}
function scheduleElection(delay=100+Math.floor(Math.random()*250)){clearTimeout(retryTimer);retryTimer=setTimeout(()=>{const lease=currentLease();if(!lease||Number(lease.expiresAt)<=Date.now())claimFallbackLease()},delay)}
function claimFallbackLease(){const lease=currentLease();if(lease&&lease.id!==tabId&&Number(lease.expiresAt)>Date.now()){setPrimary(false);scheduleElection(Math.max(250,Number(lease.expiresAt)-Date.now()+Math.floor(Math.random()*250)));return false}const won=writeLease();setPrimary(won);if(won)channel?.postMessage({type:'primary-heartbeat',id:tabId});return won}
function heartbeat(){const lease=currentLease();if(tab.primaryTab){if(lease&&lease.id!==tabId&&Number(lease.expiresAt)>Date.now()){setPrimary(false);scheduleElection();return}if(!writeLease()){setPrimary(false);scheduleElection()}}else if(!lease||Number(lease.expiresAt)<=Date.now())scheduleElection()}
function releaseFallbackLease(){clearInterval(heartbeatTimer);clearTimeout(retryTimer);const lease=currentLease();if(lease?.id===tabId)try{localStorage.removeItem(FALLBACK_KEY)}catch{}channel?.close()}
async function acquireFallbackLock(){try{channel=typeof BroadcastChannel==='function'?new BroadcastChannel(`${FALLBACK_KEY}:channel`):null;channel?.addEventListener('message',event=>{if(event.data?.type==='primary-heartbeat'&&event.data.id!==tabId){const lease=currentLease();if(lease?.id!==tabId)setPrimary(false)}});window.addEventListener('storage',event=>{if(event.key!==FALLBACK_KEY)return;const lease=parseLease(event.newValue);if(lease?.id!==tabId&&Number(lease?.expiresAt||0)>Date.now())setPrimary(false);else scheduleElection()});window.addEventListener('pagehide',releaseFallbackLease,{once:true});claimFallbackLease();heartbeatTimer=setInterval(heartbeat,HEARTBEAT_MS);await new Promise(resolve=>setTimeout(resolve,50+Math.floor(Math.random()*100)));heartbeat();return tab.primaryTab}catch(error){console.error('tab writer fallback',error);setPrimary(true);return true}}
async function acquirePrimaryTabLock(){if(!navigator.locks?.request)return acquireFallbackLock();let settled=false;return await new Promise(resolve=>{navigator.locks.request(TAB_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){setPrimary(false);if(!settled){settled=true;resolve(false)}return}setPrimary(true);if(!settled){settled=true;resolve(true)}await new Promise(r=>{tab.primaryLockRelease=r})}).catch(error=>{console.error('tab writer lock',error);acquireFallbackLock().then(result=>{if(!settled){settled=true;resolve(result)}})})})}

return { acquirePrimaryTabLock };
}
