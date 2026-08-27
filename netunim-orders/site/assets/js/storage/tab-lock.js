import {TAB_LOCK} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageTabLock({tab, showSecondaryTabGuard}){
async function acquirePrimaryTabLock(){if(!navigator.locks?.request){tab.primaryTab=true;tab.primaryTabReady=true;showSecondaryTabGuard();return true}let settled=false;return await new Promise(resolve=>{navigator.locks.request(TAB_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){tab.primaryTab=false;tab.primaryTabReady=true;showSecondaryTabGuard();if(!settled){settled=true;resolve(false)}return}tab.primaryTab=true;tab.primaryTabReady=true;showSecondaryTabGuard();if(!settled){settled=true;resolve(true)}await new Promise(r=>{tab.primaryLockRelease=r})}).catch(e=>{console.error('tab writer lock',e);tab.primaryTab=true;tab.primaryTabReady=true;showSecondaryTabGuard();if(!settled){settled=true;resolve(true)}})})}

return { acquirePrimaryTabLock };
}
