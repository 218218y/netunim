// @ts-check
/** @typedef {{owner:string,epoch:string}} StorageIdentity */
/** @typedef {StorageIdentity & {accountOwner:string,writable:boolean}} StorageScope */
/** @typedef {StorageScope & {loginEpoch:number}} CloudWriteScope */
/** @typedef {{base:StorageIdentity|null}} ScopedHead */

/** @param {StorageScope|null} storage @param {{owner:string|null,epoch:number}} account @returns {CloudWriteScope|null} */
export function readCloudWriteScope(storage,account){
  if(!storage?.owner||!storage.epoch||!account.owner||storage.accountOwner!==account.owner||!Number.isSafeInteger(account.epoch)||account.epoch<0)return null;
  return {...storage,accountOwner:account.owner,loginEpoch:account.epoch};
}

/** @param {CloudWriteScope|null} scope @param {CloudWriteScope|null} live @param {ScopedHead|null} [head] */
export function cloudWriteScopeIsCurrent(scope,live,head=null){
  return !!scope&&live?.writable===true&&cloudWriteScopeHasIdentity(scope,live)&&
    (!head||storageCloudHeadIsCurrent(head,live));
}

/** @param {ScopedHead|null} head @param {StorageScope|null} live */
export function storageCloudHeadIsCurrent(head,live){
  return live?.writable===true&&!!head?.base&&head.base.owner===live.owner&&head.base.epoch===live.epoch;
}

// Resource completion may release its own busy flag after losing leadership,
// but must never clear another account/epoch/login's busy state.
/** @param {CloudWriteScope|null} scope @param {CloudWriteScope|null} live */
export function cloudWriteScopeHasIdentity(scope,live){
  return !!scope&&!!live&&scope.owner===live.owner&&scope.epoch===live.epoch&&scope.accountOwner===live.accountOwner&&scope.loginEpoch===live.loginEpoch;
}

/** @param {CloudWriteScope|null} live @param {ScopedHead|null} head @returns {Readonly<CloudWriteScope>|null} */
export function captureCloudWriteScope(live,head){
  return live&&head?.base&&cloudWriteScopeIsCurrent(live,live,head)?Object.freeze({...live}):null;
}
