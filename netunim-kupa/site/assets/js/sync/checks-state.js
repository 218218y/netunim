import {normalizeSharedChecks, normalizeSharedBankEvents} from '../domains/checks/model.js';
import {jsonEq} from './merge-records.js';
import {SHARED_CHECKS_BASE_KEY, SHARED_CHECKS_EVENTS_KEY, SHARED_CHECKS_PENDING_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncChecksState({session, checksSession, model, normalizeState, prepareKupaCloudState}){
function lastSavedState(){try{return session.lastSavedSnapshot?normalizeState(JSON.parse(session.lastSavedSnapshot)):null}catch(e){return null}}

function lastSavedCloudState(){try{return session.lastSavedSnapshot?prepareKupaCloudState(JSON.parse(session.lastSavedSnapshot)):null}catch(e){return null}}

function loadSharedChecksBase(){try{const x=JSON.parse(localStorage.getItem(SHARED_CHECKS_BASE_KEY)||'null');return Array.isArray(x)?normalizeSharedChecks(x):null}catch(e){console.error('shared checks base load',e);return null}}

function loadSharedChecksBankEvents(){try{return normalizeSharedBankEvents(JSON.parse(localStorage.getItem(SHARED_CHECKS_EVENTS_KEY)||'[]'))}catch(e){console.error('shared checks events load',e);return[]}}

function persistSharedChecksBase(checks,events=checksSession.sharedChecksBankEvents){try{localStorage.setItem(SHARED_CHECKS_BASE_KEY,JSON.stringify(normalizeSharedChecks(checks)));localStorage.setItem(SHARED_CHECKS_EVENTS_KEY,JSON.stringify(normalizeSharedBankEvents(events)));return true}catch(e){console.error('shared checks base save',e);return false}}

function markSharedChecksPending(){try{localStorage.setItem(SHARED_CHECKS_PENDING_KEY,JSON.stringify({pending:true,updatedAt:new Date().toISOString()}));return true}catch(e){console.error('shared checks pending',e);return false}}

function sharedChecksPendingExists(){return !!localStorage.getItem(SHARED_CHECKS_PENDING_KEY)}

function clearSharedChecksPending(){localStorage.removeItem(SHARED_CHECKS_PENDING_KEY)}

function sharedChecksHaveLocalWork(){return checksSession.sharedChecksSaveRequested||sharedChecksPendingExists()||!!(checksSession.sharedChecksBase&&!jsonEq(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.sharedChecksBase)))}

return { lastSavedState, lastSavedCloudState, loadSharedChecksBase, loadSharedChecksBankEvents, persistSharedChecksBase, markSharedChecksPending, sharedChecksPendingExists, clearSharedChecksPending, sharedChecksHaveLocalWork };
}
