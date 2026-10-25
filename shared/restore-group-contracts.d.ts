export type UnknownRecord = Record<string,unknown>;
export type RestorePhase = 'staged'|'cloud_staged'|'applying'|'completed';
// The legacy record guard accepts coercible revisions and hashes. Do not claim
// their raw fields are normalized just because the surrounding group is valid.
export type RestoreTarget = UnknownRecord & {state:UnknownRecord,documentName:unknown,baseRevision:unknown,operationId:unknown,payloadHash:unknown};
export type RestoreGroup = UnknownRecord & {
  schemaVersion:1,appSite:'orders'|'kupa',owner?:string|undefined,restoreGroupId:unknown,
  phase:RestorePhase,mutationSeq:unknown,main:RestoreTarget,checks?:RestoreTarget|null|undefined,
};
export type StoredRestoreGroup = RestoreGroup & {restoreGroupId:string};
export type CreatedTarget = RestoreTarget & {documentName:string,baseRevision:number,operationId:string,payloadHash:string};
export type CreatedRestoreGroup = StoredRestoreGroup & {mutationSeq:number,checkAmountPrecision:2,main:CreatedTarget,checks:CreatedTarget|null};
export type InputTarget = {state:UnknownRecord,documentName?:unknown,baseRevision?:unknown,operationId?:unknown,deleteIds?:unknown[]|null,deleteIntents?:unknown};
export type RestoreCrypto = {subtle?:Pick<SubtleCrypto,'digest'>,randomUUID?:()=>string};
export type CreateOptions = {appSite:'orders'|'kupa',owner?:string|null,main:InputTarget,checks?:InputTarget|null,beforeState?:unknown,localTargetState?:unknown,restoreGroupId?:string|null,now?:number|(()=>number),cryptoImpl?:RestoreCrypto|null};
export type StoreOptions = {
  localKey:string,put:(key:string,value:unknown)=>unknown|PromiseLike<unknown>,get:(key:string)=>unknown|PromiseLike<unknown>,remove:(key:string)=>unknown|PromiseLike<unknown>,
  storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>,now?:number|(()=>number),
};
export type ServerPending = ReturnType<typeof import('./restore-response-records.js').readServerRestorePending>;
export interface RestoreStore {
  stage(group:unknown):Promise<StoredRestoreGroup>;
  loadPending():Promise<StoredRestoreGroup|null>;
  advance(group:RestoreGroup,phase:RestorePhase):Promise<StoredRestoreGroup>;
  complete(group:StoredRestoreGroup):Promise<StoredRestoreGroup>;
  archiveKey(id:string):string;
  loadServerPending(owner:string):Promise<ServerPending|null>;
  stageServerPending(record:UnknownRecord & {owner:string}):Promise<ServerPending>;
  completeServerPending(owner:string,id:string):Promise<void>;
}
export type RestoreExecutor<Result> = {
  store:RestoreStore,stageRemote:(group:StoredRestoreGroup)=>unknown|PromiseLike<unknown>,
  applyRemote:(id:string)=>Result|PromiseLike<Result>,onApplied:(group:StoredRestoreGroup,result:Result)=>unknown|PromiseLike<unknown>,
};
export interface RestoreMethods {
  restorePayloadHash(value:unknown,options?:{cryptoImpl?:RestoreCrypto|null}):Promise<string>;
  createRestoreGroup(options?:Partial<CreateOptions>):Promise<CreatedRestoreGroup>;
  samePayload(a:unknown,b:unknown):boolean;
  chooseNewer(a:unknown,b:unknown):unknown;
  readLocal():unknown;
  writeLocal(group:RestoreGroup):void;
  writeEverywhere(group:RestoreGroup):Promise<StoredRestoreGroup>;
}
