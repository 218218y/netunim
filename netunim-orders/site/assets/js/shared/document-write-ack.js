// @ts-check
import {equalSyncJson} from './sync-json.js';

/** @typedef {import('./storage-json.js').StorageJsonObject} StorageJsonObject */
/** @typedef {{revision: number, operationRevision: number | null, replayed: boolean}} DocumentAckRevision */
/**
 * @template {StorageJsonObject} State
 * @typedef {DocumentAckRevision & {state: State}} DocumentWriteAck
 */
/**
 * @typedef {object} RevisionOptions
 * @property {number} [baseRevision]
 * @property {unknown} [authoritativeState]
 * @property {unknown} [sentState]
 * @property {(a: unknown, b: unknown) => boolean} [equalState]
 * @property {string} [errorCode]
 */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}

// Revision policy is also exported through cloud-sync for existing consumers.
// It is metadata evidence only: it does not validate a document or grant ACK.
/** @param {unknown} row @param {RevisionOptions} [options] @returns {DocumentAckRevision} */
export function documentWriteAckRevision(row,{baseRevision,authoritativeState,sentState,equalState=equalSyncJson,errorCode='document_write_ack_revision_invalid'}={}){
  const record=object(row)?row:null;
  const base=Number(baseRevision),revision=Number(record?.revision),hasOperationRevision=record?.operation_revision!==undefined&&record?.operation_revision!==null,
    operationRevision=hasOperationRevision?Number(record?.operation_revision):null,replayed=record?.operation_replayed===true;
  /** @returns {never} */
  const invalid=()=>{throw new Error(errorCode)};
  if(!Number.isSafeInteger(base)||base<0||!Number.isSafeInteger(revision)||revision<base)invalid();
  if(operationRevision!==null){
    if(!Number.isSafeInteger(operationRevision)||operationRevision<base||operationRevision>revision||operationRevision>base+1)invalid();
    if(record?.operation_replayed===false&&operationRevision!==revision)invalid();
  }
  // V6 proves an identical-state no-op with operation_revision. Legacy replies
  // without that field are accepted only when their state is exactly the send.
  if(revision===base&&!(operationRevision!==null&&operationRevision===base)&&!equalState(authoritativeState,sentState))invalid();
  return {revision,operationRevision,replayed};
}

/**
 * @template {StorageJsonObject} State
 * @param {unknown} row Untrusted Main RPC response; replay returns the current head.
 * @param {object} options
 * @param {number} options.baseRevision
 * @param {State} options.sentState
 * @param {(raw: Record<string, unknown>) => State} options.prepareState Domain-owned synchronous projection; checkpoint validation retains its owner.
 * @param {(a: State, b: State) => boolean} [options.equalState]
 * @param {string} [options.errorCode]
 * @param {string} [options.stateErrorCode]
 * @returns {DocumentWriteAck<State>}
 */
export function readDocumentWriteAck(row,{baseRevision,sentState,prepareState,equalState=equalSyncJson,errorCode='document_write_ack_revision_invalid',stateErrorCode='document_write_ack_state_invalid'}){
  // Never substitute the sent snapshot: a replay may acknowledge an earlier
  // operation while returning a later head written by another computer.
  if(!object(row)||!Object.hasOwn(row,'state')||!object(row.state))throw new Error(stateErrorCode);
  const state=prepareState(row.state);
  if(!object(state))throw new Error(stateErrorCode);
  const receipt=documentWriteAckRevision(row,{baseRevision,authoritativeState:state,sentState,equalState:()=>equalState(state,sentState),errorCode});
  return {...receipt,state};
}
