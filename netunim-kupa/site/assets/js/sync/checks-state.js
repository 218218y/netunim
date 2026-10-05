import {normalizeSharedChecks} from '../domains/checks/model.js';
import {jsonEq} from './merge-records.js';
import {SHARED_CHECKS_PENDING_KEY} from '../state/constants.js';

const SHARED_CHECKS_OUTBOX_KEY='shared-checks-outbox-v3';

// The live checks state comes from Shared V2. Only the retired outbox's
// presence is inspected by transition preflight; its payload is never replayed.
export function createSyncChecksState({session,checksSession,model,normalizeState,idbGet,sharedChecksHasLocalWork=()=>true}){
  function lastSavedState(){try{return session.lastSavedSnapshot?normalizeState(JSON.parse(session.lastSavedSnapshot)):null}catch{return null}}
  async function verifyLegacyChecksClean(){
    const commit=checksSession.sharedChecksOutboxCommitPromise;
    await commit;
    const durable=await idbGet('sync',SHARED_CHECKS_OUTBOX_KEY);
    return checksSession.sharedChecksOutboxCommitPromise===commit&&durable==null&&
      !checksSession.sharedChecksOutboxCached&&localStorage.getItem(SHARED_CHECKS_PENDING_KEY)==null;
  }
  function sharedChecksHaveLocalWork(){
    return checksSession.sharedChecksSaveRequested||sharedChecksHasLocalWork()||
      !!(checksSession.sharedChecksBase&&!jsonEq(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.sharedChecksBase)));
  }
  return {lastSavedState,sharedChecksHaveLocalWork,verifyLegacyChecksClean};
}
