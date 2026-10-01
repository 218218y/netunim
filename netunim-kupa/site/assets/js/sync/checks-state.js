import {normalizeSharedChecks} from '../domains/checks/model.js';
import {jsonEq} from './merge-records.js';

// Shared Checks durability is owned exclusively by Shared Checks V2. This
// helper keeps only current in-memory invariants used by Kupa business logic.
export function createSyncChecksState({session, checksSession, model, normalizeState, prepareKupaCloudState}){
function lastSavedState(){try{return session.lastSavedSnapshot?normalizeState(JSON.parse(session.lastSavedSnapshot)):null}catch(e){return null}}
function lastSavedCloudState(){try{return session.lastSavedSnapshot?prepareKupaCloudState(JSON.parse(session.lastSavedSnapshot)):null}catch(e){return null}}
function sharedChecksHaveLocalWork(){return checksSession.sharedChecksSaveRequested||!!(checksSession.sharedChecksBase&&!jsonEq(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.sharedChecksBase)))}
return { lastSavedState, lastSavedCloudState, sharedChecksHaveLocalWork };
}
