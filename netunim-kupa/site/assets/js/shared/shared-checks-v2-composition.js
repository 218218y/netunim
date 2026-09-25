import {createSharedChecksV2Runtime} from './shared-checks-v2-runtime.js';
import {createStorageV2Boundary} from './storage-v2-boundary.js';
import {createStorageV2Cutover,storageCutoverKey} from './storage-v2-cutover.js';
import {createStorageJournalDb} from './storage-journal-idb.js';
import {createSharedChecksStorageV2} from './shared-checks-storage-v2.js';

// Application-specific ports are supplied by each composition root. Primary
// starts only after the existing local V2 namespace and clean V1 head have
// been verified; no displayed account state is promoted implicitly.
export function createSharedChecksV2Composition({site,owner,primary,preparing=()=>false,model,checksSession,eventsKey,domainRevisions,merge,readRemote,rpc,verifyLegacyClean,validateMainCloud,applyMainState,main,db=createStorageJournalDb()}={}){
  const cutover=createStorageV2Cutover({app:site,owner,primary,db});
  const cutoverRequested=()=>localStorage.getItem(storageCutoverKey(site,owner()))==='2'||owner()==='local'&&localStorage.getItem(`netunim-storage-engine-version:${site}:local`)==='2';
  const preparationRequested=()=>!!preparing()&&!cutoverRequested();
  // Routing must switch to V2 as soon as its durable marker/preparation exists.
  // Recovery may still be in progress (or a DB capability check may fail), but
  // background polls must never manufacture a legacy outbox in that window.
  const runtime=createSharedChecksV2Runtime({site,owner,primary,mode:()=>cutoverRequested()?'primary':preparationRequested()?'preparing':'off',
    readState:()=>({checks:model.state.checks,bankEvents:checksSession[eventsKey]||[]}),
    applyState:value=>{model.state.checks=value.checks;checksSession[eventsKey]=value.bankEvents;domainRevisions.touch('checks')},
    merge,readRemote,rpc,verifyLegacyClean,createStorage:options=>createSharedChecksStorageV2({...options,db})});
  const boundary=createStorageV2Boundary({owner,primary,main,shared:runtime,validateMainCloud,db});
  main.setBoundaryGate?.(()=>boundary.locked);
  runtime.setBoundaryGate(()=>boundary.locked);
  function lockPreparation(){
    if(!preparationRequested()||!primary())return false;
    return true;
  }
  async function enablePreparation(){
    if(!lockPreparation())return false;
    if(await verifyLegacyClean()!==true)throw new Error('shared_checks_legacy_pending_unverified');
    return true;
  }
  async function recoverPrimary(){
    if(!cutoverRequested()&&!preparationRequested())return false;
    // Fenced cloud adoption marks obsolete V1 pending inactive atomically with
    // both V2 heads. Ordinary cutover still requires a clean legacy source.
    if(!(cutoverRequested()&&await cutover.legacyInactive())&&await verifyLegacyClean()!==true)
      throw new Error('shared_checks_legacy_pending_unverified');
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
  return {runtime,boundary,lockPreparation,enablePreparation,recoverPrimary,verifyCutover:cutover.verify,markCutover:cutover.mark};
}
