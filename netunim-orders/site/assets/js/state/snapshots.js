import {comparableBackupData} from './serialization.js';
import {eq} from '../sync/merge-records.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {clone} from '../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStateSnapshots({model, ui, session, checksSession, prepareState, cloudPendingExists, checksPendingExists, normalizeState}){
function sameBusinessData(a,b){return comparableBackupData(a)===comparableBackupData(b)}

function prepareCloudState(source=model.state){const x=prepareState(source);delete x.checks;return x}

function sameOrderCloudData(a,b){return comparableBackupData(prepareCloudState(a))===comparableBackupData(prepareCloudState(b))}

function hasMeaningfulLocalData(source=model.state){return ['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes'].some(k=>Array.isArray(source?.[k])&&source[k].length)}

function cloudHasLocalWork(){return session.cloudSaveRequested||cloudPendingExists()||!!(session.lastCloudState&&!sameOrderCloudData(model.state,session.lastCloudState))}

function checksHaveLocalWork(){return checksSession.checksSaveRequested||checksPendingExists()||!!(checksSession.checksCloudBase&&!eq(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.checksCloudBase)))}

function applyOrderCloudState(remoteState){const sharedChecks=clone(model.state.checks||[]);model.state=normalizeState(remoteState);model.state.checks=sharedChecks;return model.state}

return { sameBusinessData, prepareCloudState, sameOrderCloudData, hasMeaningfulLocalData, cloudHasLocalWork, checksHaveLocalWork, applyOrderCloudState };
}
