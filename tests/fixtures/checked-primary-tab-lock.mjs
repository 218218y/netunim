import {createPrimaryTabLock} from '../../shared/tab-lock.js';
import {createBrowserTabLockPlatform} from '../../shared/browser-tab-lock-platform.js';
const platform=createBrowserTabLockPlatform();
const owner=createPrimaryTabLock({lockName:'checked-owner',tab:{primaryTab:true,primaryTabReady:false},showSecondaryTabGuard:()=>{},platform});
/** @type {Promise<boolean>} */ const acquisition=owner.acquirePrimaryTabLock();void acquisition;
/** @type {Promise<void>} */ const release=owner.runtime.drain();void release;
// @ts-expect-error A primary writer result is asynchronous evidence.
const guessed=/** @type {boolean} */ (owner.acquirePrimaryTabLock());void guessed;
// @ts-expect-error Resource cleanup is private, not context state.
owner.primaryLockRelease();
// @ts-expect-error A native grant callback must wait for its hold to finish.
createPrimaryTabLock({lockName:'bad-port',tab:{primaryTab:true,primaryTabReady:false},showSecondaryTabGuard:()=>{},platform:{...platform,requestNative:async(_name,_hold)=>true}});
// @ts-expect-error A primary flag is a boolean, not a display string.
createPrimaryTabLock({lockName:'bad-state',tab:{primaryTab:'primary',primaryTabReady:false},showSecondaryTabGuard:()=>{}});
