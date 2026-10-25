import type {Storage,SharedState,CheckChange,PersistOptions,InitializeOptions,Methods as StorageMethods} from './shared-checks-storage-contracts.js';
import type {RecoveredJournal,AppendAdmission,CloudSnapshot} from './storage-journal-contracts.js';
import type {StoredCloudFlight} from './storage-cloud-records.js';
export type RemoteRow = {revision:number,state:unknown,updated_at?:string|null};
export type RpcResult = {r?:{ok?:boolean,status?:number}|null,row?:RemoteRow|null,j?:unknown}|null;
export type Options = {
  owner:()=>string,primary:()=>boolean,captureCommitAuthority?:()=>()=>boolean,mode?:()=>import('./storage-v2-runtime-contracts.js').Mode,
  readState:()=>unknown,applyState:(state:SharedState)=>void,
  merge:(base:SharedState['checks'],local:SharedState['checks'],remote:SharedState['checks'],options:{deleteIds:string[]})=>{checks:SharedState['checks'],conflicts:string[]},
  readRemote:()=>Promise<RemoteRow|null>,rpc:(checks:SharedState['checks'],revision:number,id:string,deletes:string[],audit:StoredCloudFlight['audit'])=>Promise<RpcResult>,
  refreshBankRpc?:(revision:number)=>Promise<unknown>,site?:string,createStorage?:(options:import('./shared-checks-storage-contracts.js').Options)=>Storage,
  operationId?:()=>string,now?:()=>number,random?:()=>number,
};
export interface Methods {
  initialize(options:InitializeOptions & {state:unknown,revision:number}):Promise<import('./storage-journal-model.js').ReplayedStorageJournal>;
  initializeLocal(options:{state:unknown}):Promise<RecoveredJournal>;
  persist(operations:CheckChange[],options?:PersistOptions):{handled:false}|({handled:true}&AppendAdmission);
  replaceAuthoritativeState(state:unknown,options:{boundaryId:string}):ReturnType<StorageMethods['replaceAuthoritativeState']>;
  replaceLocalWithPending:StorageMethods['replaceLocalWithPending'];
  replaceLocalAuthoritativeState:StorageMethods['replaceLocalAuthoritativeState'];
  resetCloudHead(revision:number,state:unknown,options:{boundaryId:string}):ReturnType<StorageMethods['resetCloudHead']>;
}
export type Opening = {store:Storage,promise:Promise<import('./storage-journal-model.js').ReplayedStorageJournal|null>};
export type Syncing = {store:Storage,promise:Promise<boolean>};
export type {Storage,SharedState,RemoteRow as Row,StoredCloudFlight as Flight,CloudSnapshot as Cloud};
