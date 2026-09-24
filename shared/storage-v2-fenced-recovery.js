import {createStorageJournalDb} from './storage-journal-idb.js';
import {createStorageV2Cutover} from './storage-v2-cutover.js';
import {equalSyncJson} from './cloud-sync.js';
import {validateSharedChecksState} from './shared-checks-storage-v2.js';

const revision=row=>Number.isSafeInteger(Number(row?.revision))&&Number(row.revision)>=0?Number(row.revision):null;
const protocol2=state=>[state?.orders,state?.kupa,state?.sharedChecks].every(value=>value===2);

// Used only for an authenticated account whose server fence is already active
// and whose browser has no account cutover marker. No local V1 value becomes a
// source for the new checkpoint or a cloud RPC. The old keys remain untouched
// for a later, explicit recovery/export tool.
export function createStorageV2FencedRecovery({app,owner,primary,authenticatedOwner,readProtocolState,
  readMainRemote,projectMainRemote,readSharedRemote,projectSharedRemote,composeMainState,
  projectMainState,validateMainState,validateMainCloud,db=createStorageJournalDb(),storage=globalThis.localStorage}={}){
  if(!['orders','kupa'].includes(app)||[owner,primary,authenticatedOwner,readProtocolState,readMainRemote,projectMainRemote,
    readSharedRemote,projectSharedRemote,composeMainState,projectMainState,validateMainState,validateMainCloud].some(fn=>typeof fn!=='function'))throw new Error('storage_fenced_recovery_configuration');
  const cutover=createStorageV2Cutover({app,owner,primary,db,storage});
  function guard(identity){
    if(!primary())throw new Error('storage_fenced_recovery_primary_required');
    if(identity==='local'||!identity||owner()!==identity||authenticatedOwner()!==identity)throw new Error('storage_fenced_recovery_owner_changed');
    if(globalThis.navigator?.onLine===false)throw new Error('storage_fenced_recovery_online_required');
  }
  async function recover(){
    const identity=String(owner()||'').trim();guard(identity);
    if(await cutover.verify())return {already:true};
    if(!protocol2(await readProtocolState()))throw new Error('storage_fenced_recovery_protocol_required');guard(identity);
    const [mainRow,sharedRow]=await Promise.all([readMainRemote(),readSharedRemote()]);guard(identity);
    if(!mainRow||!sharedRow||revision(mainRow)===null||revision(sharedRow)===null)throw new Error('storage_fenced_recovery_remote_missing');
    const mainCloud=projectMainRemote(mainRow),sharedRaw=projectSharedRemote(sharedRow);
    const sharedState={checks:structuredClone(sharedRaw?.checks),bankEvents:structuredClone(sharedRaw?.bankEvents)};
    validateSharedChecksState(sharedState);validateMainCloud(mainCloud);
    const mainState=composeMainState(mainCloud,sharedState);validateMainState(mainState);
    if(!equalSyncJson(projectMainState(mainState),mainCloud))throw new Error('storage_fenced_recovery_main_projection_changed');
    // Recheck authorization and the server fence immediately before the local
    // transaction. A remote revision may advance later; ordinary V2 sync then
    // reads it. It can never upload the discarded legacy state.
    if(!protocol2(await readProtocolState()))throw new Error('storage_fenced_recovery_protocol_changed');guard(identity);
    await db.adoptFencedAccount(app,identity,{mainState,mainCloudState:mainCloud,mainRevision:revision(mainRow),sharedState,sharedRevision:revision(sharedRow)});
    guard(identity);if(!await cutover.verify())throw new Error('storage_fenced_recovery_marker_missing');
    return {already:false,mainRevision:revision(mainRow),sharedRevision:revision(sharedRow)};
  }
  return {recover};
}
