import type {State,Validate} from './storage-journal-contracts.js';
import type {StorageJournalDb} from './storage-journal-db.js';
import type {RuntimeMethods as MainRuntime} from './storage-v2-runtime-contracts.js';
type SharedRuntime = ReturnType<typeof import('./shared-checks-v2-runtime.js').createSharedChecksV2Runtime>;
type CommonAction = State & {state:State,cloudState?:State,expectedSeq?:number,expectedBaseRevision?:number,requireCleanCloud?:true,options?:State & {appMetadata?:State}};
export type Action = CommonAction & (
  {kind:'replace-authoritative'}|{kind:'reset-cloud-head',revision:number}|
  {kind:'replace-local-with-pending',expectedSeq:number,expectedBaseRevision:number,requireCleanCloud:true}|
  {kind:'replace-local-authoritative',expectedSeq:number}
);
export type Main = Pick<MainRuntime,'recover'|'cloudState'|'replaceLocalWithPending'|'replaceLocalAuthoritativeState'|'resetCloudHead'|'replaceAuthoritativeState'>;
export type Shared = Pick<SharedRuntime,'recover'|'cloudState'|'replaceLocalWithPending'|'replaceLocalAuthoritativeState'|'resetCloudHead'|'replaceAuthoritativeState'>;
export type Options = {owner:()=>string,primary:()=>boolean,main:Main,shared:Shared,validateMainCloud?:Validate,
  db?:Pick<StorageJournalDb,'readBoundary'|'beginBoundary'|'advanceBoundary'|'completeBoundary'>,now?:()=>string};
export type Expected = {id:string,phase:import('./storage-operation.js').BoundaryPhase|'complete',intent:import('./storage-operation.js').PendingBoundary};
