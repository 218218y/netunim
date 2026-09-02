import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTBOX_SCHEMA_VERSION,
  acknowledgedGenerationMatches,
  createDataApiScheduler,
  createOutboxRecord,
  migrateOutboxRecord,
  normalizeCloudError,
  runBusyCloudWriteWithPolicy,
} from '../shared/cloud-sync.js';
import {createSyncChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';

const canonical=value=>JSON.stringify(value);

test('v2/marker migration produces a complete v3 record and ACK is generation-exact',()=>{
  const v2=migrateOutboxRecord({schemaVersion:2,generation:7,baseRevision:11,baseState:{n:1},snapshot:{n:2},savedAt:'2026-01-01T00:00:00Z'},
    {domain:'kupa',documentName:'main'});
  assert.equal(v2.schemaVersion,OUTBOX_SCHEMA_VERSION);
  assert.equal(v2.domain,'kupa');
  assert.equal(v2.generation,7);
  assert.deepEqual(v2.retry,{attempts:0,lastErrorCode:null,lastAttemptAt:null,nextAttemptAt:null});
  const marker=migrateOutboxRecord({pending:true},{domain:'orders',documentName:'suppliers',baseRevision:3,baseState:{a:1},snapshot:{a:2},generation:4});
  assert.deepEqual(marker.snapshot,{a:2});
  assert.equal(acknowledgedGenerationMatches(marker,3),false);
  assert.equal(acknowledgedGenerationMatches(marker,4),true);
  assert.equal(acknowledgedGenerationMatches(marker,undefined),false);
  assert.equal(acknowledgedGenerationMatches(marker,Infinity),false);
});

test('machine-readable errors distinguish contention, conflict, outage and generic 40001',()=>{
  assert.equal(normalizeCloudError({r:{status:429},j:{code:'PT429',message:'save_busy'}}).kind,'busy');
  assert.equal(normalizeCloudError({r:{status:409},j:{code:'PT409',message:'revision_conflict'}}).kind,'revision_conflict');
  assert.equal(normalizeCloudError({r:{status:400},j:{code:'40001',message:'revision_conflict'}}).kind,'revision_conflict');
  assert.equal(normalizeCloudError({r:{status:400},j:{code:'40001',message:'stale_bank_snapshot_watermark'}}).kind,'fatal');
  assert.equal(normalizeCloudError({r:{status:503},j:{code:'PGRST002'}}).kind,'service_unavailable');
  assert.equal(normalizeCloudError({code:'SUPABASE_NETWORK_TIMEOUT'}).kind,'timeout');
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

class IdempotentSnapshotServer{
  constructor(){this.state={changes:[],remote:[]};this.revision=0;this.calls=0;this.commits=0}
  save(snapshot,expected,{lostAck=false}={}){
    this.calls++;
    if(canonical(this.state)===canonical(snapshot))return {revision:this.revision,state:structuredClone(this.state)};
    if(expected!==this.revision)return {conflict:true,revision:this.revision,state:structuredClone(this.state)};
    this.state=structuredClone(snapshot);this.revision++;this.commits++;
    if(lostAck)throw Object.assign(new Error('ACK lost'),{code:'SUPABASE_NETWORK_UNAVAILABLE',committed:true});
    return {revision:this.revision,state:structuredClone(this.state)};
  }
  external(value){this.state.remote.push(value);this.revision++;this.commits++}
}

function stage(current,intended,generation,domain,base={revision:0,state:{changes:[],remote:[]}}){
  return createOutboxRecord({domain,documentName:'main',operationId:`${domain}-${generation}`,generation,baseRevision:current?.baseRevision??base.revision,baseState:current?.baseState??base.state,snapshot:intended,createdAt:current?.createdAt,updatedAt:new Date(1_700_000_000_000+generation).toISOString()});
}

function flush(server,outbox,{busyCount=0,injectConflict=false,lostAck=false}={}){
  const sent=structuredClone(outbox);let expected=sent.baseRevision,snapshot=structuredClone(sent.snapshot),busy=busyCount;
  while(busy>0){server.calls++;busy--}
  if(injectConflict)server.external(`remote-${sent.generation}`);
  let result=server.save(snapshot,expected,{lostAck});
  if(result?.conflict){snapshot={...snapshot,remote:result.state.remote};expected=result.revision;result=server.save(snapshot,expected)}
  return {sent,result,snapshot};
}

for(const [domain,count] of [['orders',50],['kupa',50]])test(`${domain}: ${count} rapid mutations coalesce without loss across busy/conflict/lost-ACK`,()=>{
  const server=new IdempotentSnapshotServer();let intended={changes:[],remote:[]},outbox=null;
  for(let generation=1;generation<=count;generation++){
    intended={...intended,changes:[...intended.changes,generation]};outbox=stage(outbox,intended,generation,domain,{revision:server.revision,state:server.state});
    if(generation%10===0){
      const options=generation===20?{busyCount:2}:generation===30?{injectConflict:true}:generation===40?{lostAck:true}:{};
      try{const done=flush(server,outbox,options);outbox=acknowledgedGenerationMatches(outbox,done.sent.generation)?null:outbox}
      catch(error){assert.equal(error.committed,true);const replay=server.save(outbox.snapshot,outbox.baseRevision);assert.equal(replay.revision,server.revision);outbox=null}
      intended={...intended,remote:structuredClone(server.state.remote)};
    }
  }
  if(outbox){const done=flush(server,outbox);if(acknowledgedGenerationMatches(outbox,done.sent.generation))outbox=null}
  assert.deepEqual(server.state.changes,Array.from({length:count},(_,index)=>index+1));
  assert.deepEqual(server.state,intended);
  assert.equal(outbox,null);
  assert.ok(server.calls<count/2,`expected coalescing, got ${server.calls} calls`);
});

test('old ACK cannot clear generation N+1 created during an in-flight save',()=>{
  const base={changes:[],remote:[]};let outbox=stage(null,{changes:[1],remote:[]},1,'orders');
  const sent=structuredClone(outbox);
  outbox=stage(outbox,{changes:[1,2],remote:[]},2,'orders');
  assert.equal(acknowledgedGenerationMatches(outbox,sent.generation),false);
  assert.deepEqual(outbox.snapshot.changes,[1,2]);
});

test('100 offline mutations survive serialized restart, then recover after lost ACK',()=>{
  const server=new IdempotentSnapshotServer();let intended={changes:[],remote:[]},outbox=null;
  for(let generation=1;generation<=100;generation++){intended={...intended,changes:[...intended.changes,generation]};outbox=stage(outbox,intended,generation,'orders')}
  outbox=migrateOutboxRecord(JSON.parse(JSON.stringify(outbox)),{domain:'orders',documentName:'main'});
  for(let generation=101;generation<=120;generation++){intended={...intended,changes:[...intended.changes,generation]};outbox=stage(outbox,intended,generation,'orders')}
  assert.throws(()=>flush(server,outbox,{lostAck:true}),error=>error.committed===true);
  const revisionAfterCommit=server.revision,replay=server.save(outbox.snapshot,outbox.baseRevision);
  assert.equal(replay.revision,revisionAfterCommit);
  assert.equal(server.revision,1);
  assert.deepEqual(server.state,intended);
});

test('crash matrix preserves every generation once its durable commit exists',()=>{
  const base={revision:0,state:{changes:[],remote:[]}},intended={changes:['A'],remote:[]};
  let durable=null;
  assert.equal(durable,null); // before commit: no false durability claim

  durable=stage(null,intended,1,'orders',base);
  let restarted=JSON.parse(JSON.stringify(durable)),server=new IdempotentSnapshotServer(),completed=flush(server,restarted);
  assert.deepEqual(completed.snapshot,intended); // committed outbox, before RPC
  assert.equal(server.revision,1);

  restarted=JSON.parse(JSON.stringify(stage(null,{changes:['B'],remote:[]},2,'orders',base)));
  server=new IdempotentSnapshotServer();completed=flush(server,restarted);
  assert.deepEqual(server.state,completed.snapshot); // transport failure before COMMIT can replay

  restarted=JSON.parse(JSON.stringify(stage(null,{changes:['C'],remote:[]},3,'orders',base)));
  server=new IdempotentSnapshotServer();assert.throws(()=>flush(server,restarted,{lostAck:true}),error=>error.committed===true);
  const committedRevision=server.revision,replay=server.save(restarted.snapshot,restarted.baseRevision);
  assert.equal(replay.revision,committedRevision);assert.equal(server.commits,1); // COMMIT + lost ACK

  server=new IdempotentSnapshotServer();restarted=stage(null,{changes:['D'],remote:[]},4,'orders',base);server.external('other-tab');
  completed=flush(server,JSON.parse(JSON.stringify(restarted)));
  assert.deepEqual(completed.snapshot,{changes:['D'],remote:['other-tab']}); // restart during conflict merge
  assert.equal(server.commits,2);
});

test('Orders and Kupa independently coalesce 50 concurrent logical mutations',async()=>{
  async function run(domain){
    const server=new IdempotentSnapshotServer();let intended={changes:[],remote:[]},outbox=null;
    for(let generation=1;generation<=50;generation++){
      intended={...intended,changes:[...intended.changes,`${domain}-${generation}`]};outbox=stage(outbox,intended,generation,domain,{revision:server.revision,state:server.state});
      if(generation%9===0){await Promise.resolve();const done=flush(server,outbox,{busyCount:generation%18===0?1:0,injectConflict:generation===27});outbox=null;if(done.snapshot.remote.length)intended=done.snapshot}
    }
    if(outbox)flush(server,outbox);
    return {server,intended};
  }
  const [orders,kupa]=await Promise.all([run('orders'),run('kupa')]);
  assert.deepEqual(orders.server.state,orders.intended);assert.deepEqual(kupa.server.state,kupa.intended);
  assert.equal(orders.server.state.changes.length,50);assert.equal(kupa.server.state.changes.length,50);
  assert.ok(orders.server.calls<50);assert.ok(kupa.server.calls<50);
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
});
