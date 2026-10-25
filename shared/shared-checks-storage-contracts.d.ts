import type {StorageJsonObject as State} from './storage-json.js';
import type {JournalOptions,JournalMethods,RecoveredJournal,AppendAdmission,CloudSnapshot,ControlInput} from './storage-journal-contracts.js';
import type {StoredCloudFlight} from './storage-cloud-records.js';
export type SharedState = State & {checks:(State & {id:string})[],bankEvents:(State & {seq:number,checkId:string})[]};
export type CheckChange = {type:'delete',collection:'checks',id:string}|({type:'put',collection:'checks',id:string}&({mode:'replace'}|{mode:'insert',index:number}));
export type PersistOptions = {generation?:number,surface?:string,mutationType?:string,deleteIds?:string[]};
export type InitializeOptions = {intent:'upload-local'|'cloud-authoritative',sourceOwner:string,bootstrapOperationId?:string};
export type Storage = ReturnType<typeof import('./shared-checks-storage-v2.js').createSharedChecksStorageV2>;
export type Options = {
  owner:()=>string,primary:()=>boolean,commitPrimary?:()=>boolean,role?:'primary',validate?:import('./storage-journal-contracts.js').Validate,
  createJournal?:typeof import('./storage-journal.js').createStorageJournal,
  db?:JournalOptions['db'],emergency?:JournalOptions['emergency'],operationId?:()=>string,now?:()=>string,
};
export interface Methods {
  recoverReadOnly():Promise<RecoveredJournal|null>;
  open(options?:{migrationState?:unknown,migrationIntent?:string|null,sourceOwner?:string|null}):Promise<RecoveredJournal|null>;
  initializeCloudHead(revision:number,state:unknown,options:InitializeOptions):Promise<import('./storage-journal-model.js').ReplayedStorageJournal>;
  append(operations:CheckChange[],state:unknown,options?:PersistOptions):AppendAdmission;
  captureCloudCursor(revision:number,state:unknown):ReturnType<JournalMethods['captureCloudCursor']>;
  cloudState():Promise<CloudSnapshot>;
  materializeFlight(options?:{operationId?:string,throughSeq?:number,snapshot?:unknown,prepareAudit?:((flight:import('./storage-records.js').StorageCloudFlight<State>)=>State)|null}):Promise<StoredCloudFlight|null>;
  acknowledge(id:string,revision:number,state:unknown,options:{currentState:unknown,expectedSeq:number,control?:ControlInput|null}):ReturnType<JournalMethods['acknowledge']>;
  rejectAndRebase(id:string,revision:number,state:unknown,options:{currentState:unknown,expectedSeq:number,control?:ControlInput|null}):ReturnType<JournalMethods['rejectAndRebase']>;
  adoptCloudHead(revision:number,state:unknown):ReturnType<JournalMethods['adoptCloudHead']>;
  replaceAuthoritativeState(state:unknown,options?:{boundaryId?:string|null}):ReturnType<JournalMethods['replaceAuthoritativeState']>;
  replaceLocalWithPending(state:unknown,options:{boundaryId:string,expectedSeq:number,expectedBaseRevision:number}):ReturnType<JournalMethods['replaceLocalWithPending']>;
  replaceLocalAuthoritativeState(state:unknown,options:{boundaryId:string,expectedSeq:number}):ReturnType<JournalMethods['replaceLocalAuthoritativeState']>;
  resetCloudHead(revision:number,state:unknown,options?:{boundaryId?:string|null}):ReturnType<JournalMethods['resetCloudHead']>;
}
