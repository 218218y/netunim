import {createSharedChecksStorageV2} from './shared-checks-storage-v2.js';
import {equalSyncJson} from './cloud-sync.js';

// During cutover, V1 remains authoritative. This observer proves that the
// actual check mutation descriptors replay to the same checks and bank events.
// It never writes to the active cloud document or changes the visible model.
export function createSharedChecksV2Shadow({owner,primary,enabled=()=>false,createStorage=createSharedChecksStorageV2}={}){
  if(typeof owner!=='function'||typeof primary!=='function')throw new Error('shared_checks_shadow_configuration');
  let queue=Promise.resolve(),storage=null,identity='';
  const diagnostics={operations:0,boundaries:0,parityChecks:0,mismatches:0,missingOperations:0,unverifiedBaseline:0,ownerTransitions:0,errors:0,lastError:''};
  function observe(state,{operations=null,generation=0,surface='shared-checks',mutationType='edit',deleteIds=[],boundary=false}={}){
    let observedOwner;
    try{if(!enabled()||!primary())return false;observedOwner=String(owner()||'').trim()}
    catch(error){diagnostics.errors++;diagnostics.lastError=error.message;return false}
    if(!observedOwner)return false;
    // An authentication change is not evidence that the visible V1 state
    // belongs to the new account. A fresh startup or explicit migration must
    // establish that provenance before a new shadow namespace is created.
    if(identity&&identity!==observedOwner){diagnostics.ownerTransitions++;diagnostics.lastError='shared_checks_shadow_owner_handoff_required';return false}
    let snapshot,descriptors;
    try{snapshot=structuredClone(state);descriptors=operations&&structuredClone(operations)}
    catch(error){diagnostics.errors++;diagnostics.lastError=error.message;return false}
    queue=queue.catch(()=>{}).then(async()=>{
      if(!primary()||String(owner()||'').trim()!==observedOwner)return false;
      if(!storage||identity!==observedOwner){identity=observedOwner;storage=createStorage({owner:()=>owner(),primary,role:'shadow'});}
      let restored=storage.ready?await storage.recover():await storage.open();
      if(!restored){
        if(!boundary){diagnostics.unverifiedBaseline++;diagnostics.lastError='shared_checks_shadow_baseline_missing'}
        restored=await storage.open({migrationState:snapshot,migrationIntent:'shadow-observation',sourceOwner:observedOwner});
      }
      if(!restored)throw new Error('shared_checks_shadow_checkpoint_missing');
      if(boundary){
        if(!equalSyncJson(restored.state,snapshot)){await storage.replaceAuthoritativeState(snapshot);diagnostics.boundaries++}
        return true;
      }
      if(equalSyncJson(restored.state,snapshot))return true;
      if(!Array.isArray(descriptors)||!descriptors.length){
        diagnostics.missingOperations++;diagnostics.lastError='shared_checks_shadow_operations_missing';
        await storage.replaceAuthoritativeState(snapshot);diagnostics.boundaries++;
        return true;
      }
      try{
        const write=storage.append(descriptors,snapshot,{generation,surface,mutationType,deleteIds});await write.committed;
        const replayed=await storage.recover();diagnostics.parityChecks++;
        if(!equalSyncJson(replayed.state,snapshot))throw new Error('shared_checks_shadow_parity_mismatch');
        diagnostics.operations++;
      }catch(error){
        diagnostics.mismatches++;diagnostics.lastError=error.message;
        await storage.replaceAuthoritativeState(snapshot);diagnostics.boundaries++;
      }
      return true;
    }).catch(error=>{diagnostics.errors++;diagnostics.lastError=error.message;return false});
    return true;
  }
  return {observe,flush:()=>queue,diagnostics};
}

export function createSharedChecksObserver({readState,...options}={}){
  if(typeof readState!=='function')throw new Error('shared_checks_observer_state_required');
  const shadow=createSharedChecksV2Shadow(options);
  return {...shadow,
    mutation:(operations,metadata)=>shadow.observe(readState(),{operations,...metadata}),
    boundary:()=>shadow.observe(readState(),{boundary:true}),
  };
}
