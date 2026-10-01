import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cloudWriteError,
  createDataApiScheduler,
  createOperationId,
  createOutboxRetryScheduler,
  getOutboxRetryDelay,
  normalizeCloudError,
  runBusyCloudWriteWithPolicy,
} from '../shared/cloud-sync.js';
import {createSyncChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';

const canonical=value=>JSON.stringify(value);

test('machine-readable errors distinguish app contention from generic HTTP throttling/conflicts',()=>{
  assert.equal(normalizeCloudError({r:{status:429},j:{code:'PT429',message:'save_busy'}}).kind,'busy');
  assert.equal(normalizeCloudError({r:{status:409},j:{code:'PT409',message:'revision_conflict'}}).kind,'revision_conflict');
  assert.equal(normalizeCloudError({r:{status:400},j:{code:'40001',message:'revision_conflict'}}).kind,'revision_conflict'); // one-release legacy fallback
  assert.equal(normalizeCloudError({r:{status:400},j:{code:'40001',message:'stale_bank_snapshot_watermark'}}).kind,'fatal');
  const rateLimited=normalizeCloudError({r:{status:429,headers:{get:name=>name==='retry-after'?'7':null}},j:{code:'gateway_rate_limit',message:'too many requests'}});
  assert.equal(rateLimited.kind,'rate_limited');assert.equal(rateLimited.retryAfterMs,7000);
  assert.equal(normalizeCloudError({r:{status:409},j:{code:'23505',message:'unique conflict'}}).kind,'conflict');
  assert.equal(normalizeCloudError({r:{status:503},j:{code:'PGRST002'}}).kind,'service_unavailable');
  assert.equal(normalizeCloudError({code:'SUPABASE_NETWORK_TIMEOUT'}).kind,'timeout');
});

test('operation IDs prefer injected UUIDs and retain deterministic fallback support',()=>{
  const first=createOperationId('orders',{now:()=>1_700_000_000_000,randomUUID:()=> '11111111-1111-4111-8111-111111111111'});
  const next=createOperationId('orders',{now:()=>1_700_000_000_100,randomUUID:()=> '22222222-2222-4222-8222-222222222222'});
  assert.equal(first,'orders:11111111-1111-4111-8111-111111111111');assert.notEqual(next,first);
  const fallback=createOperationId('kupa',{now:()=>1234,random:()=>0.5,randomUUID:null});
  assert.equal(fallback,`kupa:${(1234).toString(36)}:${(0.5).toString(36).slice(2,10)}`);
});

test('persisted Retry-After blocks V2 retry traffic until the exact not-before',()=>{
  const started=Date.parse('2026-09-03T10:00:00.000Z'),response={r:{ok:false,status:429,headers:{get:name=>name==='retry-after'?'60':null}},j:{code:'gateway_rate_limit',message:'too many requests'}};
  const failure=cloudWriteError(response);assert.equal(failure.kind,'rate_limited');assert.equal(failure.retryAfterMs,60_000);
  const flight={domain:'orders',documentName:'main',generation:1,operationId:'orders:stable-op',retry:{attempts:1,lastErrorCode:failure.kind,lastAttemptAt:new Date(started).toISOString(),nextAttemptAt:new Date(started+failure.retryAfterMs).toISOString()}};
  assert.equal(getOutboxRetryDelay(flight,()=>started+10_000),50_000);
  assert.equal(getOutboxRetryDelay(flight,()=>started+59_000),1_000);
  assert.equal(getOutboxRetryDelay(flight,()=>started+60_000),0);
});

test('outbox retry scheduling keeps at most one timer for the current pending generation',()=>{
  const started=Date.parse('2026-09-03T10:00:00.000Z');let now=started,resumes=0,nextTimer=0;const active=new Map();
  const scheduler=createOutboxRetryScheduler({now:()=>now,setTimer:(callback,delay)=>{const id=++nextTimer;active.set(id,{callback,delay});return id},clearTimer:id=>active.delete(id),onError:error=>{throw error}});
  const make=(generation,operationId)=>({domain:'kupa',documentName:'main',operationId,generation,retry:{nextAttemptAt:new Date(started+60_000).toISOString()}});
  const first=make(1,'kupa:one');assert.equal(scheduler.schedule(first,()=>{resumes++}),60_000);assert.equal(scheduler.schedule(first,()=>{resumes++}),60_000);assert.equal(active.size,1);
  const newer=make(2,'kupa:two');assert.equal(scheduler.schedule(newer,()=>{resumes++}),60_000);assert.equal(active.size,1);
  now=started+60_000;active.values().next().value.callback();assert.equal(active.size,1); // fake timer remains registered until the harness consumes it
  assert.equal(resumes,1);assert.equal(scheduler.stats().scheduled,false);
});

test('shared write policy retries the identical busy operation exactly three times',async()=>{
  let calls=0,waits=0;
  const result=await runBusyCloudWriteWithPolicy(()=>{calls++;return {r:{ok:false,status:429},j:{code:'PT429',message:'save_busy'},operationId:'same-operation'}},{delay:()=>0,sleep:async()=>{waits++}});
  assert.equal(result.operationId,'same-operation');assert.equal(calls,3);assert.equal(waits,2);
});

test('priority scheduler is single-lane, coalesces polls and bounds write starvation',async()=>{
  const scheduler=createDataApiScheduler({maxHighBurst:4});
  const order=[];let active=0,maxActive=0;
  const task=name=>async()=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();order.push(name);active--;return name};
  const poll1=scheduler.schedule(task('poll'),{priority:'low',key:'versions'});
  const poll2=scheduler.schedule(task('duplicate-poll'),{priority:'low',key:'versions'});
  assert.equal(poll1,poll2);
  const writes=Array.from({length:6},(_,index)=>scheduler.schedule(task(`write-${index+1}`),{priority:'high'}));
  await Promise.all([...writes,poll1]);
  assert.equal(maxActive,1);
  assert.deepEqual(order.slice(0,5),['write-1','write-2','write-3','write-4','poll']);
  assert.equal(order.includes('duplicate-poll'),false);
});

test('identical low-priority poll coalesces while the first request is already in flight',async()=>{
  const scheduler=createDataApiScheduler();let backendCalls=0,release;
  const gate=new Promise(resolve=>{release=resolve});
  const first=scheduler.schedule(async()=>{backendCalls++;await gate;return 'same-result'},{priority:'low',key:'versions'});
  await Promise.resolve();await Promise.resolve();
  const second=scheduler.schedule(async()=>{backendCalls++;return 'duplicate'},{priority:'low',key:'versions'});
  assert.equal(first,second);assert.equal(backendCalls,1);
  release();assert.equal(await first,'same-result');assert.equal(await second,'same-result');assert.equal(backendCalls,1);
});

test('503 breaker storm executes one backend request, then one recovery probe; 429 does not trip it',async()=>{
  let available=true,backendRequests=0;
  const scheduler=createDataApiScheduler({canRun:()=>available});
  const first=scheduler.schedule(async()=>{backendRequests++;available=false;return 503},{priority:'high'});
  const storm=Array.from({length:29},()=>scheduler.schedule(async()=>{backendRequests++;return 503},{priority:'high',blockedError:()=>Object.assign(new Error('breaker'),{code:'SUPABASE_DATA_API_BACKOFF'})}));
  await first;
  const settled=await Promise.allSettled(storm);
  assert.equal(backendRequests,1);
  assert.equal(settled.every(result=>result.status==='rejected'),true);
  available=true;
  assert.equal(await scheduler.schedule(async()=>{backendRequests++;return 200},{priority:'high'}),200);
  assert.equal(backendRequests,2);
  for(let index=0;index<3;index++)assert.equal(await scheduler.schedule(async()=>{backendRequests++;return 429},{priority:'high'}),429);
  assert.equal(backendRequests,5);
});

class OperationLedgerServer{
  constructor(){this.state={value:'base',remote:null};this.revision=0;this.commits=0;this.operations=new Map()}
  save(operationId,snapshot,expected,{lostAck=false}={}){
    const fingerprint=canonical(snapshot),previous=this.operations.get(operationId);
    if(previous){if(previous.fingerprint!==fingerprint)throw Object.assign(new Error('idempotency_key_reuse'),{code:'PT422'});return {revision:this.revision,state:structuredClone(this.state),operationReplayed:true,operationRevision:previous.revision}}
    if(expected!==this.revision)return {conflict:true,revision:this.revision,state:structuredClone(this.state)};
    this.state=structuredClone(snapshot);this.revision++;this.commits++;this.operations.set(operationId,{fingerprint,revision:this.revision});
    if(lostAck)throw Object.assign(new Error('ACK lost'),{code:'SUPABASE_NETWORK_UNAVAILABLE',committed:true});
    return {revision:this.revision,state:structuredClone(this.state),operationReplayed:false,operationRevision:this.revision};
  }
  external(snapshot){this.state=structuredClone(snapshot);this.revision++;this.commits++}
}

test('operation ledger acknowledges lost ACK even after an intervening remote write',()=>{
  const server=new OperationLedgerServer(),operationId='orders-op-1',original={value:'local-A',remote:null};
  assert.throws(()=>server.save(operationId,original,0,{lostAck:true}),error=>error.committed===true);
  assert.equal(server.revision,1);
  server.external({value:'local-A',remote:'remote-B'});assert.equal(server.revision,2);
  const replay=server.save(operationId,original,0);
  assert.equal(replay.operationReplayed,true);assert.equal(replay.operationRevision,1);assert.equal(replay.revision,2);
  assert.deepEqual(replay.state,{value:'local-A',remote:'remote-B'});assert.equal(server.revision,2);assert.equal(server.commits,2);
  assert.throws(()=>server.save(operationId,{value:'different',remote:null},0),error=>error.code==='PT422');
});

test('bank snapshot token and archive batch replays are side-effect free',()=>{
  const state={financeRevision:10,kupaRevision:20,bank:null,operations:new Map(),transactions:new Map()};
  function saveSnapshot(token,seq,payload){const fingerprint=canonical({seq,payload}),previous=state.operations.get(token);if(previous){if(previous!==fingerprint)throw Object.assign(new Error('idempotency_key_reuse'),{code:'PT422'});return {financeRevision:state.financeRevision,kupaRevision:state.kupaRevision}}state.operations.set(token,fingerprint);state.bank=structuredClone(payload);state.financeRevision++;state.kupaRevision++;return {financeRevision:state.financeRevision,kupaRevision:state.kupaRevision}}
  function merge(batch){let inserted=0,updated=0;for(const row of batch){const before=state.transactions.get(row.mergeKey);if(!before){state.transactions.set(row.mergeKey,structuredClone(row));inserted++}else if(canonical(before)!==canonical(row)){state.transactions.set(row.mergeKey,structuredClone(row));updated++}}return {inserted,updated,total:state.transactions.size}}
  const payload={balance:123,transactions:[{id:'one'}]},first=saveSnapshot('token-1',7,payload),replay=saveSnapshot('token-1',7,payload);
  assert.deepEqual(replay,first);assert.equal(state.financeRevision,11);assert.equal(state.kupaRevision,21);
  assert.throws(()=>saveSnapshot('token-1',7,{...payload,balance:124}),error=>error.code==='PT422');
  const batch=[{mergeKey:'tx-1',amount:1},{mergeKey:'tx-2',amount:2}],merged=merge(batch),mergedAgain=merge(batch);
  assert.deepEqual(merged,{inserted:2,updated:0,total:2});assert.deepEqual(mergedAgain,{inserted:0,updated:0,total:2});
  assert.equal(canonical([...state.transactions.values()]),canonical(batch));
});

test('Shared Checks merges independent cross-app edits and fails closed on same-check conflict',()=>{
  const checksSession={sharedChecksBootstrapActive:false};
  const {mergeSharedChecks}=createSyncChecks({checksSession});
  const base=[{id:'A',amount:100,status:'open',dueDate:'2026-09-01'},{id:'B',amount:200,status:'open',dueDate:'2026-09-02'}];
  const orders=[{...base[0],amount:110},base[1]],kupa=[base[0],{...base[1],amount:220}];
  const disjoint=mergeSharedChecks(base,orders,kupa);
  assert.equal(disjoint.conflicts.length,0);
  assert.deepEqual(disjoint.checks.map(check=>[check.id,check.amount]),[['A',110],['B',220]]);
  const conflict=mergeSharedChecks(base,[{...base[0],amount:111},base[1]],[{...base[0],amount:112},base[1]]);
  assert.ok(conflict.conflicts.some(item=>item.includes('A')));
  const stalePartial=mergeSharedChecks(base,[base[0]],base);assert.deepEqual(stalePartial.checks.map(check=>check.id),['A','B'],'stale incomplete snapshots cannot imply deletion');
  const explicitDelete=mergeSharedChecks(base,[base[0]],base,{deleteIds:['B']});assert.deepEqual(explicitDelete.checks.map(check=>check.id),['A'],'explicit deletion intent is honored');
});
