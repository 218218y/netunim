import {createSharedChecksV2Runtime} from './shared-checks-v2-runtime.js';
import {createStorageV2Boundary} from './storage-v2-boundary.js';
import {createStorageV2Cutover,storageCutoverKey} from './storage-v2-cutover.js';

// Application-specific ports are supplied by each composition root. Primary
// starts only after the existing local V2 namespace and clean V1 head have
// been verified; no displayed account state is promoted implicitly.
export function createSharedChecksV2Composition({site,owner,primary,model,checksSession,eventsKey,domainRevisions,merge,readRemote,rpc,verifyLegacyClean,validateMainCloud,main}={}){
  let enabled=false;
  const cutover=createStorageV2Cutover({app:site,owner,primary});
  const cutoverRequested=()=>localStorage.getItem(storageCutoverKey(site,owner()))==='2';
  const runtime=createSharedChecksV2Runtime({site,owner,primary,mode:()=>enabled?'primary':'off',
    readState:()=>({checks:model.state.checks,bankEvents:checksSession[eventsKey]||[]}),
    applyState:value=>{model.state.checks=value.checks;checksSession[eventsKey]=value.bankEvents;domainRevisions.touch('checks')},
    merge,readRemote,rpc,verifyLegacyClean});
  const boundary=createStorageV2Boundary({owner,primary,main,shared:runtime,validateMainCloud});
  main.setBoundaryGate?.(()=>boundary.locked);
  runtime.setBoundaryGate(()=>boundary.locked);
  async function recoverPrimary(){
    if(!cutoverRequested())return false;
    if(await verifyLegacyClean()!==true)throw new Error('shared_checks_legacy_pending_unverified');
    enabled=true;
    const recovered=await runtime.recover();
    if(!recovered)throw new Error('shared_checks_primary_checkpoint_missing');
    await boundary.resume();
    return true;
  }
  return {runtime,boundary,recoverPrimary,verifyCutover:cutover.verify,markCutover:cutover.mark};
}
