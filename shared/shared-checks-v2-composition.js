import {createSharedChecksV2Runtime} from './shared-checks-v2-runtime.js';
import {createStorageV2Boundary} from './storage-v2-boundary.js';
import {createStorageV2Cutover} from './storage-v2-cutover.js';
import {isStorageV2ActivationCached} from './storage-v2-activation-cache.js';
import {verifyStorageV2LocalEngine} from './storage-v2-local-birth.js';
import {createStorageJournalDb} from './storage-journal-idb.js';
import {createSharedChecksStorageV2} from './shared-checks-storage-v2.js';

// Application-specific ports are supplied by each composition root. Primary
// starts only after the durable V2 namespace has been verified. A local V2
// birth does not inspect abandoned V1 data; account adoption verifies its
// cloud heads before the displayed owner changes.
export function createSharedChecksV2Composition({site,owner,primary,preparing=()=>false,model,checksSession,eventsKey,domainRevisions,merge,readRemote,rpc,validateMainCloud,applyMainState,main,db=createStorageJournalDb()}={}){
  const cutover=createStorageV2Cutover({app:site,owner,primary,db});
  const cutoverRequested=()=>isStorageV2ActivationCached(site,owner());
  const preparationRequested=()=>!!preparing()&&!cutoverRequested();
  // Routing must switch to V2 as soon as its durable marker/preparation exists.
  // Recovery may still be in progress (or a DB capability check may fail), but
  // background polls must not use an unverified or incomplete V2 head.
  const runtime=createSharedChecksV2Runtime({site,owner,primary,mode:()=>cutoverRequested()?'primary':preparationRequested()?'preparing':'off',
    readState:()=>({checks:model.state.checks,bankEvents:checksSession[eventsKey]||[]}),
    applyState:value=>{model.state.checks=value.checks;checksSession[eventsKey]=value.bankEvents;domainRevisions.touch('checks')},
    merge,readRemote,rpc,createStorage:options=>createSharedChecksStorageV2({...options,db})});
  const boundary=createStorageV2Boundary({owner,primary,main,shared:runtime,validateMainCloud,db});
  main.setBoundaryGate?.(()=>boundary.locked);
  runtime.setBoundaryGate(()=>boundary.locked);
  function lockPreparation(){
    if(!preparationRequested()||!primary())return false;
    return true;
  }
  async function recoverPrimary(){
    if(!cutoverRequested()&&!preparationRequested())return false;
    // The durable marker is authoritative; abandoned V1 records do not gate
    // a recovered V2 journal. An unmarked preparation remains read-only.
    if(cutoverRequested()&&owner()!=='local'&&!await cutover.verify())throw new Error('storage_cutover_marker_missing');
    if(cutoverRequested()&&owner()==='local'&&!await verifyStorageV2LocalEngine({app:site,owner,db}))throw new Error('storage_local_engine_marker_missing');
    const recovered=await runtime.recover();
    if(!recovered){if(preparationRequested())return false;throw new Error('shared_checks_primary_checkpoint_missing')}
    const interrupted=await boundary.pending();
    await boundary.resume();
    if(interrupted){
      if(typeof applyMainState!=='function')throw new Error('storage_boundary_main_hydration_required');
      const mainRecovered=await main.recoverForOwner({intent:'load-account'});
      if(!mainRecovered)throw new Error('storage_boundary_main_recovery_failed');
      applyMainState(mainRecovered.state);
      await runtime.recover();
    }
    return true;
  }
  return {runtime,boundary,lockPreparation,recoverPrimary,verifyCutover:cutover.verify,markCutover:cutover.mark};
}
