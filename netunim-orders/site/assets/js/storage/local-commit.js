// @ts-check
import {beginMeasure} from '../shared/runtime-performance.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';

/**
 * @typedef {{localGeneration:number,localUndurableGenerations?:Set<number>,cloudSaveRequested?:boolean,cloudSaveMessage?:string}} SaveSession
 * @typedef {{deleteIntents?:object,mutationType?:string,surface?:string,domains?:string[]|null,operations?:unknown[]|null}} SaveOptions
 * @typedef {{generation:number,localOk:boolean,accepted:boolean,committed:Promise<unknown>|null}} LocalReceipt
 * @typedef {{setSave:(message:string,mode:string,title?:string)=>unknown,setCloud:(message:string,mode:string)=>unknown,folderSaveTitle:()=>string}} SaveView
 * @typedef {{localSnapshot:(state:undefined,options:SaveOptions&{generation:number})=>boolean,storageV2CommitPromise:()=>Promise<unknown>,storageV2DurabilityAtRisk:()=>boolean}} SaveJournal
 */

/** @param {{access:{primary:()=>boolean,error:()=>{message:string}|null|undefined,showSecondaryTabGuard:()=>unknown},session:SaveSession,journal:SaveJournal,projection:{touch:(domains:string[])=>unknown,touchAll:()=>unknown},view:SaveView,platform:{reload:()=>unknown}}} ports */
export function createOrdersLocalCommit({access,session,journal,projection,view,platform}) {
  const tasks=createRuntimeTaskOwner();
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
    if (domains?.length) projection.touch(domains); else projection.touchAll();
    const done=beginMeasure('orders:save-local',{paint:true});
    const generation=++session.localGeneration;
    let localOk;
    try { localOk=journal.localSnapshot(undefined,{operations,generation,mutationType,surface,deleteIntents}); }
    finally { done(); }
    const accepted=localOk||journal.storageV2DurabilityAtRisk();
    const candidate=accepted?journal.storageV2CommitPromise():null;
    const committed=typeof candidate?.then==='function'?candidate:null;
    if (!localOk) (session.localUndurableGenerations??=new Set()).add(generation);
    if (committed) void tasks.run(async()=>{
      try {
        const confirmed=await committed;
        if (confirmed!==true) throw new Error('storage_local_commit_unconfirmed');
        session.localUndurableGenerations?.delete(generation);
        if (tasks.isActive()&&generation===session.localGeneration) view.setSave('מקומי: שמור','',view.folderSaveTitle());
      } catch {
        if (!tasks.isActive()) return;
        view.setSave('השינוי לא נשמר באחסון הדפדפן — אין לסגור את החלון','error');
        view.setCloud('ענן: השמירה נעצרה — אחסון מקומי נכשל','error');
      }
    });
    return {generation,localOk,accepted,committed};
  }
  return {accept,canMutate,rejectSecondaryAction,rejectSecondaryMutation,drain:tasks.drain,dispose:tasks.close};
}
