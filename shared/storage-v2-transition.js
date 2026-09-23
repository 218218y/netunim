import {createStorageV2BootstrapExecutor} from './storage-v2-bootstrap.js';
import {createStorageV2CutoverCoordinator} from './storage-v2-cutover-coordinator.js';

// Composes the durable bootstrap group with the durable cutover preparation.
// Beginning is explicit; startup only resumes a preparation that already
// exists, so merely deploying the code never opts an owner into V2-only.
export function createStorageV2Transition({app,owner,primary=()=>true,bootstrapCoordinator,cutoverDb,initializeMain,initializeShared,syncMain,syncShared,verifyBootstrap,freeze=async()=>{},discoverBootstrap,drainLegacy,verifyLegacyClean,verifyHeads,markCutover,verifyCutover}={}){
  if(!bootstrapCoordinator)throw new Error('storage_transition_bootstrap_required');
  const executor=createStorageV2BootstrapExecutor({coordinator:bootstrapCoordinator,primary,initializeMain,initializeShared,syncMain,syncShared,verify:verifyBootstrap});
  const cutover=createStorageV2CutoverCoordinator({app,owner,primary,...(cutoverDb?{db:cutoverDb}:{}),bootstrapExecutor:executor,
    resumePendingBootstrap:async record=>{
      const group=await bootstrapCoordinator.load();
      if(!group)return null;
      if(group.id!==record.id){if(group.phase!=='complete')throw new Error('storage_cutover_foreign_bootstrap_pending');return null}
      return executor.resume();
    },
    freeze,discoverBootstrap,drainLegacy,verifyLegacyClean,verifyHeads,markCutover,verifyCutover});
  async function hydrate(){await bootstrapCoordinator.load();return cutover.hydrate()}
  async function resume(){if(!cutover.ready)await hydrate();return cutover.preparing?cutover.run():null}
  async function begin(){if(!cutover.ready)await hydrate();return cutover.run()}
  return {hydrate,resume,begin,executor,cutover,get ready(){return bootstrapCoordinator.ready&&cutover.ready},get preparing(){return cutover.preparing||bootstrapCoordinator.hasGroup&&bootstrapCoordinator.group?.phase!=='complete'},get record(){return cutover.record},get bootstrapGroup(){return bootstrapCoordinator.group}};
}
