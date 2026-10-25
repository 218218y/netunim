import type {StorageJson,StorageJsonObject as State} from './storage-json.js';
import type {CloudSnapshot,JournalMethods,CloudRecovery,ControlInput} from './storage-journal-contracts.js';
import type {RuntimeMethods} from './storage-v2-runtime-contracts.js';
import type {StoredCloudFlight} from './storage-cloud-records.js';
import type {StorageDeleteIntents} from './storage-records.js';
import type {CloudWriteScope,ScopedHead} from './cloud-write-scope.js';
import type {CloudWriteAuthorityPorts} from './cloud-write-authority.js';
import type {CloudDocument} from './cloud-read-records.js';
export type {State,StoredCloudFlight,CloudSnapshot,CloudRecovery,StorageDeleteIntents};
export type Scope = Readonly<CloudWriteScope>|null;
export type Head = CloudSnapshot|null;
export type Current = (scope:Scope,head?:ScopedHead|null)=>boolean;
export type Model = {state:State,lastNormalizeRemovedCredits:number};
export type Session = {
  cloudRevision:number,dbRevision:number,financeRevision:number,localGeneration:number,
  cloudBusy?:boolean,cloudSyncBusy?:boolean,cloudWriteBusy?:boolean,cloudConflictBlocked?:boolean,cloudConflictPending?:boolean,
  cloudSaveRequested?:boolean,cloudSaveMessage?:string,cloudPollingEnabled?:boolean,cloudAuthNoDocument?:boolean,
  syncCapabilitiesError?:unknown,syncCapabilitiesChecking?:boolean,storageProtocolBlocked?:boolean,
  connectionMode?:string,backendReady?:boolean,cloudDocumentName?:string,
  cloudUpdatedAt?:unknown,financeUpdatedAt?:unknown,lastCloudState?:State,lastSavedSnapshot?:string,
  serverInfo:Record<string,unknown>,
};
export type MergeResult = {state:State,conflicts:string[]};
export type Merge = (base:State,local:State,remote:State,options?:{deleteIntents?:StorageDeleteIntents})=>MergeResult;
export type SaveRequest = (message?:string,options?:{force?:boolean})=>Promise<boolean>;
export type Publication = {committed:true,state:CloudSnapshot,generation?:number};
export type OrdersPublication = Publication & {generation:number};
export type Observation = {generation:number,local?:State,head?:Head};
export type AdoptionReceipt = {seq:number,revision:number,pending:boolean,control:CloudSnapshot['control']};
type OrdersTransport = ReturnType<typeof import('../netunim-orders/site/assets/js/cloud/transport.js').createCloudTransport>;
type KupaTransport = ReturnType<typeof import('../netunim-kupa/site/assets/js/cloud/transport.js').createCloudTransport> & ReturnType<typeof import('../netunim-kupa/site/assets/js/cloud/main-document-write.js').createMainDocumentWrite>;
export type RpcResult = Awaited<ReturnType<OrdersTransport['rpcSaveV2']>>|Awaited<ReturnType<KupaTransport['rpcSaveCloudV2']>>;
export type AckInput = {res:RpcResult,flight:StoredCloudFlight,serverSnapshot:State,scope:Scope};
export type Journal = {
  refreshStorageV2CloudState:()=>Promise<Head>,
  materializeStorageV2CloudFlight:(options?:{throughSeq?:number,snapshot?:State})=>Promise<StoredCloudFlight|null>,
  acknowledgeStorageV2CloudFlight:(id:string,revision:number,state:State,options?:{currentState?:State,expectedSeq?:number,control?:ControlInput|null})=>Promise<Head>,
  rejectStorageV2CloudFlight:RuntimeMethods['rejectFlight'],
  setStorageV2CloudControl:(value:Parameters<CloudWriteAuthorityPorts['control']['write']>[0],options?:Parameters<CloudWriteAuthorityPorts['control']['write']>[1])=>Promise<unknown>,
  setWriteControl:ReturnType<typeof import('./cloud-write-authority.js').createCloudWriteAuthority>['setControl'],
  storageV2CommitPromise:()=>Promise<unknown>,
  adoptStorageV2CloudHead:(revision:number,state:State,options?:{cloudState?:State,expectedHead?:{seq:number,baseRevision:number}})=>Promise<AdoptionReceipt>,
  clearStorageV2CloudControl:RuntimeMethods['clearCloudControl'],
  replaceStorageV2CurrentState:RuntimeMethods['replaceCurrentState'],
  queueStorageV2CloudNormalization:(state:State,revision:number)=>Promise<unknown>,
  resetStorageV2CloudHead:(revision:number,state:State)=>Promise<unknown>,
};
export type Recovery = {
  readStorageV2CloudRecovery:RuntimeMethods['readCloudRecovery'],commitStorageV2CloudRecovery:RuntimeMethods['commitCloudRecovery'],
  cancelCloudRecovery:()=>unknown,waitForPostAckQuiet:(scope:Scope)=>Promise<boolean>,
};
export type Projection = {
  prepareCloudState:(raw:unknown)=>State,sameOrderCloudData:(a:unknown,b:unknown)=>boolean,merge3:Merge,
  composeOrderCloudState:(cloud:State,current:State)=>State,applyOrderCloudState:(state:State)=>void,
  prepareKupaCloudState:(raw:unknown)=>State,applyKupaCloudState:(state:State,checks?:StorageJson)=>State,mergeKupaCloudState3Way:Merge,
  domainRevisions?:{reconcile:(before:State,after:State,options?:{forceAll?:boolean})=>unknown}|undefined,
  applyKupaCoreState:(core:State,checks?:StorageJson,financeSource?:State)=>State,
  applyAcknowledgedCoreState:(state:State)=>boolean,replaceVisibleState:(state:State,options?:{forceAll?:boolean})=>State,
};
export type Access = {
  getCloudWriteScope:()=>Scope,storageV2PreparationActive:()=>boolean,cloudEnabled:()=>boolean,cloudHasLocalWork:()=>boolean,isOnline:()=>boolean,
  writeScopeCurrent:Current,setWriteControl:Journal['setWriteControl'],storageV2CloudOutboxActive:()=>boolean,assertAccountOwner:()=>unknown,markCloudMode:()=>unknown,
};
export type View = {
  setCloud:(text:string,status?:string)=>void,toast:(text:string)=>void,render:()=>void,refreshCloudTimestamp:()=>unknown,
  hideConnectScreen:()=>void,reportError:(text:string)=>void,setSaveStatus:(text:string,status?:string)=>void,
  setConnectedStatus:(text:string)=>void,setCloudHeaderStatus:(status:string,text?:string)=>void,showSecondaryTabGuard:()=>void,
};
export type Mirror = {files:{dirHandle:unknown},writeStateToFolder:()=>unknown,listBackups:()=>unknown,backupSnapshotToComputer:(state:State,revision:number)=>unknown};
export type Secondary = {
  pollSharedChecks:()=>Promise<unknown>,refreshKupaReadout:(options?:{renderIfChanged?:boolean})=>Promise<unknown>,
  refreshOrdersFinanceSummary:(options?:{force?:boolean,renderIfChanged?:boolean})=>Promise<unknown>,
  syncSharedChecksFromCloud:(options?:{quiet?:boolean,required?:boolean})=>Promise<unknown>,pollIndependentFinance:(options?:{isCurrent?:()=>boolean})=>Promise<boolean>,
};
export type FinanceRow = {state:State,financeAvailable?:boolean,financeRevision?:number,financeUpdatedAt?:unknown};
export type Adoption = {
  adoptRemoteRow:(row:CloudDocument,generation:number,head:Head,options?:{applyState?:boolean,isCurrent?:()=>boolean})=>Promise<boolean>,
  reviewCleanConflict:(head:CloudSnapshot)=>Promise<Head>,applyFinanceOnlyRow:(row:FinanceRow,options?:{isCurrent?:()=>boolean})=>Promise<boolean>,
  applyCloudRow:(row:NonNullable<Awaited<ReturnType<KupaTransport['readSupabaseDocument']>>>,options?:{renderNow?:boolean,isCurrent?:()=>boolean})=>Promise<State>,
  setStorageV2CloudControl:Journal['setStorageV2CloudControl'],writeStateToFolder:Mirror['writeStateToFolder'],
};
export type Confirmation = {
  pollAccessCurrent:()=>boolean,pollViewCurrent:(observation?:Partial<Observation>)=>boolean,
  markCloudPollDeferred:(head?:Head)=>false,markCloudSynced:(head:Head,observation:Observation)=>boolean,
  confirmCloudPollSynced:(observation:Observation,options?:{refreshTimestamp?:boolean,scope?:Scope})=>Promise<boolean>,
  markCloudPollFailure:(error:unknown)=>false,
  cloudScopeAccess:(force?:boolean)=>boolean,cloudConfirmationAccess:(force?:boolean)=>boolean,
  confirmCloudSynced:(generation:number,head:Head,options?:{force?:boolean,scope?:Scope})=>Promise<{synced:boolean,head:Head,advanced:boolean}>,
  markCloudPollSynced:(generation:number,head:Head,options?:{scope?:Scope})=>Promise<boolean>,
};
export type Writer = {requestCloudSave:SaveRequest,requestStorageV2CloudSave:SaveRequest,saveStorageV2CloudFlight:(flight:StoredCloudFlight,scope:Scope)=>Promise<false|OrdersPublication>,wake:()=>unknown,startCloudPolling:()=>unknown};
export type Context = {
  model:Model,session:Session,tab:{primaryTab:boolean},files:Mirror['files'],access:Access,journal:Journal,checkpoint:Journal,recovery:Recovery,
  projection:Projection,view:View,mirror:Mirror,secondary:Secondary,state:Projection&Journal,adoption:Adoption,confirmation:Confirmation,write:Writer,
  publication:{publishAcknowledgedFlight:(input:AckInput)=>Promise<false|OrdersPublication>},
};
export type OrdersContext = Omit<Context,'confirmation'> & {transport:OrdersTransport,remote:OrdersTransport,
  confirmation:Pick<Confirmation,'pollAccessCurrent'|'pollViewCurrent'|'markCloudPollDeferred'|'markCloudSynced'|'confirmCloudPollSynced'|'markCloudPollFailure'>,
};
export type KupaContext = Omit<Context,'write'|'publication'|'confirmation'> & {transport:KupaTransport,remote:KupaTransport,
  confirmation:Pick<Confirmation,'pollAccessCurrent'|'cloudScopeAccess'|'cloudConfirmationAccess'|'confirmCloudSynced'|'markCloudPollSynced'|'markCloudPollFailure'>,
  write:Omit<Writer,'saveStorageV2CloudFlight'>&{saveStorageV2CloudFlight:(flight:StoredCloudFlight,scope:Scope)=>Promise<false|Publication>},
  publication:{publishAcknowledgedFlight:(input:AckInput)=>Promise<false|Publication>},
};
// Dependency selections describe the existing composition ports. All selected
// implementations remain JavaScript roots, including their ACK/rebase bodies.
type Select<P,S> = {[K in keyof S & keyof P]:S[K] extends true?P[K]:Pick<P[K],Extract<S[K],keyof P[K]>>};

export type PostAckDiagnostic = {reason:string,attempt:number};
export type PostAckPorts = {
  diagnose?:(record:PostAckDiagnostic)=>void,waitForQuiet?:(()=>Promise<boolean>)|null,
  isCurrent:(head?:Head)=>boolean,generation:()=>number,visible:()=>State,equal:(a:unknown,b:unknown)=>boolean,
  merge:(before:State,local:State,candidate:State,deletes:StorageDeleteIntents)=>MergeResult,
  read:Recovery['readStorageV2CloudRecovery'],commit:Recovery['commitStorageV2CloudRecovery'],publish:(value:State)=>void,
};
export type PostAckCandidate = {previousState:State,candidateState:State,candidateSeq:number,baseState:State,ackRevision:number,ackSeq:number};
export type ConcurrentReview = {scope:Scope,generation:number,visible:State,evidence:CloudRecovery,remote:CloudDocument};

export type OrdersRemoteAdoptionPorts = Select<OrdersContext,{model:true,session:true,tab:true,access:"cloudEnabled",journal:"adoptStorageV2CloudHead"|"setStorageV2CloudControl",projection:"composeOrderCloudState"|"applyOrderCloudState"|"prepareCloudState",view:"setCloud"}>;
export type OrdersAckPublicationPorts = Select<OrdersContext,{model:true,session:true,tab:true,files:true,access:"writeScopeCurrent",journal:"refreshStorageV2CloudState"|"acknowledgeStorageV2CloudFlight"|"setWriteControl",projection:"prepareCloudState"|"sameOrderCloudData"|"merge3"|"composeOrderCloudState"|"applyOrderCloudState",view:"setCloud"|"toast",mirror:"writeStateToFolder",recovery:"readStorageV2CloudRecovery"|"commitStorageV2CloudRecovery"|"waitForPostAckQuiet"}>;
type OrdersWriteFlightRequiredPorts = Select<OrdersContext,{model:true,session:true,access:"writeScopeCurrent"|"getCloudWriteScope",journal:"refreshStorageV2CloudState"|"materializeStorageV2CloudFlight"|"rejectStorageV2CloudFlight"|"setWriteControl",projection:"prepareCloudState"|"merge3"|"composeOrderCloudState"|"applyOrderCloudState",transport:"rpcSaveV2"|"readCloud",view:"setCloud"|"toast",publication:"publishAcknowledgedFlight",recovery:"readStorageV2CloudRecovery"|"commitStorageV2CloudRecovery"}>;
export type OrdersWriteFlightPorts = Omit<OrdersWriteFlightRequiredPorts,'recovery'>&{recovery?:Partial<OrdersWriteFlightRequiredPorts['recovery']>};
export type OrdersConfirmationPorts = Select<OrdersContext,{model:true,session:true,tab:true,access:"isOnline"|"storageV2PreparationActive"|"cloudEnabled"|"cloudHasLocalWork"|"writeScopeCurrent",state:"sameOrderCloudData"|"refreshStorageV2CloudState",view:"setCloud"|"refreshCloudTimestamp"}>;
export type OrdersSaveOperationPorts = Select<OrdersContext,{session:true,tab:true,access:"cloudEnabled"|"getCloudWriteScope"|"writeScopeCurrent"|"setWriteControl"|"isOnline",journal:"refreshStorageV2CloudState"|"materializeStorageV2CloudFlight"|"storageV2CommitPromise",write:"saveStorageV2CloudFlight",confirmation:true,view:"setCloud"|"toast"}>;
export type OrdersPollingPorts = Select<OrdersContext,{model:true,session:true,tab:true,files:true,access:"getCloudWriteScope"|"writeScopeCurrent"|"isOnline"|"storageV2PreparationActive"|"cloudEnabled"|"cloudHasLocalWork",state:"prepareCloudState"|"sameOrderCloudData"|"refreshStorageV2CloudState",view:"setCloud"|"render"|"toast",remote:"readCloudMeta"|"readCloud",adoption:"adoptRemoteRow"|"writeStateToFolder",secondary:"pollSharedChecks"|"refreshKupaReadout",write:"requestCloudSave",confirmation:true}>;
export type OrdersDocumentPorts = Select<OrdersContext,{model:true,session:true,tab:true,access:"getCloudWriteScope"|"storageV2PreparationActive"|"cloudEnabled"|"cloudHasLocalWork"|"isOnline",journal:"refreshStorageV2CloudState"|"materializeStorageV2CloudFlight"|"acknowledgeStorageV2CloudFlight"|"rejectStorageV2CloudFlight"|"setStorageV2CloudControl"|"storageV2CommitPromise",checkpoint:"adoptStorageV2CloudHead",recovery:"readStorageV2CloudRecovery"|"commitStorageV2CloudRecovery"|"cancelCloudRecovery",projection:"prepareCloudState"|"sameOrderCloudData"|"merge3"|"composeOrderCloudState"|"applyOrderCloudState",transport:"readCloud"|"readCloudMeta"|"rpcSaveV2",view:"setCloud"|"toast"|"render"|"refreshCloudTimestamp",mirror:"files"|"writeStateToFolder",secondary:"pollSharedChecks"|"refreshKupaReadout"}>;

export type KupaRemoteAdoptionPorts = Select<KupaContext,{model:true,session:true,tab:true,access:"getCloudWriteScope"|"writeScopeCurrent"|"storageV2CloudOutboxActive"|"assertAccountOwner"|"markCloudMode",journal:"refreshStorageV2CloudState"|"replaceStorageV2CurrentState"|"clearStorageV2CloudControl"|"adoptStorageV2CloudHead"|"setStorageV2CloudControl"|"queueStorageV2CloudNormalization"|"resetStorageV2CloudHead",projection:"domainRevisions"|"prepareKupaCloudState"|"applyKupaCloudState",transport:"readSupabaseDocument"|"readFinanceSyncDocument",view:"setSaveStatus"|"setCloudHeaderStatus"|"hideConnectScreen"|"setConnectedStatus"|"render",mirror:"listBackups"|"backupSnapshotToComputer",secondary:"syncSharedChecksFromCloud"|"refreshOrdersFinanceSummary",write:"requestStorageV2CloudSave"|"startCloudPolling"}>;
export type KupaAckPublicationPorts = Select<KupaContext,{model:true,session:true,tab:true,access:"writeScopeCurrent",journal:"refreshStorageV2CloudState"|"acknowledgeStorageV2CloudFlight"|"setWriteControl",projection:"prepareKupaCloudState"|"mergeKupaCloudState3Way"|"applyKupaCoreState"|"applyAcknowledgedCoreState",view:"setSaveStatus"|"setCloudHeaderStatus"|"reportError"|"render",mirror:"backupSnapshotToComputer",recovery:"readStorageV2CloudRecovery"|"commitStorageV2CloudRecovery"}>;
type KupaWriteFlightRequiredPorts = Select<KupaContext,{model:true,session:true,access:"writeScopeCurrent"|"getCloudWriteScope",journal:"refreshStorageV2CloudState"|"materializeStorageV2CloudFlight"|"rejectStorageV2CloudFlight"|"setWriteControl",projection:"prepareKupaCloudState"|"mergeKupaCloudState3Way"|"applyKupaCoreState"|"replaceVisibleState",transport:"rpcSaveCloudV2"|"readSupabaseDocument",view:"setSaveStatus"|"setCloudHeaderStatus"|"reportError"|"render",publication:"publishAcknowledgedFlight",recovery:"readStorageV2CloudRecovery"|"commitStorageV2CloudRecovery"}>;
export type KupaWriteFlightPorts = Omit<KupaWriteFlightRequiredPorts,'recovery'>&{recovery?:Partial<KupaWriteFlightRequiredPorts['recovery']>};
export type KupaConfirmationPorts = Select<KupaContext,{model:true,session:true,tab:true,access:"isOnline"|"storageV2PreparationActive"|"storageV2CloudOutboxActive"|"assertAccountOwner"|"writeScopeCurrent",state:"prepareKupaCloudState"|"refreshStorageV2CloudState",view:"setSaveStatus"|"setCloudHeaderStatus"}>;
export type KupaSaveOperationPorts = Select<KupaContext,{session:true,tab:true,access:"getCloudWriteScope"|"writeScopeCurrent"|"setWriteControl"|"isOnline"|"storageV2CloudOutboxActive",journal:"refreshStorageV2CloudState"|"materializeStorageV2CloudFlight"|"storageV2CommitPromise",write:"saveStorageV2CloudFlight"|"wake",confirmation:true,view:"setSaveStatus"|"setCloudHeaderStatus"|"showSecondaryTabGuard"|"toast"}>;
export type KupaPollingPorts = Select<KupaContext,{model:true,session:true,tab:true,access:"getCloudWriteScope"|"writeScopeCurrent"|"isOnline"|"storageV2PreparationActive"|"storageV2CloudOutboxActive"|"assertAccountOwner",state:"prepareKupaCloudState"|"refreshStorageV2CloudState",view:"setSaveStatus"|"setCloudHeaderStatus"|"toast",remote:"readSupabaseDocument",adoption:"reviewCleanConflict"|"applyFinanceOnlyRow"|"applyCloudRow"|"setStorageV2CloudControl",secondary:"pollSharedChecks"|"pollIndependentFinance"|"refreshOrdersFinanceSummary",write:"requestStorageV2CloudSave",confirmation:true}>;
export type KupaDocumentPorts = Select<KupaContext,{model:true,session:true,tab:true,access:"getCloudWriteScope"|"storageV2PreparationActive"|"storageV2CloudOutboxActive"|"assertAccountOwner"|"isOnline"|"markCloudMode",journal:"refreshStorageV2CloudState"|"materializeStorageV2CloudFlight"|"acknowledgeStorageV2CloudFlight"|"rejectStorageV2CloudFlight"|"setStorageV2CloudControl"|"storageV2CommitPromise",checkpoint:"clearStorageV2CloudControl"|"replaceStorageV2CurrentState"|"queueStorageV2CloudNormalization"|"adoptStorageV2CloudHead"|"resetStorageV2CloudHead",recovery:"readStorageV2CloudRecovery"|"commitStorageV2CloudRecovery"|"cancelCloudRecovery",projection:"prepareKupaCloudState"|"applyKupaCloudState"|"mergeKupaCloudState3Way"|"domainRevisions",transport:"readSupabaseDocument"|"readFinanceSyncDocument"|"rpcSaveCloudV2",view:"hideConnectScreen"|"reportError"|"setSaveStatus"|"setConnectedStatus"|"setCloudHeaderStatus"|"showSecondaryTabGuard"|"toast"|"render",mirror:"listBackups"|"backupSnapshotToComputer",secondary:"syncSharedChecksFromCloud"|"pollSharedChecks"|"refreshOrdersFinanceSummary"}>;
