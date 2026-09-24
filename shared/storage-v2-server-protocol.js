// A browser without an account cutover marker cannot infer the account's
// writer protocol from its local V1 data. Resolve it before restoring or
// displaying that data. A fresh local owner follows the separate V2 birth path.
export async function checkLegacyAccountStartup({owner,cutoverActive,localEngineActive,online,authenticatedOwner,readProtocolState}={}){
  if(cutoverActive===true||owner==='local'&&localEngineActive===true)return {allowed:true,reason:'v2-ready'};
  // A local-only install needs no network. A browser with saved account auth
  // but no local marker may contain a stale V1 snapshot of a fenced account.
  if(owner==='local'&&!authenticatedOwner)return {allowed:true,reason:'local-birth'};
  if(!owner||online!==true||owner!=='local'&&authenticatedOwner!==owner||typeof readProtocolState!=='function')return {allowed:false,reason:'verification-required'};
  let state;
  try{state=await readProtocolState()}catch{return {allowed:false,reason:'verification-required'}}
  const values=[state?.orders,state?.kupa,state?.sharedChecks];
  if(values.every(value=>value===1))return {allowed:true,reason:'legacy-account'};
  if(values.every(value=>value===2))return {allowed:false,reason:'server-v2'};
  return {allowed:false,reason:'protocol-inconsistent'};
}
