import {equalSyncJson} from '../shared/cloud-sync.js';
import {BROWSER_STATE_KEY,BROWSER_STATE_IDB_KEY,SHARED_CHECKS_BASE_KEY,SHARED_CHECKS_EVENTS_KEY,INITIAL_STATE} from '../state/constants.js';
import {normalizeSharedChecks,normalizeSharedBankEvents} from '../domains/checks/model.js';
import {notesSheetHasMeaningfulData} from '../domains/notes/sheet-model.js';

// The V1 browser fallback repairs its caches. Migration must only read: once
// the source is frozen in the birth plan a restart may not rediscover V1.
export function createLegacyLocalBirthSource({storage=globalThis.localStorage,idbGet,normalizeState}={}){
  if(typeof idbGet!=='function'||typeof normalizeState!=='function')throw new Error('kupa_local_birth_source_configuration');
  function readJson(key){const text=storage.getItem(key);if(text==null)return null;try{return JSON.parse(text)}catch{throw new Error('kupa_local_birth_legacy_json_invalid')}}
  function snapshot(value){
    if(value==null)return null;
    if(!value||typeof value!=='object'||Array.isArray(value)||!value.state||!Number.isSafeInteger(Number(value.snapshotSeq||0))||Number(value.snapshotSeq||0)<0)throw new Error('kupa_local_birth_snapshot_invalid');
    return {seq:Number(value.snapshotSeq||0),rawState:structuredClone(value.state)};
  }
  return async function readLegacyLocalMigrationSource(){
    const local=snapshot(readJson(BROWSER_STATE_KEY));
    // Opening an absent V1 database creates it. Fresh installs on browsers
    // supporting enumeration can prove absence without creating legacy state.
    const databases=globalThis.indexedDB?.databases;
    const legacyExists=typeof databases==='function'
      ?(await databases.call(globalThis.indexedDB)).some(entry=>entry?.name==='kupa-portable-handles')
      :true;
    const durable=legacyExists?snapshot(await idbGet('sync',BROWSER_STATE_IDB_KEY)):null;
    if(local&&durable&&local.seq===durable.seq&&!equalSyncJson(local.rawState,durable.rawState))throw new Error('kupa_local_birth_snapshot_divergence');
    const selected=!local?durable:!durable?local:local.seq>=durable.seq?local:durable;
    const legacyBase=readJson(SHARED_CHECKS_BASE_KEY);
    if(legacyBase!=null&&!Array.isArray(legacyBase))throw new Error('kupa_local_birth_checks_invalid');
    const mainState=selected?normalizeState(selected.rawState):normalizeState(INITIAL_STATE);
    const checks=selected?mainState.checks:normalizeSharedChecks(legacyBase||[]);
    const events=readJson(SHARED_CHECKS_EVENTS_KEY);
    if(events!=null&&!Array.isArray(events))throw new Error('kupa_local_birth_bank_events_invalid');
    mainState.checks=normalizeSharedChecks(checks);
    const workbook=selected?.rawState?.notesSheet;
    return {mainState,sharedState:{checks:normalizeSharedChecks(checks),bankEvents:normalizeSharedBankEvents(events||[])},auxiliaryState:notesSheetHasMeaningfulData(workbook)?{workbook}:null};
  };
}
