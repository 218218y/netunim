import {checkStorageProtocolStartup} from './storage-v2-server-protocol.js';

/**
 * @typedef {{current: () => string|null, authenticated: () => string|null}} StartupOwnership
 * @typedef {{account: () => Promise<boolean>, local: () => Promise<boolean>}} StartupMarkers
 * @typedef {{read: () => Promise<{orders:number,kupa:number,sharedChecks:number}>, recoverAccount: () => Promise<unknown>}} StartupAccount
 */

// Storage owns marker verification and fenced adoption. Lifecycle receives the
// resulting decision, and keeps control of the lock, recovery and display order.
/**
 * @param {{ownership:StartupOwnership, markers:StartupMarkers, account:StartupAccount}} ports
 */
export function createStorageStartupProtocol({ownership,markers,account}){
  for(const [name,port,methods] of [
    ['ownership',ownership,['current','authenticated']],
    ['markers',markers,['account','local']],
    ['account',account,['read','recoverAccount']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`startup_protocol_${name}_${method}_required`);

  async function readMarkers(){
    const accountV2Active=await markers.account();
    const localEngineActive=await markers.local();
    return {owner:ownership.current(),accountV2Active,localEngineActive};
  }

  async function check({primary,online}){
    let state=await readMarkers();
    let protocol=await checkStorageProtocolStartup({...state,online,
      authenticatedOwner:ownership.authenticated(),readProtocolState:()=>account.read()});
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
