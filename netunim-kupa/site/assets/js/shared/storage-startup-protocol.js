// @ts-check

import {checkStorageProtocolStartup} from './storage-v2-server-protocol.js';

/**
 * @typedef {{current: () => string|null, authenticated: () => string|null}} StartupOwnership
 * @typedef {{account: () => Promise<boolean>, local: () => Promise<boolean>}} StartupMarkers
 * @typedef {{read: () => Promise<import('./storage-v2-server-protocol.js').StorageProtocolState>, recoverAccount: () => Promise<unknown>}} StartupAccount
 * @typedef {{owner:string|null,accountV2Active:boolean,localEngineActive:boolean}} StartupMarkersState
 * @typedef {StartupMarkersState & {protocol:import('./storage-v2-server-protocol.js').StorageProtocolDecision,recoveryError:unknown}} StartupProtocolResult
 */

/** @template {object} T @param {string} name @param {T} port @param {Array<keyof T>} methods */
function assertMethods(name,port,methods){
  for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`startup_protocol_${name}_${String(method)}_required`);
}

// Storage owns marker verification and fenced adoption. Lifecycle receives the
// resulting decision, and keeps control of the lock, recovery and display order.
/**
 * @param {{ownership:StartupOwnership, markers:StartupMarkers, account:StartupAccount}} ports
 */
export function createStorageStartupProtocol({ownership,markers,account}){
  assertMethods('ownership',ownership,['current','authenticated']);
  assertMethods('markers',markers,['account','local']);
  assertMethods('account',account,['read','recoverAccount']);

  /** @returns {Promise<StartupMarkersState>} */
  async function readMarkers(){
    const accountV2Active=await markers.account();
    const localEngineActive=await markers.local();
    return {owner:ownership.current(),accountV2Active,localEngineActive};
  }

  /** @param {{primary:boolean,online:boolean}} context @returns {Promise<StartupProtocolResult>} */
  async function check({primary,online}){
    let state=await readMarkers();
    let protocol=await checkStorageProtocolStartup({...state,online,
      authenticatedOwner:ownership.authenticated(),readProtocolState:()=>account.read()});
    /** @type {unknown} */
    let recoveryError=null;
    if(protocol.reason==='server-v2'&&primary){
      try{
        await account.recoverAccount();
        const accountV2Active=await markers.account();
        if(!accountV2Active)throw new Error('storage_fenced_recovery_marker_missing');
        state={...state,owner:ownership.current(),accountV2Active};
        protocol={allowed:true,reason:'v2-ready'};
      }catch(error){recoveryError=error}
    }
    return {...state,protocol,recoveryError};
  }

  return {check,readMarkers,verifyLocal:()=>markers.local()};
}
