import {createStorageJournal} from './storage-journal.js';
import {equalSyncJson} from './cloud-sync.js';
import {beginMeasure,recordPerformanceValue} from './runtime-performance.js';

export const STORAGE_SCHEMAS=Object.freeze({
  orders:{collections:['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes','checks'],fields:['inventoryCategoryOrder']},
  kupa:{collections:['cash','rights','notes','checks','credits','expenses','cards'],fields:['rightsLastCalculatedDate','cashflowSettings','bank','creditSync']},
});
export function storageShadowEnabled(){try{return globalThis.localStorage?.getItem('netunim-storage-v2-shadow')==='1'}catch{return false}}

// Opt-in rollout adapter. V1 remains authoritative. Unknown mutation owners,
// imports, remote applies and ACK snapshots establish a full checkpoint boundary;
// they are never guessed from a full-state diff or silently omitted from replay.
export function createStorageShadow({app,owner,primary,validate,enabled=storageShadowEnabled,createJournal=createStorageJournal,schedule=callback=>setTimeout(callback,250)}={}){
  let latest=null,batches=[],boundary=false,scheduled=false,running=null,journal=null,identity='',count=0;
  const diagnostics={mode:'disabled',operations:0,checkpoints:0,explicitBoundaries:0,contractViolations:0,parityChecks:0,mismatches:0,startupChecks:0,startupDifferences:0,errors:0,lastError:''};
  function observe(snapshot,{operations=null,storageBoundary='',generation=0,surface='',mutationType='autosave',deleteIntents={}}={}){
    if(!enabled()||!primary())return false;
    diagnostics.mode='shadow';const {_meta,...business}=snapshot;
    const current=owner();if(latest&&latest.owner!==current){batches=[];boundary=true}
    latest={state:business,owner:current};
    const typed=Array.isArray(operations)&&operations.length>0,declaredBoundary=typeof storageBoundary==='string'&&storageBoundary.trim();
    if(typed&&declaredBoundary){diagnostics.contractViolations++;diagnostics.lastError='storage_mutation_contract_ambiguous';boundary=true}
    else if(declaredBoundary||['restore','import'].includes(mutationType)){boundary=true;diagnostics.explicitBoundaries++}
    else if(!typed){boundary=true;diagnostics.contractViolations++;diagnostics.lastError='storage_mutation_contract_required'}
    else batches.push({changes:operations.map(change=>change.type==='put'?{...change,record:structuredClone(business[change.collection]?.find(row=>row.id===change.id))}:structuredClone(change)),generation,surface,mutationType,deleteIntents:structuredClone(deleteIntents)});
    if(batches.length>128){boundary=true;batches=[];diagnostics.explicitBoundaries++}
    if(!scheduled&&!running){scheduled=true;schedule(()=>{scheduled=false;void flush()})}
    return true;
  }
  async function flush(){
    if(running)return running;if(!latest)return true;
    const job=latest,batch=batches,checkpoint=boundary;latest=null;batches=[];boundary=false;
    running=(async()=>{
      if(!primary()||job.owner!==owner())return false;
      if(!journal||identity!==job.owner){
        identity=job.owner;journal=createJournal({owner:identity+':'+app,schema:STORAGE_SCHEMAS[app],validate,primary:()=>primary()&&identity===owner()});
        const restored=await journal.open();
        // V1 may have advanced while shadow was disabled. Record that difference
        // before establishing a new boundary; never select shadow as authority.
        if(restored){diagnostics.startupChecks++;if(!equalSyncJson(restored.state,job.state))diagnostics.startupDifferences++}
      }
      if(!journal.ready||checkpoint){await journal.install(job.state);diagnostics.checkpoints++;count=0;return true}
      for(const operation of batch){const write=journal.append(operation.changes,operation);await write.committed;diagnostics.operations++;count++}
      const done=beginMeasure('storage:shadow-parity');let recovered;
      try{recovered=await journal.recover();diagnostics.parityChecks++;if(!equalSyncJson(recovered.state,job.state)){diagnostics.mismatches++;throw new Error('storage_shadow_parity_mismatch')}}finally{done()}
      if(count>=128){await journal.compact();diagnostics.checkpoints++;count=0}
      recordPerformanceValue('storage:shadow:journal-operations',count);return true;
    })().catch(error=>{diagnostics.errors++;diagnostics.lastError=error.message;diagnostics.mode='shadow-error';boundary=true;return false}).finally(()=>{running=null;if(latest&&!scheduled){scheduled=true;schedule(()=>{scheduled=false;void flush()})}});
    return running;
  }
  return {observe,flush,diagnostics};
}
