export type CloudRetry = {attempts:number,lastErrorCode:string|null,lastAttemptAt:string|null,nextAttemptAt:string|null};
export type RetryScheduleRecord = {domain:string,documentName:string,operationId:string,generation:number,retry?:{nextAttemptAt?:unknown}|null};
export type RetryResume = ()=>void|boolean|Promise<unknown>;
export type OutboxRecord = {schemaVersion:4,domain:string,documentName:string,operationId:string,generation:number,mutationSeq:number,baseRevision:number,baseState:unknown,snapshot:unknown,createdAt:string,updatedAt:string,conflict:unknown,mutationType:string,surface:string,restoreGroupId:string|null,retry:CloudRetry};
export type CloudErrorKind = 'fatal'|'busy'|'revision_conflict'|'rate_limited'|'conflict'|'service_unavailable'|'auth'|'timeout'|'network';
export type NormalizedCloudError = {kind:CloudErrorKind,code:string|null,status:number|null,retryAfterMs:number|null,original:unknown};
export type ScheduledRequest = {priority:'high'|'low',key:string};
export type QueueItem<Result> = ScheduledRequest & {task:()=>Result|PromiseLike<Result>,blockedError:()=>unknown,resolve:(value:Result|PromiseLike<Result>)=>void,reject:(cause:unknown)=>void};
type CloudWriteError = Error & Omit<NormalizedCloudError,'original'> & {response:unknown,cause:unknown};
type ConflictItem = {domain:string,entityType:string,entityId:string|null,base:unknown,local:unknown,remote:unknown,generation:number,baseRevision:number,currentRemoteRevision:number};
type SyncConflict = {kind:'entity-conflict',domain:string,generation:number,baseRevision:number,currentRemoteRevision:number,items:ConflictItem[]};
type Audit = {clientInstanceId:string,app:string,build:string,mutationType:string,surface:string,baseRevision:number,beforeCount:Record<string,number>,afterCount:Record<string,number>,deleteCount:number,restoreGroupId:string|null,timestamp:string};
export type BusyWriteOptions = {attempts?:number,delay?:(attempt:number)=>number,sleep?:(ms:number)=>Promise<unknown>};
export type SchedulerOptions = {maxHighBurst?:number,canRun?:(item:ScheduledRequest)=>boolean};
export type RetrySchedulerOptions = {now?:()=>number,setTimer?:(callback:()=>void,delay:number)=>number,clearTimer?:(timer:number)=>void,onError?:(error:unknown)=>void};

// Signatures contextualize the real functions; implementation mutation tests
// verify bodies and asynchronous queue callbacks, not just these declarations.
export interface CloudPolicy {
  object(value:unknown): value is Record<string,unknown>;
  record(value:unknown): Record<string,unknown>;
  finiteRevision(value:unknown): number;
  finiteGeneration(value:unknown): number;
  iso(value:unknown,now:()=>number): string;
  nowMilliseconds(now?:number|(()=>number)): number;
  futureIso(value:unknown,now?:number|(()=>number)): string|null;
  createOutboxRecord(input:Record<string,unknown>,options?:{now?:()=>number,random?:()=>number,randomUUID?:(()=>string)|null}): OutboxRecord;
  getOutboxRetryDelay(record:{retry?:{nextAttemptAt?:unknown}|null}|null|undefined,now?:number|(()=>number)): number;
  outboxRetryForGeneration(existing:{retry?:unknown}|null|undefined,options?:{sameGeneration?:boolean,retry?:unknown,now?:()=>number}): CloudRetry;
  createOutboxRetryScheduler(options?:{now?:()=>number,setTimer?:(callback:()=>void,delay:number)=>number,clearTimer?:(timer:number)=>void,onError?:(error:unknown)=>void}): {schedule:(record:RetryScheduleRecord,resume:RetryResume)=>number,cancel:()=>void,stats:()=>{scheduled:boolean,key:string,dueAt:number}};
  migrateOutboxRecord(value:unknown,options?:Record<string,unknown> & {now?:()=>number}): OutboxRecord|null;
  updateOutboxSnapshot(existing:OutboxRecord|null,options?:Record<string,unknown>): OutboxRecord;
  acknowledgedGenerationMatches(record:{generation?:unknown}|null|undefined,acknowledgedGeneration:unknown): boolean;
  compareOutboxFreshness(a:Record<string,unknown>|null|undefined,b:Record<string,unknown>|null|undefined): number;
  operationAuditMetadata(options?:{site?:string,build?:string,mutationType?:string,surface?:string,baseRevision?:number,beforeState?:unknown,afterState?:unknown,collections?:readonly string[],deleteCount?:number,restoreGroupId?:string|null}): Audit;
  errorMessage(input:unknown): string;
  retryAfterMilliseconds(response:unknown,input:unknown): number|null;
  normalizeCloudError(input:unknown): NormalizedCloudError;
  cloudWriteError(input:unknown,fallbackMessage?:string): CloudWriteError;
  createCloudRetryControl(error:unknown,previous?:{attempts?:unknown}|null,options?:{now?:()=>number,random?:()=>number}): CloudRetry;
  structuredSyncConflict(input:{domain:string,conflicts:readonly string[],base:unknown,local:unknown,remote:unknown,generation:number,baseRevision:number,currentRemoteRevision:number}): SyncConflict;
}
