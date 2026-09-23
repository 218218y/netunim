import {withoutEmbeddedWorkbook} from '../shared/spreadsheet-cutover.js';
import {notesSheetHasMeaningfulData} from '../shared/notes-sheet-model.js';
import {comparableBackupData} from './serialization.js';
import {eq} from '../sync/merge-records.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {clone} from '../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStateSnapshots({externalWorkbooks=false,model, ui, session, checksSession, prepareState, cloudPendingExists, checksPendingExists, normalizeState, domainRevisions}){
function sameBusinessData(a,b){return comparableBackupData(a)===comparableBackupData(b)}

function prepareCloudState(source=model.state){const x=externalWorkbooks?withoutEmbeddedWorkbook(prepareState(source)):prepareState(source);delete x.checks;return x}

function sameOrderCloudData(a,b){return comparableBackupData(prepareCloudState(a))===comparableBackupData(prepareCloudState(b))}

function hasMeaningfulLocalData(source=model.state){return notesSheetHasMeaningfulData(source?.notesSheet)||['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes'].some(k=>Array.isArray(source?.[k])&&source[k].length)}

function cloudHasLocalWork(){return session.cloudSaveRequested||cloudPendingExists()||!!(session.lastCloudState&&!sameOrderCloudData(model.state,session.lastCloudState))}

function checksHaveLocalWork(){return checksSession.checksSaveRequested||checksPendingExists()||!!(checksSession.checksCloudBase&&!eq(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.checksCloudBase)))}

function composeOrderCloudState(remoteState,currentState=model.state){const next=normalizeState(clone(remoteState));next.checks=clone(currentState.checks||[]);return next}
function applyOrderCloudState(remoteState){const previous=model.state;model.state=composeOrderCloudState(remoteState,previous);domainRevisions?.reconcile(previous,model.state);return model.state}

return { sameBusinessData, prepareCloudState, sameOrderCloudData, hasMeaningfulLocalData, cloudHasLocalWork, checksHaveLocalWork, composeOrderCloudState, applyOrderCloudState };
}
