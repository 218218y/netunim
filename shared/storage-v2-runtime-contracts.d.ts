import type {State,JournalMethods,JournalOptions,RecoveredJournal,AppendAdmission,AppendOptions,Validate,Project} from './storage-journal-contracts.js';
import type {StorageChange} from './storage-records.js';
export type App = 'orders'|'kupa';
export type Mode = 'off'|'preparing'|'primary';
export type Journal = ReturnType<typeof import('./storage-journal.js').createStorageJournal>;
type PrimaryRecovery = RecoveredJournal & {appMetadata:State & {storageRole:'primary'}};
export type Recovery = PrimaryRecovery & {source:'v2'};
export type ReadOnlyRecovery = PrimaryRecovery & {source:'v2-readonly'};
export type Options = {
  app:App,owner:()=>string,primary:()=>boolean,captureCommitAuthority?:()=>()=>boolean,
  validate:Validate,prepareCheckpoint?:Project,prepareOperation?:(operation:StorageChange)=>StorageChange,
  mode?:()=>Mode,createJournal?:(options:JournalOptions)=>Journal,
  scheduleIdle?:(callback:()=>Promise<void>)=>unknown,compactEvery?:number,compactAfterMs?:number,
};
export type PersistResult = {handled:false,reason:'inactive'|'not-ready'|'legacy-boundary'|'contract'|'append-failed',error?:unknown}
  | ({handled:true,reason:'journal'|'idb-commit-pending'} & Pick<AppendAdmission,'seq'|'emergencyDurable'|'transitionFallbackDurable'|'committed'|'transitioning'>);
export type InitializeOptions = NonNullable<Parameters<JournalMethods['initializeCloudHead']>[2]> & {sourceOwner:string,intent:'cloud-authoritative'|'upload-local'};
type AckOptions = NonNullable<Parameters<JournalMethods['acknowledge']>[3]> & {currentState?:State};
type RejectOptions = Omit<Parameters<JournalMethods['rejectAndRebase']>[3],'checkpointState'> & ({currentState:State,checkpointState?:State}|{currentState?:State,checkpointState:State});
export interface RuntimeMethods {
  recover():Promise<Recovery|null>;
  recoverReadOnly():Promise<ReadOnlyRecovery|null>;
  recoverForOwner(options:{intent:'load-account'}):Promise<Recovery|null>;
  initializeLocal(state:State,options?:{appMetadata?:State}):Promise<RecoveredJournal>;
  initializeCloudHead(revision:number,state:State,options:InitializeOptions):ReturnType<JournalMethods['initializeCloudHead']>;
  initializeUploadLocalCloudHead(empty:State,current:State,options:{cloudState:State,validateBase?:Validate,appMetadata?:State}):ReturnType<JournalMethods['initializeCloudHead']>;
  persist(state:State,options?:AppendOptions & {operations?:StorageChange[]|null},appMetadata?:State):PersistResult;
  setCloudBase:JournalMethods['setCloudBase'];
  captureCloudCursor:JournalMethods['captureCloudCursor'];
  cloudState(options?:Parameters<JournalMethods['cloudState']>[0]):Promise<Awaited<ReturnType<JournalMethods['cloudState']>>|null>;
  materializeFlight:JournalMethods['materializeFlight'];
  acknowledgeFlight(id:string,revision:number,state:State,options?:AckOptions):ReturnType<JournalMethods['acknowledge']>;
  rejectFlight(id:string,revision:number,state:State,options:RejectOptions):ReturnType<JournalMethods['rejectAndRebase']>;
  setCloudControl(control?:Parameters<JournalMethods['setCloudControl']>[0],options?:{expectedScope?:{owner:string,epoch:string},isCurrent?:()=>boolean}):ReturnType<JournalMethods['setCloudControl']>;
  clearCloudControl(options?:Parameters<JournalMethods['clearCloudControl']>[0]):Promise<boolean>;
  readCloudRecovery:JournalMethods['readCloudRecovery'];
  commitCloudRecovery:JournalMethods['commitCloudRecovery'];
  replaceCurrentState:JournalMethods['replaceCurrentState'];
  replaceLocalAuthoritativeState:JournalMethods['replaceLocalAuthoritativeState'];
  adoptCloudHead:JournalMethods['adoptCloudHead'];
  replaceAuthoritativeState(...args:Parameters<JournalMethods['replaceAuthoritativeState']>):Promise<Awaited<ReturnType<JournalMethods['replaceAuthoritativeState']>>|false>;
  replaceLocalWithPending(state:State,options:Omit<Parameters<JournalMethods['replaceLocalWithPending']>[1],'deleteCollections'|'requireCurrentState'>):ReturnType<JournalMethods['replaceLocalWithPending']>;
  resetCloudHead(...args:Parameters<JournalMethods['resetCloudHead']>):Promise<Awaited<ReturnType<JournalMethods['resetCloudHead']>>|false>;
  compact():Promise<number|false>;
}
export type Diagnostics = {mode:Mode,recoveries:number,operations:number,emergencyFailures:number,commitFailures:number,errors:number,lastError:string,pendingCommits:number,peakPendingCommits:number,undurableCommits:number,maxCommitLatencyMs:number,recoveryFailure?:'fatal'|'retryable'};
