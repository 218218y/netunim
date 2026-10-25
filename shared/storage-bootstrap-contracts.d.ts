import type {StorageJson as Json,StorageJsonObject as State} from './storage-json.js';
import type {StorageJournalDb} from './storage-journal-db.js';
export type App = 'orders'|'kupa';
export type Transfer = 'upload-local'|'load-account'|'account-switch';
export type Phase = 'prepared'|'main-initialized'|'shared-initialized'|'main-synced'|'shared-synced'|'verified'|'complete';
// Historical validation accepts coercible sequences and identities. Readers do
// not certify those retained fields as normalized strings/numbers.
export type Side = State & {role:'main'|'shared',intent:'cloud-authoritative'|'upload-local'|'upload-owner',sourceSeq:Json,sourceHash:Json,operationId:Json,
  remoteExists:boolean,remoteRevision:Json,remoteHash:Json};
export type Group = State & {version:2,app:App,scope:string,owner:Json,sourceOwner:Json,id:Json,transferIntent:Transfer|'first-cloud'|'legacy-upgrade',phase:Phase,
  planHash:Json,main:Side,shared:Side,createdAt:Json,updatedAt:Json};
export type Source = {state:State,seq:unknown};
export type Remote = {state:State,revision:unknown};
export type CryptoPort = Pick<Crypto,'subtle'> & {randomUUID?:()=>string};
export type PlanOptions = {app:App,owner:string,sourceOwner?:string,transferIntent:Transfer,mainSource:Source,sharedSource:Source,
  mainRemote?:Remote|null,sharedRemote?:Remote|null,id?:Json|undefined,now?:(()=>Json)|Json,cryptoImpl?:CryptoPort};
export type PrepareOptions = Omit<PlanOptions,'app'|'owner'|'now'|'cryptoImpl'>;
export type Expected = Pick<Group,'scope'|'id'|'planHash'>;
export type CoordinatorOptions = {app:App,owner:()=>string,primary?:()=>boolean,
  db?:Pick<StorageJournalDb,'readBootstrapGroup'|'beginBootstrapGroup'|'advanceBootstrapGroup'>,
  now?:(()=>string)|string,cryptoImpl?:CryptoPort,operationId?:()=>string|undefined};
export type Coordinator = ReturnType<typeof import('./storage-v2-bootstrap.js').createStorageV2BootstrapCoordinator>;
export type ExecutorOptions = {coordinator:Coordinator,primary?:()=>boolean,
  initializeMain:(side:Side,group:Group)=>Promise<State>,initializeShared:(side:Side,group:Group)=>Promise<State>,
  syncMain:(side:Side,group:Group)=>Promise<State>,syncShared:(side:Side,group:Group)=>Promise<State>,verify:(group:Group)=>Promise<State>};
