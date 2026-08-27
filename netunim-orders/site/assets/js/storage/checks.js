import {normalizeSharedChecks, normalizeSharedBankEvents} from '../domains/checks/model.js';
import {CHECKS_BASE_KEY, LEGACY_CHECKS_BASE_KEY, CHECKS_EVENTS_KEY, CHECKS_PENDING_KEY, LEGACY_CHECKS_PENDING_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageChecks({checksSession}){
function loadChecksBase(){try{const raw=localStorage.getItem(CHECKS_BASE_KEY)||localStorage.getItem(LEGACY_CHECKS_BASE_KEY),x=JSON.parse(raw||'null');return Array.isArray(x)?normalizeSharedChecks(x):null}catch(e){console.error('checks base load',e);return null}}

function loadChecksBankEvents(){try{return normalizeSharedBankEvents(JSON.parse(localStorage.getItem(CHECKS_EVENTS_KEY)||'[]'))}catch(e){console.error('checks events load',e);return[]}}

function persistChecksBase(checks,events=checksSession.checksBankEvents){try{localStorage.setItem(CHECKS_BASE_KEY,JSON.stringify(normalizeSharedChecks(checks)));localStorage.setItem(CHECKS_EVENTS_KEY,JSON.stringify(normalizeSharedBankEvents(events)));localStorage.removeItem(LEGACY_CHECKS_BASE_KEY);return true}catch(e){console.error('checks base save',e);return false}}

function markChecksPending(){try{localStorage.setItem(CHECKS_PENDING_KEY,JSON.stringify({pending:true,updatedAt:new Date().toISOString()}));return true}catch(e){console.error('checks pending marker',e);return false}}

function checksPendingExists(){return !!(localStorage.getItem(CHECKS_PENDING_KEY)||localStorage.getItem(LEGACY_CHECKS_PENDING_KEY))}

function clearChecksPending(){localStorage.removeItem(CHECKS_PENDING_KEY);localStorage.removeItem(LEGACY_CHECKS_PENDING_KEY)}

return { loadChecksBase, loadChecksBankEvents, persistChecksBase, markChecksPending, checksPendingExists, clearChecksPending };
}
