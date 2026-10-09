// Compile-only consumers of the actual JavaScript implementations. Never run
// this file: the invalid calls deliberately prove that the contracts are closed.
import {createAuthenticatedAccountScope} from '../../shared/authenticated-account-scope.js';
import {createMorningOperationScope} from '../../netunim-orders/site/assets/js/core/morning-operation-scope.js';
import {createMorningRequest} from '../../netunim-orders/site/assets/js/integrations/morning.js';

const morningScope=createMorningOperationScope({readAccess:()=>({account:{owner:'A',epoch:1},storageOwner:'A',readable:true,writable:true})});
// @ts-expect-error login epoch must be numeric and cannot be silently stringified
createMorningOperationScope({readAccess:()=>({account:{owner:'A',epoch:'1'},storageOwner:'A',readable:true,writable:true})});
// @ts-expect-error current authority is checked synchronously before publication
createMorningRequest({supaFetch:async()=>new Response('{}'),operationScope:{capture:()=>async()=>{},captureRead:()=>async()=>{}}});
// @ts-expect-error a raw auth client cannot replace the explicit authority port
createMorningRequest({supaFetch:async()=>new Response('{}')});
const morningClient=createMorningRequest({supaFetch:async(_path,options)=>{options.assertRequestScope();return new Response('{}')},operationScope:morningScope});
// @ts-expect-error boolean snapshots cannot fence a queued Morning request
morningClient.json('create',{},true);
// @ts-expect-error PDF publication must use a synchronous authority receipt
morningClient.pdf('id',async()=>{});
import {commitCloudCheckpoint} from '../../shared/cloud-checkpoint-publication.js';
import {createPollingTask} from '../../shared/runtime-polling.js';
import {createStartupTask} from '../../shared/startup-task.js';
import {cloudHeadIsSynced} from '../../shared/storage-cloud-status.js';
import {createStorageStartupProtocol} from '../../shared/storage-startup-protocol.js';
import {createStorageStartupRecovery} from '../../shared/storage-startup-recovery.js';
import {checkStorageProtocolStartup} from '../../shared/storage-v2-server-protocol.js';

/** @type {import('../../shared/storage-cloud-status.js').CloudStatusHead} */
const head={seq:3,base:{owner:'account',epoch:'journal-epoch',ackSeq:3,revision:7},pending:false,flight:null,control:null};
cloudHeadIsSynced(head,{revision:7,observedHead:head});
cloudHeadIsSynced(null);
// @ts-expect-error cursor sequence must be a number
cloudHeadIsSynced({...head,seq:'3'},{revision:7});
// @ts-expect-error a cloud cursor must include its durable ACK sequence
cloudHeadIsSynced({...head,base:{owner:'account',epoch:'journal-epoch',revision:7}},{revision:7});
// @ts-expect-error an observed head needs owner and epoch evidence
cloudHeadIsSynced(head,{revision:7,observedHead:{seq:3,base:{owner:'account'}}});
// @ts-expect-error remote revision cannot be a serialized string
cloudHeadIsSynced(head,{revision:'7'});
// @ts-expect-error pending is a boolean, not a display status
cloudHeadIsSynced({...head,pending:'synced'},{revision:7});

const account=createAuthenticatedAccountScope({loadSession:()=>({user:{id:'account'}})});
const identity=account.current();
account.replace(null);account.replace({user:{id:'account'}},{refresh:true});
account.assertCurrent(identity);
// @ts-expect-error login epoch is numeric and distinct from the journal epoch
account.assertCurrent({owner:'account',epoch:'journal-epoch'});
// @ts-expect-error a captured identity cannot omit its owner
account.assertCurrent({epoch:1});
// @ts-expect-error refresh cannot be a truthy string
account.replace(null,{refresh:'true'});

const publication=await commitCloudCheckpoint({commit:async()=>({revision:7,ackSeq:3}),
  isCurrent:receipt=>receipt.revision===7&&receipt.ackSeq===3,publish:()=>{}});
/** @type {number} */
const revision=publication.committed.revision;
if(!publication.published){
  /** @type {'stale'|'publication-error'} */
  const reason=publication.reason;
  if(reason==='publication-error'){
    /** @type {unknown} */
    const cause=publication.error;
    // @ts-expect-error unknown thrown values require narrowing before inspection
    cause.message;
  }else{
    // @ts-expect-error a stale receipt does not contain a publication exception
    publication.error;
  }
}else{
  // @ts-expect-error success has no failure reason
  publication.reason;
}
// @ts-expect-error callback must receive the actual committed receipt shape
commitCloudCheckpoint({commit:async()=>({revision:7}),isCurrent:(/** @type {{epoch:string}} */ receipt)=>!!receipt.epoch,publish:()=>{}});
// @ts-expect-error async publication would escape the synchronous error boundary
commitCloudCheckpoint({commit:async()=>revision,isCurrent:()=>true,publish:async()=>{}});
// @ts-expect-error publication does not return an unrelated acknowledgement
commitCloudCheckpoint({commit:async()=>revision,isCurrent:()=>true,publish:()=>true});

const protocol=createStorageStartupProtocol({ownership:{current:()=>identity.owner,authenticated:()=>identity.owner},
  markers:{account:async()=>true,local:async()=>false},account:{read:async()=>({orders:2,kupa:2,sharedChecks:2}),recoverAccount:async()=>true}});
const decision=await protocol.check({primary:true,online:true});
if(decision.protocol.allowed){
  /** @type {'v2-ready'|'local-birth'} */
  const allowedReason=decision.protocol.reason;
  // @ts-expect-error verification-required cannot grant write readiness
  /** @type {'verification-required'} */ const blockedReason=allowedReason;
}
// @ts-expect-error account marker must be boolean, not a protocol revision
createStorageStartupProtocol({ownership:{current:()=>null,authenticated:()=>null},markers:{account:async()=>2,local:async()=>true},account:{read:async()=>null,recoverAccount:async()=>true}});
// @ts-expect-error primary context cannot be a serialized flag
protocol.check({primary:'true',online:true});
// @ts-expect-error a protocol reader is asynchronous
checkStorageProtocolStartup({readProtocolState:()=>({orders:2,kupa:2,sharedChecks:2})});
// @ts-expect-error protocol gate accepts actual boolean activation evidence
checkStorageProtocolStartup({owner:'account',accountV2Active:'true'});
/** @type {import('../../shared/storage-v2-server-protocol.js').StorageProtocolDecision} */
// @ts-expect-error blocked server-v2 observation cannot grant readiness
const unsafeDecision={allowed:true,reason:'server-v2'};

const recovery=createStorageStartupRecovery({wait:async delay=>{if(delay<0)throw new Error('invalid delay')}});
recovery.bind({main:{primary:async context=>context.localEngineActive,readOnly:async()=>true},shared:{primary:async()=>true,readOnly:async()=>true}});
const recovered=await recovery.primary({localEngineActive:true});
if(recovered){
  /** @type {unknown} */
  const opaqueJournalResult=recovered.main;
  // @ts-expect-error recovery readiness is not a typed business checkpoint
  opaqueJournalResult.seq;
}
/** @type {import('../../shared/storage-startup-recovery.js').RecoveryPhase} */
const phase=recovery.snapshot().phase;
// @ts-expect-error both primary and read-only journal ports are required
recovery.bind({main:{primary:async()=>true},shared:{primary:async()=>true,readOnly:async()=>true}});
// @ts-expect-error primary recovery requires explicit local-engine context
recovery.primary();
// @ts-expect-error read-only recovery takes no write activation context
recovery.readOnly({localEngineActive:true});
// @ts-expect-error snapshots cannot be mutated to grant UI readiness
recovery.snapshot().phase='ready';
// @ts-expect-error wait port must return an observed Promise
createStorageStartupRecovery({wait:()=>true});

const startup=createStartupTask(async()=>({phase,revision}));
/** @type {number} */
const retainedRevision=(await startup()).revision;
// @ts-expect-error retained startup result cannot silently become a string
/** @type {string} */ const wrongRevision=(await startup()).revision;
// @ts-expect-error startup has one task function, not a task result
createStartupTask({revision:retainedRevision});

const poll=createPollingTask({run:async receipt=>receipt.isCurrent(),delay:()=>1000,
  onError:error=>{if(error instanceof Error)console.error(error.message)},onState:state=>{if(state.timer!==null)clearTimeout(state.timer)}});
poll.start();poll.stop();await poll.wake();
// @ts-expect-error scheduling delay is a number, not an unresolved Promise
createPollingTask({run:()=>true,delay:async()=>1000,onError:()=>{}});
/** @type {(value:boolean)=>boolean} */
const requireBoolean=value=>value;
// @ts-expect-error active ownership receipt is a function, not a cached flag
createPollingTask({run:receipt=>requireBoolean(receipt.isCurrent),delay:()=>1000,onError:()=>{}});
// @ts-expect-error error observation is mandatory for asynchronous jobs
createPollingTask({run:()=>true,delay:()=>1000});
// @ts-expect-error scheduling state does not expose mutable account authorization
createPollingTask({run:()=>true,delay:()=>1000,onError:()=>{},onState:state=>state.owner});

const {createCreditPublication}=await import('../../netunim-kupa/site/assets/js/domains/credit/publication.js');
const creditPorts={commit:async()=>({saved:true,row:{revision:2,state:{creditSync:{}}}}),publish:()=>undefined,checkpoint:async()=>true,read:async()=>({verified:true,state:{creditSync:{}},financeRevision:2})};
const creditPublication=createCreditPublication(creditPorts);
const creditResult=await creditPublication.commit(state=>state,'fixture',null,()=>undefined);
/** @type {true} */ const remoteCreditCommitted=creditResult.remoteCommitted;
/** @type {boolean} */ const localFollowupConfirmed=creditResult.followupConfirmed;
// @ts-expect-error remote commitment is distinct from local follow-up confirmation
/** @type {true} */ const unsafeFollowup=localFollowupConfirmed;
// @ts-expect-error publication must be synchronous, without late mutation after a guard
createCreditPublication({...creditPorts,publish:async()=>undefined});
// @ts-expect-error live assertion is a function, not a cached authorization boolean
creditPublication.retry(true);
// @ts-expect-error Finance read revision must be numeric, never a serialized value
createCreditPublication({...creditPorts,read:async()=>({verified:true,state:{},financeRevision:'2'})});
// @ts-expect-error a confirmed server receipt cannot use a truthy string
createCreditPublication({...creditPorts,commit:async()=>({saved:'true'})});
