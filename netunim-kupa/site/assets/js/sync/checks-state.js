import {normalizeSharedChecks} from '../domains/checks/model.js';
import {jsonEq} from './merge-records.js';
// The live checks state and local-work signal come from Shared V2.
export function createSyncChecksState({checksSession,model,sharedChecksHasLocalWork=()=>true}){
  function sharedChecksHaveLocalWork(){
    return checksSession.sharedChecksSaveRequested||sharedChecksHasLocalWork()||
      !!(checksSession.sharedChecksBase&&!jsonEq(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.sharedChecksBase)));
  }
  return {sharedChecksHaveLocalWork};
}
