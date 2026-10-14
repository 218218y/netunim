import {createCloudTransfer} from './cloud-transfer.js';
import {createCloudOpening} from './cloud-opening.js';
import {createCloudAuthentication} from './cloud-authentication.js';
import {createCloudReset} from './cloud-reset.js';
import {createCloudReview} from './cloud-review.js';
import {createCloudSession} from './cloud-session.js';
import {createCloudRecoveryRuntime} from '../shared/cloud-recovery-runtime.js';
import {CLOUD_AUTO_KEY} from '../state/constants.js';

// Composes capability owners. Authentication, transfer and hydration keep
// their own dependencies; callbacks defer the two login/reset continuations.
export function createUiCloud({model,files,tab,session,checksSession,auth={},view={},storage={},main={},secondary={},review={}}){
  const recoveryRuntime=createCloudRecoveryRuntime({
    isEligible:()=>tab.primaryTab&&globalThis.navigator?.onLine!==false&&localStorage.getItem(CLOUD_AUTO_KEY)==='1'&&!!auth.loadSession(),
    run:()=>opening.openCloud({renderAfter:true,quiet:true}),onError:error=>console.error('orders cloud recovery',error),
  });
  const recovery={reset:()=>recoveryRuntime.reset(),schedule:()=>recoveryRuntime.schedule()};
  const transfer=createCloudTransfer({model,session,checksSession,auth,view,storage,main,secondary,recovery});
  const opening=createCloudOpening({model,files,tab,session,auth,view,storage,main,secondary,recovery,transfer,authentication:{loginModal:(...args)=>authentication.loginModal(...args)}});
  const reset=createCloudReset({tab,auth,view,main,authentication:{loginModal:(...args)=>authentication.loginModal(...args)}});
  const authentication=createCloudAuthentication({auth,view,opening,reset});
  const recoveryUi=createCloudReview({tab,auth,view,review});
  const sessionUi=createCloudSession({session,checksSession,auth,view,main,secondary,recovery});
  return {
    recoveryRuntime,
    recoverOrdersSync:recoveryUi.recoverOrdersSync,
    loginModal:authentication.loginModal,
    finishCloudLogin:authentication.finishCloudLogin,
    finishLocalResetLogin:authentication.finishLocalResetLogin,
    enableCloud:opening.enableCloud,
    openCloud:opening.openCloud,
    logoutCloud:sessionUi.logoutCloud,
    resetLocalSiteStorage:reset.resetLocalSiteStorage,
  };
}
