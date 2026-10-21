// @ts-check
import {beginMeasure} from '../shared/runtime-performance.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {createLocalMutationAdmission,hasFailedLocalMutation} from '../shared/local-mutation-admission.js';

/**
 * @typedef {{localGeneration:number,localUndurableGenerations?:Set<number|string>,cloudSaveRequested?:boolean,cloudSaveMessage?:string}} SaveSession
 * @typedef {{deleteIntents?:object,mutationType?:string,surface?:string,domains?:string[]|null,operations?:unknown[]|null}} SaveOptions
 * @typedef {{generation:number,localOk:boolean,accepted:boolean,committed:Promise<unknown>|null,current?:()=>boolean}} LocalReceipt
 * @typedef {{setSave:(message:string,mode:string,title?:string)=>unknown,setCloud:(message:string,mode:string)=>unknown,folderSaveTitle:()=>string}} SaveView
 * @typedef {{localSnapshot:(state:undefined,options:SaveOptions&{generation:number})=>boolean,storageV2CommitPromise:()=>Promise<unknown>,storageV2DurabilityAtRisk:()=>boolean,confirmVisibleState?:()=>Promise<boolean>}} SaveJournal
 */

/** @param {{access:{primary:()=>boolean,error:()=>{message:string}|null|undefined,showSecondaryTabGuard:()=>unknown,mutationScope?:()=>unknown},session:SaveSession,journal:SaveJournal,projection:{touch:(domains:string[])=>unknown,touchAll:()=>unknown},view:SaveView,platform:{reload:()=>unknown}}} ports */
export function createOrdersLocalCommit({access,session,journal,projection,view,platform}) {
  const tasks=createRuntimeTaskOwner();
  const admission=createLocalMutationAdmission({session,scope:access.mutationScope??(()=>null),onFailure:()=>{
    if(!tasks.isActive())return;
    view.setSave('שינוי לא נשמר — אין לסגור את החלון; ייצא JSON לשמירת הטיוטה','error');
    view.setCloud('ענן: השמירה נעצרה — אחסון מקומי נכשל','error');
  }});
  const canMutate=()=>tasks.isActive()&&access.primary()&&!access.error();
  function rejectSecondaryAction() {
    if (!tasks.isActive()) return true;
    if (access.primary()) return false;
    access.showSecondaryTabGuard();
    return true;
  }
  function rejectSecondaryMutation() {
    if (!tasks.isActive()) return true;
    const error=access.error();
    if (error) { view.setCloud(error.message,'error'); return true; }
    if (access.primary()) return false;
    access.showSecondaryTabGuard();
    platform.reload();
    return true;
  }
  /** @param {SaveOptions} [options] @returns {LocalReceipt|null} */
  function accept({deleteIntents={},mutationType='autosave',surface='orders',domains=null,operations=null}={}) {
    if (rejectSecondaryMutation()) return null;
    const done=beginMeasure('orders:save-local',{paint:true});
    const generation=++session.localGeneration;
    const receipt=admission.admit(generation,()=>{
      if (domains?.length) projection.touch(domains); else projection.touchAll();
      const localOk=journal.localSnapshot(undefined,{operations,generation,mutationType,surface,deleteIntents});
      const accepted=localOk||journal.storageV2DurabilityAtRisk();
      return {localOk,accepted,committed:accepted?journal.storageV2CommitPromise():null};
    });
    done();
    const proof=journal.confirmVisibleState;
    if(proof){
      receipt.committed=receipt.committed.then(async confirmed=>{
        if(confirmed&&receipt.current()&&hasFailedLocalMutation(session))await admission.reconcile(proof);
        return confirmed;
      });
      receipt.settled=receipt.committed.catch(()=>false);
    }
    void tasks.run(async()=>{
      if(await receipt.settled&&receipt.current()&&tasks.isActive()&&generation===session.localGeneration&&!hasFailedLocalMutation(session))view.setSave('מקומי: שמור','',view.folderSaveTitle());
    });
    return {generation,...receipt};
  }
  return {accept,canMutate,rejectSecondaryAction,rejectSecondaryMutation,drain:tasks.drain,dispose:tasks.close};
}
