import type {StorageJsonObject} from './storage-json.js';
import type {SealedStorageRecord} from './storage-json-codec.js';
import type {StoredStorageCheckpoint,StorageJournalKey} from './storage-checkpoint.js';
import type {StoredCloudBase,StoredCloudFlight,StoredCloudControl} from './storage-cloud-records.js';
import type {StoredStorageOperation} from './storage-operation.js';
import type {createStorageOwnerTransactions} from './storage-owner-idb.js';

export type State = StorageJsonObject;
type Checkpoint = SealedStorageRecord<StoredStorageCheckpoint>;
type Base = SealedStorageRecord<StoredCloudBase>;
type Flight = SealedStorageRecord<StoredCloudFlight>;
type Control = SealedStorageRecord<StoredCloudControl>;
type Operation = SealedStorageRecord<StoredStorageOperation>;
export type Envelope = {data:unknown,checksum:string};
export type Metadata = {epoch:string,seq:number,writer:string};
export type Snapshot = {checkpoints:Envelope|null,metadata:Metadata|null,bases:Envelope|null,flights:Envelope|null,controls:Envelope|null,journal:unknown[],journalKeys?:unknown};
export type EditableSnapshot = Omit<Snapshot,'journalKeys'> & {journalKeys:StorageJournalKey[]};
export type TransactionWork<Result> = (tx:IDBTransaction,done:(result:Result)=>undefined,fail:(cause:unknown)=>undefined)=>undefined;

// Contracts annotate the real JS functions. Negative compiler mutations verify
// their bodies, including callback results; this file supplies no runtime facade.
export type StorageJournalDb = JournalTransactions & ReturnType<typeof createStorageOwnerTransactions>;
interface JournalTransactions {
  load(owner:string): Promise<Snapshot>;
  install(owner:string,checkpoint:Checkpoint,writer:string,options?:{expectedEpoch?:string|null}): Promise<boolean>;
  claim(owner:string,epoch:string,writer:string): Promise<boolean>;
  initializeCloudHead(owner:string,checkpoint:Checkpoint,base:Base,writer:string,operation?:Operation|null): Promise<boolean>;
  append(owner:string,epoch:string,writer:string,record:Operation): Promise<boolean>;
  compact(owner:string,epoch:string,writer:string,checkpoint:Checkpoint): Promise<boolean>;
  replaceCheckpoint(owner:string,epoch:string,writer:string,checkpoint:Checkpoint): Promise<boolean>;
  replaceLocalCheckpoint(owner:string,epoch:string,writer:string,checkpoint:Checkpoint,expectedSeq:number): Promise<boolean>;
  setBase(owner:string,epoch:string,writer:string,base:Base): Promise<boolean>;
  beginFlight(owner:string,epoch:string,writer:string,flight:Flight): Promise<Flight>;
  acknowledge(owner:string,epoch:string,writer:string,operationId:string,base:Base,options?:{checkpoint?:Checkpoint|null,control?:Control|null}): Promise<boolean>;
  rejectFlight(owner:string,epoch:string,writer:string,operationId:string,base:Base,options:{checkpoint:Checkpoint,expectedSeq:number,control?:Control|null}): Promise<boolean>;
  setControl(owner:string,epoch:string,writer:string,control:Control): Promise<boolean>;
  clearControl(owner:string,epoch:string,writer:string,options?:{expectedHead?:import('./storage-journal-authority.js').CloudHead|null}): Promise<boolean>;
  commitCloudRecovery(owner:string,epoch:string,writer:string,checkpoint:Checkpoint,options:{expectedHead:import('./storage-cloud-recovery.js').CloudRecoveryHead,conflictKind?:'concurrent-ack'|null,isCurrent?:()=>boolean}): Promise<boolean>;
  adoptCloudHead(owner:string,epoch:string,writer:string,checkpoint:Checkpoint,base:Base,options?:{expectedHead?:import('./storage-journal-authority.js').CloudHead|null}): Promise<boolean>;
  resetState(owner:string,epoch:string,writer:string,checkpoint:Checkpoint,options?:{expectedLocalHead?:import('./storage-journal-authority.js').LocalHead|null}): Promise<boolean>;
  resetCloudHead(owner:string,epoch:string,writer:string,checkpoint:Checkpoint,base:Base,options?:{expectedCleanHead?:(import('./storage-journal-authority.js').LocalHead & {revision:number})|null}): Promise<boolean>;
  appendBoundary(owner:string,epoch:string,writer:string,record:Operation,options:{expectedSeq:number,expectedBaseRevision:number}): Promise<boolean>;
  readBoundary(owner:string): Promise<State|null>;
  beginBoundary(owner:string,record:State): Promise<State>;
  advanceBoundary(owner:string,id:string,fromPhase:string,toPhase:string): Promise<State>;
  completeBoundary(owner:string,id:string): Promise<boolean>;
  readBootstrapGroup(scope:string): Promise<State|null>;
  beginBootstrapGroup(scope:string,record:State): Promise<State>;
  advanceBootstrapGroup(scope:string,id:string,fromPhase:string,toPhase:string,patch?:State): Promise<State>;
  readV2Marker(scope:string): Promise<State|null>;
  markAccountMarker(app:'orders'|'kupa',identity:string): Promise<State|null>;
  readLocalBirth(scope:string): Promise<State|null>;
  beginLocalBirth(scope:string,record:State): Promise<State>;
  advanceLocalBirth(scope:string,id:string,fromPhase:string,toPhase:string): Promise<State>;
  markLocalEngine(app:'orders'|'kupa'): Promise<State|null>;
  readLocalEngine(app:'orders'|'kupa'): Promise<State|null>;
  adoptFencedAccount(app:'orders'|'kupa',identity:string,options:{mainState:State,mainCloudState:State,mainRevision:number,sharedState:State,sharedRevision:number,sourceOwner?:string}): Promise<State|null>;
}
