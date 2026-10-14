import {createCloudTransfer} from './cloud-transfer.js';
import {createCloudOpening} from './cloud-opening.js';
import {createCloudAuthentication} from './cloud-authentication.js';
import {createCloudReset} from './cloud-reset.js';
import {createCloudReview} from './cloud-review.js';
import {createCloudSession} from './cloud-session.js';
import {createCloudRecoveryRuntime} from '../shared/cloud-recovery-runtime.js';
import {SUPA_AUTO_KEY} from '../state/constants.js';

// Composes capability owners. Authentication, transfer and hydration keep
// their own dependencies; callbacks defer the two login/reset continuations.
export function createUiCloud({session,tab,checksSession,model,auth={},view={},storage={},main={}}){
  const recoveryRuntime=createCloudRecoveryRuntime({
    isEligible:()=>tab.primaryTab&&globalThis.navigator?.onLine!==false&&localStorage.getItem(SUPA_AUTO_KEY)==='1'&&!!auth.loadSupaSession(),
    run:()=>opening.tryAutoOpenSupabase(),onError:error=>console.error('kupa cloud recovery',error),
  });
  const recovery={reset:()=>recoveryRuntime.reset(),schedule:()=>recoveryRuntime.schedule()};
  const transfer=createCloudTransfer({session,checksSession,model,auth,view,storage,main,recovery});
  const opening=createCloudOpening({session,tab,auth,view,storage,main,recovery,transfer,authentication:{openSupabaseLoginModal:(...args)=>authentication.openSupabaseLoginModal(...args)}});
  const reset=createCloudReset({tab,auth,view,main,authentication:{openSupabaseLoginModal:(...args)=>authentication.openSupabaseLoginModal(...args)}});
  const authentication=createCloudAuthentication({auth,view,storage,transfer,opening,reset});
  const recoveryUi=createCloudReview({session,view,main});
  const sessionUi=createCloudSession({session,tab,checksSession,auth,view,main,recovery});
  return {
    recoveryRuntime,
    discardCloudPendingAndLoadRemote:recoveryUi.discardCloudPendingAndLoadRemote,
    openSupabaseLoginModal:authentication.openSupabaseLoginModal,
    showCloudNoDocument:opening.showCloudNoDocument,
    openCloudUsingSavedSession:opening.openCloudUsingSavedSession,
    enableCloudFromCurrentState:opening.enableCloudFromCurrentState,
    connectSupabaseFromLogin:authentication.connectSupabaseFromLogin,
    tryAutoOpenSupabase:opening.tryAutoOpenSupabase,
    logoutSupabase:sessionUi.logoutSupabase,
    resetLocalSiteStorage:reset.resetLocalSiteStorage,
  };
}
