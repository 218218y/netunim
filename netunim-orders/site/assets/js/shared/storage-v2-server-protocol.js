// @ts-check

/**
 * Values are deliberately unknown at this network boundary. Mixed/missing
 * protocols stay blocked; types cannot replace the runtime decision.
 * @typedef {{orders?:unknown,kupa?:unknown,sharedChecks?:unknown}|null|undefined} StorageProtocolState
 * @typedef {{allowed:true,reason:'v2-ready'|'local-birth'}|{allowed:false,reason:'verification-required'|'upgrade-required'|'server-v2'|'protocol-inconsistent'}} StorageProtocolDecision
 * @typedef {{owner?:string|null,accountV2Active?:boolean,localEngineActive?:boolean,online?:boolean,authenticatedOwner?:string|null,readProtocolState?:()=>Promise<StorageProtocolState>}} StorageProtocolInputs
 */

// A browser without a durable account marker must verify the server's writer
// protocol before opening an account head. Local-only birth needs no network.
/** @param {StorageProtocolInputs} [inputs] @returns {Promise<StorageProtocolDecision>} */
export async function checkStorageProtocolStartup({owner,accountV2Active,localEngineActive,online,authenticatedOwner,readProtocolState}={}){
  if(accountV2Active===true||owner==='local'&&localEngineActive===true)return {allowed:true,reason:'v2-ready'};
  // A local-only install needs no network. A browser with saved account auth
  // but no local marker cannot infer the account's current cloud protocol.
  if(owner==='local'&&!authenticatedOwner)return {allowed:true,reason:'local-birth'};
  if(!owner||online!==true||owner!=='local'&&authenticatedOwner!==owner||typeof readProtocolState!=='function')return {allowed:false,reason:'verification-required'};
  let state;
  try{state=await readProtocolState()}catch{return {allowed:false,reason:'verification-required'}}
  const values=[state?.orders,state?.kupa,state?.sharedChecks];
  // A new build never resumes V1 as an ordinary account writer. Existing
  // protocol-1 accounts must be upgraded through an explicit V2 transition.
  if(values.every(value=>value===1))return {allowed:false,reason:'upgrade-required'};
  if(values.every(value=>value===2))return {allowed:false,reason:'server-v2'};
  return {allowed:false,reason:'protocol-inconsistent'};
}
