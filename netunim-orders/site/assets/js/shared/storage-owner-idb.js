// @ts-check
import {readStorageJsonRecord,sealStorageJsonRecord} from './storage-json-codec.js';
import {readStorageState} from './storage-operation.js';
import {equalSyncJson} from './sync-json.js';
import {readStorageOwnerBinding,readStorageOwnerRecord,readStorageOwnerSnapshot,readStorageOwnerPatch,nextStorageOwnerPhase} from './storage-owner-binding.js';
/**
 * @typedef {import('./storage-owner-binding.js').App} App
 * @typedef {import('./storage-owner-binding.js').Binding} Binding
 * @typedef {import('./storage-owner-binding.js').Handoff} Handoff
 * @typedef {import('./storage-owner-binding.js').Phase} Phase
 * @typedef {import('./storage-owner-binding.js').State} State
 * @typedef {import('./storage-owner-binding.js').OwnerSnapshot} Snapshot
 * @typedef {{expectedGeneration:number,at?:string}} Version
 * @typedef {Version & {id:string,intent:'load-account'|'upload-local'}} LocalCommand
 */
/** @param {unknown} value */
function identity(value){if(typeof value!=='string'||!value.trim()||value.trim()!==value||value.length>512)throw new Error('storage_owner_identity_invalid');return value}
/** @param {State} command */
function localCommand(command){const id=identity(command.id),intent=command.intent;if(intent!=='load-account'&&intent!=='upload-local')throw new Error('storage_owner_local_adoption_invalid');return {id,intent}}
/** @param {unknown} value @returns {State & {at:string}} */
function command(value){const data=readStorageState(value);if(data.at!==undefined&&typeof data.at!=='string')throw new Error('storage_owner_timestamp_invalid');return structuredClone({...data,at:data.at??new Date().toISOString()})}
/** @param {Binding|null} binding @param {unknown} expected @returns {Binding} */
function compareGeneration(binding,expected){
  if(!binding)throw new Error('storage_owner_binding_missing');
  if(typeof expected!=='number'||!Number.isSafeInteger(expected)||expected<1)throw new Error('storage_owner_generation_required');
  if(binding.generation!==expected)throw new Error('storage_owner_generation_changed');
  return binding;
}

// Both stores share one transaction. Values are decoded inside that transaction,
// and results become receipts only after oncomplete, never request.onsuccess.
/** @param {{open:()=>Promise<IDBDatabase>}} ports */
export function createStorageOwnerTransactions({open}){
  /** @template {object} T @param {App} app @param {IDBTransactionMode} mode @param {(tx:IDBTransaction,current:Snapshot)=>T} work @returns {Promise<T>} */
  async function transaction(app,mode,work){
    if(app!=='orders'&&app!=='kupa')throw new Error('storage_owner_app_invalid');
    const database=await open();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction(['owner-bindings','owner-handoffs'],mode);
      /** @type {{value:T}|null} */ let outcome=null;
      /** @type {unknown} */ let error=null;
      const binding=tx.objectStore('owner-bindings').get(app),handoff=tx.objectStore('owner-handoffs').get(app);let remaining=2;
      const finish=()=>{
        if(--remaining)return;
        try{
          const current=readStorageOwnerSnapshot({binding:binding.result==null?null:readStorageJsonRecord(binding.result),handoff:handoff.result==null?null:readStorageJsonRecord(handoff.result)},app);
          outcome={value:work(tx,current)};
        }catch(cause){error=cause;try{tx.abort()}catch{reject(cause)}}
      };
      binding.onsuccess=finish;handoff.onsuccess=finish;
      tx.oncomplete=()=>{if(outcome)resolve(outcome.value);else reject(new Error('storage_owner_transaction_unfinished'))};
      tx.onabort=()=>reject(error||tx.error||new Error('storage_owner_transaction_aborted'));
      tx.onerror=()=>{error??=tx.error};
    });
  }
  /** @param {IDBTransaction} tx @param {Binding} binding */
  const putBinding=(tx,binding)=>tx.objectStore('owner-bindings').put(sealStorageJsonRecord(binding),binding.app);
  /** @param {IDBTransaction} tx @param {Handoff} handoff */
  const putHandoff=(tx,handoff)=>tx.objectStore('owner-handoffs').put(sealStorageJsonRecord(handoff),handoff.app);
  /** @param {App} app */
  const readOwnerState=app=>transaction(app,'readonly',(_tx,current)=>current);
  /** @param {App} app @param {string} owner @param {{source?:string,at?:string}} [options] */
  async function initializeOwnerBinding(app,owner,options={}){
    const input=command(options),target=identity(owner);
    return transaction(app,'readwrite',(tx,current)=>{
      if(current.binding){if(current.binding.owner!==target)throw new Error('storage_owner_binding_conflict');return current.binding}
      const next=readStorageOwnerBinding({version:1,app,owner:target,generation:1,source:input.source??'bootstrap',createdAt:input.at,updatedAt:input.at},app);
      putBinding(tx,next);return next;
    });
  }
  /** @param {App} app @param {string} targetOwner @param {LocalCommand} options */
  async function reserveLocalOwnerTarget(app,targetOwner,options){
    const input=command(options),target=identity(targetOwner),{id,intent}=localCommand(input);
    if(target==='local')throw new Error('storage_owner_local_adoption_invalid');
    return transaction(app,'readwrite',(tx,current)=>{
      const binding=compareGeneration(current.binding,input.expectedGeneration),pending=binding.pendingAdoption;
      if(current.handoff&&current.handoff.phase!=='complete')throw new Error('storage_owner_handoff_pending');
      if(binding.owner===target&&!pending)return binding;
      if(binding.owner!=='local')throw new Error('storage_owner_handoff_required');
      if(pending){if(pending.targetOwner!==target||pending.intent!==intent)throw new Error('storage_owner_local_adoption_reserved');return binding}
      const next=readStorageOwnerBinding({...binding,pendingAdoption:{id,targetOwner:target,intent,createdAt:input.at,updatedAt:input.at},updatedAt:input.at},app);
      putBinding(tx,next);return next;
    });
  }
  /** @param {App} app @param {string} targetOwner @param {LocalCommand & {proof?:unknown}} options */
  async function adoptPreparedLocalOwner(app,targetOwner,options){
    const input=command(options),target=identity(targetOwner),{id,intent}=localCommand(input),proof=readStorageState(input.proof??{});
    if(target==='local')throw new Error('storage_owner_local_adoption_invalid');
    return transaction(app,'readwrite',(tx,current)=>{
      const binding=compareGeneration(current.binding,input.expectedGeneration),reservation=binding.pendingAdoption;
      if(binding.owner!=='local')throw new Error('storage_owner_handoff_required');
      if(current.handoff&&current.handoff.phase!=='complete')throw new Error('storage_owner_handoff_pending');
      if(!reservation||reservation.targetOwner!==target||reservation.intent!==intent)throw new Error('storage_owner_local_adoption_not_reserved');
      const next=readStorageOwnerBinding({...binding,owner:target,generation:binding.generation+1,source:`prepared-local:${intent}`,pendingAdoption:null,updatedAt:input.at},app);
      const complete=readStorageOwnerRecord({version:1,id,app,sourceOwner:'local',targetOwner:target,intent,phase:'complete',preparationProof:proof,reservationId:reservation.id,createdAt:reservation.createdAt??input.at,activatedAt:input.at,completedAt:input.at,updatedAt:input.at},app);
      if(!complete)throw new Error('storage_owner_handoff_missing');
      putBinding(tx,next);putHandoff(tx,complete);return {binding:next,handoff:complete};
    });
  }
  /** @param {App} app @param {unknown} record @param {Version} version */
  async function beginOwnerHandoff(app,record,version){
    const input=command(version),plan=readStorageOwnerRecord(record,app);
    if(!plan||plan.phase!=='freezing-source')throw new Error('storage_owner_handoff_invalid');
    return transaction(app,'readwrite',(tx,current)=>{
      const binding=compareGeneration(current.binding,input.expectedGeneration),existing=current.handoff;
      if(existing&&existing.phase!=='complete'){if(equalSyncJson(existing,plan))return existing;throw new Error('storage_owner_handoff_pending')}
      if(plan.sourceOwner!==binding.owner)throw new Error('storage_owner_handoff_invalid');
      const reservation=binding.pendingAdoption;
      if(reservation&&(reservation.targetOwner!==plan.targetOwner||reservation.intent!==plan.intent))throw new Error('storage_owner_local_adoption_reserved');
      putHandoff(tx,plan);return plan;
    });
  }
  /** @param {App} app @param {string} id @param {Phase} from @param {Phase} to @param {State} patch @param {Version} version */
  async function advanceOwnerHandoff(app,id,from,to,patch,version){
    const input=command(version),operation=identity(id),details=readStorageOwnerPatch(patch);
    if(nextStorageOwnerPhase(from)!==to)throw new Error('storage_owner_handoff_phase_invalid');
    return transaction(app,'readwrite',(tx,current)=>{
      compareGeneration(current.binding,input.expectedGeneration);const prior=current.handoff;
      if(!prior||prior.id!==operation||prior.phase!==from)throw new Error('storage_owner_handoff_changed');
      const next=readStorageOwnerRecord({...prior,...details,phase:to},app);if(!next)throw new Error('storage_owner_handoff_missing');
      putHandoff(tx,next);return next;
    });
  }
  /** @param {App} app @param {string} id @param {string} targetOwner @param {Version} options @param {boolean} activate */
  async function finishOwnerHandoff(app,id,targetOwner,options,activate){
    const input=command(options),operation=identity(id),target=identity(targetOwner);
    return transaction(app,'readwrite',(tx,current)=>{
      const binding=compareGeneration(current.binding,input.expectedGeneration),prior=current.handoff;
      if(!prior||prior.id!==operation||prior.targetOwner!==target||prior.phase!==(activate?'target-recovered':'target-active')||binding.owner!==(activate?prior.sourceOwner:target))throw new Error('storage_owner_handoff_changed');
      const next=activate?readStorageOwnerBinding({...binding,owner:target,generation:binding.generation+1,source:`handoff:${prior.intent}`,pendingAdoption:null,updatedAt:input.at},app):binding;
      const handoff=readStorageOwnerRecord({...prior,phase:activate?'target-active':'complete',...(activate?{activatedAt:input.at}:{completedAt:input.at}),updatedAt:input.at},app);
      if(!handoff)throw new Error('storage_owner_handoff_missing');
      if(activate)putBinding(tx,next);putHandoff(tx,handoff);return {binding:next,handoff};
    });
  }
  return {readOwnerState,initializeOwnerBinding,reserveLocalOwnerTarget,adoptPreparedLocalOwner,beginOwnerHandoff,advanceOwnerHandoff,
    readOwnerBinding:async(/** @type {App} */app)=>(await readOwnerState(app)).binding,
    readOwnerHandoff:async(/** @type {App} */app)=>(await readOwnerState(app)).handoff,
    activateOwnerHandoff:(/** @type {App} */app,/** @type {string} */id,/** @type {string} */target,/** @type {Version} */options)=>finishOwnerHandoff(app,id,target,options,true),
    completeOwnerHandoff:(/** @type {App} */app,/** @type {string} */id,/** @type {string} */target,/** @type {Version} */options)=>finishOwnerHandoff(app,id,target,options,false)};
}
