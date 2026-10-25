import type {StorageJsonObject as State} from './storage-json.js';
import type {StorageChange,StorageDeleteIntents,StorageCloudFlight} from './storage-records.js';
import type {StoredStorageOperation,StorageOperationSchema} from './storage-operation.js';
import type {StoredCloudBase,StoredCloudFlight,StoredCloudControl} from './storage-cloud-records.js';
import type {SealedStorageRecord} from './storage-json-codec.js';
import type {StorageJournalDb,Snapshot,Envelope,Metadata} from './storage-journal-db.js';
import type {ReplayedStorageJournal} from './storage-journal-model.js';
import type {CloudRecoveryHead} from './storage-cloud-recovery.js';
import type {LocalHead} from './storage-journal-authority.js';

export type {State,StorageDeleteIntents,StoredStorageOperation};
export type Operation = SealedStorageRecord<StoredStorageOperation>;
export type Payload = SealedStorageRecord<State>;
export type Validate = (state:State)=>State|void;
export type Project = (state:State)=>State;
export type JournalSchema = StorageOperationSchema & {collections:readonly string[],mainProjection?:number};
export type EpochTransition = {epoch:string,seq:number,fallbackEpoch:string|null,fallbackSeq:number};
export type DurableSnapshot = Snapshot & {checkpoints:Envelope,metadata:Metadata};
export type RecoveredJournal = ReplayedStorageJournal & {stored:DurableSnapshot,emergency:Operation[]};
export type CloudSnapshot = {
  seq:number,base:StoredCloudBase|null,flight:StoredCloudFlight|null,control:StoredCloudControl|null,pending:boolean,
  pendingDeleteIntents:StorageDeleteIntents,pendingGeneration:number,pendingMutationType:string,pendingSurface:string,
  afterFlightPending:boolean,afterFlightDeleteIntents:StorageDeleteIntents,afterFlightGeneration:number,afterFlightMutationType:string,afterFlightSurface:string,
};
export type AppendAdmission = {seq:number,operationId:string,emergencyDurable:boolean,transitionFallbackDurable:boolean,committed:Promise<boolean>,transitioning:boolean};
export type CloudAck = {operationId:string,revision:number,ackSeq:number};
export type CloudRecovery = {state:State,replayedPrevious:State|null,deleteIntents:StorageDeleteIntents,head:CloudSnapshot,backup:DurableSnapshot,expectedHead:CloudRecoveryHead};
export type ControlInput = State & {version?:2,owner?:string,epoch?:string,updatedAt?:string|null,retry?:import('./storage-cloud-records.js').StoredCloudRetry|null,conflict?:State|null};
export type RecoveryOptions = {validateBase?:Validate};
export type AppendOptions = {generation?:number,surface?:string,mutationType?:string,deleteIntents?:StorageDeleteIntents,appMetadata?:State};
export type JournalOptions = {
  owner:string,schema:JournalSchema,validate:Validate,primary?:()=>boolean,commitPrimary?:()=>boolean,
  db?:Pick<StorageJournalDb,'load'|'claim'|'install'|'append'|'initializeCloudHead'|'compact'|'appendBoundary'|'setBase'|'clearControl'|'beginFlight'|'acknowledge'|'rejectFlight'|'setControl'|'commitCloudRecovery'|'replaceCheckpoint'|'replaceLocalCheckpoint'|'adoptCloudHead'|'resetState'|'resetCloudHead'>,
  emergency?:Pick<Storage,'length'|'key'|'getItem'|'setItem'|'removeItem'>,
  operationId?:()=>string,now?:()=>string,maxEmergencyBytes?:number,maxEmergencyEntries?:number,
};
// Every signature contextualizes the real JS body. No runtime implementation is
// substituted by these declarations; mutation tests compile changed JS bodies.
export interface JournalMethods {
  readScopedOperation(record:unknown,expectedEpoch:string|null):StoredStorageOperation;
  readEmergency():Payload[];
  emergencyKey(operation:State):string;
  writeEmergency(record:Operation):boolean;
  cleanEmergency(record:Payload):void;
  recover():Promise<RecoveredJournal|null>;
  open():Promise<RecoveredJournal|null>;
  install(state:State,options?:{expectedEpoch?:string|null,appMetadata?:State}):Promise<{epoch:string,seq:number}>;
  append(changes:StorageChange[],options?:AppendOptions):AppendAdmission;
  replaceLocalWithPending(state:State,options:{boundaryId:string,expectedSeq:number,expectedBaseRevision:number,deleteCollections?:readonly string[],validateBase?:Validate,mutationType?:string,surface?:string,requireCurrentState?:boolean}):Promise<{seq:number,operationId:string,deleteIntents:StorageDeleteIntents}>;
  initializeCloudHead(revision:number,state:State,options?:{cloudState?:State,changes?:StorageChange[]|null,validateBase?:Validate,appMetadata?:State}):Promise<ReplayedStorageJournal>;
  compact():Promise<number>;
  setCloudBase(revision:number,state:State,options:{validateBase?:Validate,ackSeq:number}):Promise<boolean>;
  captureCloudCursor(revision:number,options?:{project?:Project,validateBase?:Validate}):Promise<import('./storage-records.js').StorageCloudBase<State>>;
  cloudState(options?:RecoveryOptions):Promise<CloudSnapshot>;
  cloudSnapshot(stored:Snapshot,validateBase:Validate):CloudSnapshot;
  materializeFlight(options?:{operationId?:string,baseRevision?:number,throughSeq?:number,snapshot?:State,project?:Project,validateCloud?:Validate,prepareAudit?:((flight:StorageCloudFlight<State>)=>State)|null}):Promise<StoredCloudFlight|null>;
  acknowledge(flightId:string,revision:number,state:State,options?:{validateBase?:Validate,checkpointState?:State|null,expectedSeq?:number|null,appMetadata?:State,control?:ControlInput|null}):Promise<CloudAck>;
  rejectAndRebase(flightId:string,revision:number,state:State,options:{validateBase?:Validate,checkpointState:State,expectedSeq:number,appMetadata?:State,control?:ControlInput|null}):Promise<{rejected:StoredCloudFlight,base:StoredCloudBase,checkpoint:import('./storage-checkpoint.js').StoredStorageCheckpoint,control:StoredCloudControl|null,cloudState:CloudSnapshot}>;
  setCloudControl(control?:ControlInput,options?:{expectedEpoch?:string|null,isCurrent?:()=>boolean}):Promise<StoredCloudControl>;
  readCloudRecovery(options?:RecoveryOptions & {afterSeq?:number|null,previousState?:State|null}):Promise<CloudRecovery>;
  commitCloudRecovery(state:State,options:{expectedHead:CloudRecoveryHead,conflictKind?:'concurrent-ack'|null,validateBase?:Validate,isCurrent?:()=>boolean}):Promise<CloudSnapshot>;
  clearCloudControl(options?:{onlyIfClean?:{kind:string,seq:number,baseRevision:number}|null,project?:Project,validateBase?:Validate}):Promise<boolean>;
  replaceCurrentState(state:State,options?:{appMetadata?:State,expectedSeq?:number|null}):Promise<number>;
  replaceLocalAuthoritativeState(state:State,options:{boundaryId:string,expectedSeq:number}):Promise<{epoch:string,seq:number}>;
  adoptCloudHead(revision:number,cloudState:State,currentState:State,options?:{validateBase?:Validate,appMetadata?:State,expectedHead?:{seq:number,baseRevision:number}|null}):Promise<{seq:number,revision:number}>;
  replaceAuthoritativeState(currentState:State,options?:{appMetadata?:State,expectedLocalHead?:LocalHead|null}):Promise<{epoch:string,seq:number}>;
  resetCloudHead(revision:number,cloudState:State,currentState:State,options?:{validateBase?:Validate,appMetadata?:State,expectedCleanHead?:(LocalHead & {revision:number})|null}):Promise<{epoch:string,seq:number,revision:number,ackSeq:0}>;
}
