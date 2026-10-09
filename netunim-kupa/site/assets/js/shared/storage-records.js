// @ts-check

/**
 * Current writer contracts. Sealing validates JSON; domain/schema validation
 * and all historical readers remain at their existing owners.
 * @typedef {import('./storage-json.d.ts').StorageJson} StorageJson
 * @typedef {import('./storage-json.d.ts').StorageJsonObject} StorageJsonObject
 * @typedef {{owner:string,epoch:string}} StorageScope
 * @typedef {{[collection:string]:string[]}} StorageDeleteIntents
 * @typedef {{type:'set',field:string,value:StorageJson}} StorageSetChange
 * @typedef {{type:'delete',collection:string,id:string}} StorageDeleteChange
 * @typedef {{type:'replace-state',state:StorageJsonObject}} StorageReplaceStateChange
 * @typedef {{type:'put',collection:string,id:string,record:StorageJsonObject & {id:string}} & ({mode:'insert',index:number}|{mode:'replace',index?:number})} StoragePutChange
 * @typedef {StorageSetChange|StorageDeleteChange|StorageReplaceStateChange|StoragePutChange} StorageChange
 * @typedef {StorageScope & {version:2,seq:number,generation:number,operationId:string,at:string,surface:string,mutationType:string,changes:StorageChange[],deleteIntents:StorageDeleteIntents,appMetadata:StorageJsonObject}} StorageJournalRecord
 */

/**
 * @template {StorageJsonObject} State
 * @typedef {StorageScope & {version:2,seq:number,state:State,appMetadata:StorageJsonObject,savedAt:string}} StorageCheckpoint
 */
/**
 * @template {StorageJsonObject} State
 * @typedef {StorageScope & {version:2,revision:number,state:State,projection:'cloud',ackSeq:number}} StorageCloudBase
 */
/**
 * @template {StorageJsonObject} State
 * @typedef {StorageScope & {version:2,operationId:string,baseRevision:number,startSeq:number,endSeq:number,snapshot:State,deleteIntents:StorageDeleteIntents,generation:number,mutationType:string,surface:string,audit?:StorageJsonObject}} StorageCloudFlight
 */

// Property order is part of the sealed bytes/checksum. Keep these constructors
// equivalent to the existing version-2 writers; do not add defaults or clones.
/**
 * @template {StorageJsonObject} State
 * @param {Omit<StorageCheckpoint<State>,'version'>} input
 * @returns {StorageCheckpoint<State>}
 */
export function createStorageCheckpoint({owner,epoch,seq,state,appMetadata,savedAt}){
  return {version:2,owner,epoch,seq,state,appMetadata,savedAt};
}

/** @param {Omit<StorageJournalRecord,'version'>} input @returns {StorageJournalRecord} */
export function createStorageJournalRecord({owner,epoch,seq,generation,operationId,at,surface,mutationType,changes,deleteIntents,appMetadata}){
  return {version:2,owner,epoch,seq,generation,operationId,at,surface,mutationType,changes,deleteIntents,appMetadata};
}

/**
 * @template {StorageJsonObject} State
 * @param {Omit<StorageCloudBase<State>,'version'|'projection'>} input
 * @returns {StorageCloudBase<State>}
 */
export function createStorageCloudBase({owner,epoch,revision,state,ackSeq}){
  return {version:2,owner,epoch,revision,state,projection:'cloud',ackSeq};
}

/**
 * Audit is attached by its existing owner before sealing the immutable flight.
 * @template {StorageJsonObject} State
 * @param {Omit<StorageCloudFlight<State>,'version'|'audit'>} input
 * @returns {StorageCloudFlight<State>}
 */
export function createStorageCloudFlight({owner,epoch,operationId,baseRevision,startSeq,endSeq,snapshot,deleteIntents,generation,mutationType,surface}){
  return {version:2,owner,epoch,operationId,baseRevision,startSeq,endSeq,snapshot,deleteIntents,generation,mutationType,surface};
}
