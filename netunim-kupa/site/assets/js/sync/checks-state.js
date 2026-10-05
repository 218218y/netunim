import {normalizeSharedChecks} from '../domains/checks/model.js';
import {jsonEq} from './merge-records.js';
// The live checks state and local-work signal come from Shared V2.
export function createSyncChecksState({session,checksSession,model,normalizeState,sharedChecksHasLocalWork=()=>true}){
  function lastSavedState(){try{return session.lastSavedSnapshot?normalizeState(JSON.parse(session.lastSavedSnapshot)):null}catch{return null}}
  function sharedChecksHaveLocalWork(){
    return checksSession.sharedChecksSaveRequested||sharedChecksHasLocalWork()||
      !!(checksSession.sharedChecksBase&&!jsonEq(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.sharedChecksBase)));
  }
  return {lastSavedState,sharedChecksHaveLocalWork};
}
