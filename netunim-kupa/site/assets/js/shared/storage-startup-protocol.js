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
    const owner=ownership.current();
    const accountV2Active=await markers.account();
    const localEngineActive=await markers.local();
    if(ownership.current()!==owner)throw new Error('startup_protocol_owner_changed');
    return {owner,accountV2Active,localEngineActive};
  }

  /** @param {{primary:boolean,online:boolean}} context @returns {Promise<StartupProtocolResult>} */
  async function check({primary,online}){
    let state=await readMarkers();
    let protocol=await checkStorageProtocolStartup({...state,online,
      authenticatedOwner:ownership.authenticated(),readProtocolState:()=>account.read()});
    /** @type {unknown} */
    let recoveryError=null;
    if(ownership.current()!==state.owner)throw new Error('startup_protocol_owner_changed');
    if(protocol.reason==='server-v2'&&primary){
      try{
        await account.recoverAccount();
        const recovered=await readMarkers();
        if(!recovered.accountV2Active)throw new Error('storage_fenced_recovery_marker_missing');
        state=recovered;
        protocol={allowed:true,reason:'v2-ready'};
      }catch(error){recoveryError=error}
    }
    return {...state,protocol,recoveryError};
  }

  return {check,readMarkers,currentOwner:()=>ownership.current(),verifyLocal:()=>markers.local()};
}

/**
 * @typedef {{readMarkers:()=>Promise<StartupMarkersState>,verifyLocal:()=>Promise<boolean>,currentOwner:()=>string|null}} AdmissionProtocol
 * @typedef {{protocol:AdmissionProtocol,primary:()=>boolean,transfer:{preparing:()=>boolean,resume:()=>Promise<unknown>},birth:{preparing:()=>boolean,ensure:()=>Promise<unknown>}}} AdmissionPorts
 * @typedef {{ok:true,state:StartupMarkersState}|{ok:false,stage:'transfer'|'local',error:unknown}} AdmissionResult
 */
// Admission owns transfer/birth policy. Lifecycle owns presentation and ordering
// of the admitted journal, cloud and optional local-service capabilities.
/** @param {AdmissionPorts} ports */
export function createStorageStartupAdmission({protocol,primary,transfer,birth}){
  assertMethods('admission_protocol',protocol,['readMarkers','verifyLocal','currentOwner']);
  assertMethods('admission_transfer',transfer,['preparing','resume']);
  assertMethods('admission_birth',birth,['preparing','ensure']);
  if(typeof primary!=='function')throw new TypeError('startup_admission_primary_required');
  /** @param {StartupMarkersState} state */
  function assertOwner(state){
    if(protocol.currentOwner()!==state.owner)throw new Error('startup_admission_owner_changed');
  }
  /** @param {StartupMarkersState} state */
  function assertCurrent(state){
    if(!primary())throw new Error('startup_admission_primary_required');
    assertOwner(state);
  }
  /** @param {StartupMarkersState} state @param {boolean} [pendingTransfer] @returns {Promise<AdmissionResult>} */
  async function admit(state,pendingTransfer=false){
    assertCurrent(state);
    if(pendingTransfer||transfer.preparing()){
      // A successful transfer is the only operation allowed to change owners.
      try{await transfer.resume()}
      catch(error){return {ok:false,stage:'transfer',error}}
      if(!primary())throw new Error('startup_admission_primary_required');
      state=await protocol.readMarkers();assertCurrent(state);
      if(transfer.preparing())return {ok:false,stage:'transfer',error:new Error('startup_admission_transfer_incomplete')};
    }
    if(state.owner==='local'){
      try{
        if(!state.localEngineActive||birth.preparing()){
          assertCurrent(state);await birth.ensure();assertCurrent(state);
          const localEngineActive=await protocol.verifyLocal();assertCurrent(state);
          state={...state,localEngineActive};
        }
        if(!state.localEngineActive||birth.preparing())throw new Error('startup_admission_local_marker_required');
      }catch(error){assertCurrent(state);return {ok:false,stage:'local',error}}
    }else if(!state.accountV2Active)throw new Error('startup_admission_account_marker_required');
    assertCurrent(state);return {ok:true,state};
  }
  /** @param {StartupMarkersState} state @param {boolean} [pendingTransfer] */
  function readOnlyRequired(state,pendingTransfer=false){
    return pendingTransfer||transfer.preparing()||state.accountV2Active||state.localEngineActive||birth.preparing();
  }
  return {admit,assertCurrent,assertOwner,readOnlyRequired,transferPending:()=>transfer.preparing()};
}
