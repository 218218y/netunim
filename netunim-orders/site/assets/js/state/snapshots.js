import {notesSheetHasMeaningfulData} from '../shared/notes-sheet-model.js';
import {comparableBackupData} from './serialization.js';
import {equalSyncJson} from '../shared/cloud-sync.js';
import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {clone} from '../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStateSnapshots({externalWorkbooks=false,model, ui, session, checksSession, prepareState, cloudPendingExists, sharedChecksHasLocalWork=()=>true, normalizeState, domainRevisions}){
function sameBusinessData(a,b){return comparableBackupData(a)===comparableBackupData(b)}

function withoutEmbeddedWorkbook(source){const state=structuredClone(source);delete state.notesSheet;state.notesWorkbookExternal=1;return state}

function prepareCloudState(source=model.state){
  const x=externalWorkbooks?withoutEmbeddedWorkbook(prepareState(source)):prepareState(source);
  delete x.checks;
  // The cloud document may contain only stable document metadata. Browser
  // durability fields such as localSnapshotSeq (and backup timestamps such as
  // savedAt) belong to one client, not to the shared business document. Keeping
  // them here makes a V1 snapshot and the equivalent V2 checkpoint compare as
  // different after a cutover round-trip even when every business field is
  // identical.
  if(x._meta){
    const {format,schemaVersion,app}=x._meta;
    x._meta={format,schemaVersion,app};
  }
  return x;
}

function sameOrderCloudData(a,b){return comparableBackupData(prepareCloudState(a))===comparableBackupData(prepareCloudState(b))}

function hasMeaningfulLocalData(source=model.state){return notesSheetHasMeaningfulData(source?.notesSheet)||['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes'].some(k=>Array.isArray(source?.[k])&&source[k].length)}

function cloudHasLocalWork(){return session.cloudSaveRequested||cloudPendingExists()||!!(session.lastCloudState&&!sameOrderCloudData(model.state,session.lastCloudState))}

function checksHaveLocalWork(){return checksSession.checksSaveRequested||sharedChecksHasLocalWork()||!!(checksSession.checksCloudBase&&!equalSyncJson(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.checksCloudBase)))}

function composeOrderCloudState(remoteState,currentState=model.state){const next=normalizeState(clone(remoteState));next.checks=clone(currentState.checks||[]);return next}
function applyOrderCloudState(remoteState){const previous=model.state;model.state=composeOrderCloudState(remoteState,previous);domainRevisions?.reconcile(previous,model.state);return model.state}

return { sameBusinessData, prepareCloudState, sameOrderCloudData, hasMeaningfulLocalData, cloudHasLocalWork, checksHaveLocalWork, composeOrderCloudState, applyOrderCloudState };
}
