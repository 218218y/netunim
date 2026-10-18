import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySyncIncident,journalIncidentSample} from '../shared/sync-incident-model.js';
import {createSyncIncidentMonitor} from '../shared/sync-incident-monitor.js';
import {createSyncIncidentRegistry} from '../shared/sync-incident-registry.js';
import {createSpreadsheetSync} from '../shared/spreadsheet-sync.js';
import {createDefaultNotesSheet} from '../shared/notes-sheet-model.js';
import {syncRequestNeedsCapabilities,MIN_SYNC_CAPABILITIES} from '../shared/sync-capabilities.js';
import {createCloudAuth as ordersAuth} from '../netunim-orders/site/assets/js/cloud/auth.js';
import {createCloudAuth as kupaAuth} from '../netunim-kupa/site/assets/js/cloud/auth.js';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const uuid=n=>'33333333-3333-4333-8333-'+String(n).padStart(12,'0');
const clean=()=>({known:true,pending:false,verified:true,epoch:'E',evidence:'journal',isCurrent:()=>true});
const pending=()=>({...clean(),pending:true,verified:false});
const conflict=()=>({...pending(),blocked:true,conflict:true});
for(const app of ['orders','kupa'])test(`${app} Main observer follows journal sequence and durable ACK rather than HTTP success`,async()=>{
  let activeOwner=owner;
  const db=memoryDb(),emergency=emergencyStore(),runtime=createStorageV2Runtime({app,owner:()=>activeOwner,primary:()=>true,mode:()=> 'primary',validate:()=>{},scheduleIdle:()=>{},
    createJournal:args=>createStorageJournal({...args,db,emergency})});
  await runtime.initializeCloudHead(1,{notes:[]},{sourceOwner:owner,intent:'cloud-authoritative'});
  const before=await runtime.incidentSample();assert.equal(classifySyncIncident(before).state,'clean_verified');
  const state={notes:[{id:'N',content:'unsynchronized'}]};
  const write=runtime.persist(state,{operations:[{type:'put',collection:'notes',id:'N',mode:'insert',index:0}]});assert.equal(write.handled,true);await write.committed;
  assert.equal(before.isCurrent(),false);assert.equal((await runtime.incidentSample()).pending,true);
  const flight=await runtime.materializeFlight({operationId:uuid(99),baseRevision:1});assert.notEqual(classifySyncIncident(await runtime.incidentSample()).state,'clean_verified');
  await runtime.acknowledgeFlight(flight.operationId,2,state,{currentState:state,expectedSeq:1});
  const after=await runtime.incidentSample();assert.equal(classifySyncIncident(after).state,'clean_verified');assert.equal(after.isCurrent(),true);
  activeOwner=other;assert.equal(classifySyncIncident(await runtime.incidentSample()).state,'unknown');assert.equal(after.isCurrent(),false);
});
test('failed durability in account A cannot prevent verified recovery in account B',async()=>{
  for(const failEmergency of [true,false]){
  let activeOwner=owner;
  const source=memoryDb(),target=memoryDb();source.append=async()=>{throw new Error('quota')};
  const runtime=createStorageV2Runtime({app:'orders',owner:()=>activeOwner,primary:()=>true,mode:()=> 'primary',validate:()=>{},scheduleIdle:()=>{},
    createJournal:args=>createStorageJournal({...args,db:activeOwner===owner?source:target,emergency:emergencyStore({failWrites:activeOwner===owner&&failEmergency})})});
  await runtime.initializeCloudHead(1,{notes:[]},{sourceOwner:owner,intent:'cloud-authoritative'});
  const write=runtime.persist({notes:[{id:'N',content:'failed'}]},{operations:[{type:'put',collection:'notes',id:'N',mode:'insert',index:0}]});
  const settled=runtime.commitPromise.catch(()=>{});await assert.rejects(write.committed,/quota/);await settled;
  assert.equal(classifySyncIncident(await runtime.incidentSample()).state,failEmergency?'local_durability_error':'blocked');
  activeOwner=other;const duringHandoff=runtime.incidentSample();await runtime.initializeCloudHead(1,{notes:[]},{sourceOwner:other,intent:'cloud-authoritative'});
  assert.equal(classifySyncIncident(await duringHandoff).state,'unknown');
  const verified=await runtime.incidentSample();assert.equal(classifySyncIncident(verified).state,'clean_verified');assert.equal(verified.isCurrent(),true);
  }
});
function fixture(){
  const f={scope:{owner,epoch:1},time:0,primary:true,samples:{orders_main:clean(),shared_checks:clean()},calls:[],records:new Map(),rows:new Map(),timers:new Map(),view:null,unavailable:false};
  let count=0,timer=0;
  f.store={async update(key,change){const value=change(structuredClone(f.records.get(key)||{version:1,pendingSince:null,episodes:[]}));f.records.set(key,structuredClone(value));return structuredClone(value)}};
  f.registry={async report(value,scope){f.calls.push(['open',structuredClone(value),scope.owner]);if(f.unavailable)throw Error('offline');const row=f.rows.get(value.incident_id)||{...value,owner_id:scope.owner,resolved_at:null};f.rows.set(value.incident_id,row);return row},
    async resolve(value,scope){f.calls.push(['resolve',structuredClone(value),scope.owner]);if(f.unavailable)throw Error('offline');const row={...value,owner_id:scope.owner,resolved_at:'closed',resolution_kind:'clean_verified'};f.rows.set(value.incident_id,row);return row},
    async list(scope){if(f.unavailable)throw Error('offline');return [...f.rows.values()].filter(row=>row.owner_id===scope.owner&&row.resolved_at===null)},
    async review(row){row.resolved_at='reviewed';row.resolution_kind='operator_reviewed_unverified';Object.assign(f.rows.get(row.incident_id),row)}};
  f.create=()=>createSyncIncidentMonitor({site:'orders',clientId:'client',accountScope:()=>f.scope,primary:()=>f.primary,
    domains:Object.keys(f.samples).map(domain=>({domain,read:async()=>f.samples[domain]})),store:f.store,registry:f.registry,
    now:()=>f.time,random:()=>0.5,id:()=>uuid(++count),publish:view=>{f.view=view},
    timers:{setTimeout(fn){f.timers.set(++timer,fn);return timer},clearTimeout(id){f.timers.delete(id)}}});
  f.monitor=f.create();f.record=domain=>f.records.get(owner+':orders:'+domain);return f;
}
test('classification requires durable ACK proof; readiness and read errors stay unknown',()=>{
  assert.equal(classifySyncIncident(null).state,'unknown');
  assert.equal(classifySyncIncident({known:true}).state,'unknown');
  assert.equal(classifySyncIncident({known:false,hasLocalWork:true}).state,'unknown');
  const sample=journalIncidentSample({seq:3,base:{epoch:'E',ackSeq:2,revision:1},pending:true,flight:null,control:null});
  assert.equal(classifySyncIncident(sample,{pendingSince:0,now:89_999}).state,'pending_grace');
  assert.equal(classifySyncIncident(sample,{pendingSince:0,now:90_000}).state,'stalled');
  assert.equal(classifySyncIncident(journalIncidentSample({seq:3,base:{epoch:'E',ackSeq:3,revision:1},control:null})).state,'clean_verified');
  for(const cloud of [{seq:3,base:{epoch:'E',ackSeq:4}},{seq:3},{seq:3,base:{epoch:'E',ackSeq:3},flight:{}},{seq:3,base:{epoch:'E',ackSeq:3},control:{retry:{}}}])assert.notEqual(classifySyncIncident(journalIncidentSample(cloud)).state,'clean_verified');
  assert.equal(classifySyncIncident({...pending(),failures:2}).state,'stalled');
  assert.equal(classifySyncIncident({...clean(),durabilityError:true}).state,'local_durability_error');
  assert.equal(classifySyncIncident(conflict()).reason,'conflict');
});
test('fast ordinary save and idle/offline computer do not create incidents',async()=>{
  const f=fixture();f.samples.orders_main=pending();await f.monitor.start();f.time=1000;f.samples.orders_main=clean();await f.monitor.tick();f.time=30*86400_000;await f.monitor.tick();assert.deepEqual(f.calls,[]);
});
test('grace and incident identity survive reload; unchanged reports are coalesced',async()=>{
  const f=fixture();f.samples.orders_main=pending();await f.monitor.start();f.monitor.stop();f.time=90_000;f.monitor=f.create();await f.monitor.start();assert.equal(f.calls.length,1);const first=f.calls[0][1].incident_id;
  f.time+=86400_000;await f.monitor.tick();assert.equal(f.calls.length,1);assert.equal(f.view.incidents[0].incident_id,first);
});
test('a checks incident is independent of a clean main ACK',async()=>{
  const f=fixture();f.samples.shared_checks=conflict();await f.monitor.start();assert.equal(f.calls[0][1].domain,'shared_checks');f.time+=5000;await f.monitor.tick();assert.equal(f.calls.length,1);assert.equal(f.view.incidents.length,1);
});
test('conflict reports immediately; local durability risk has its own evidence',async()=>{
  const f=fixture();f.samples.orders_main=conflict();f.samples.shared_checks={...pending(),durabilityError:true,evidence:'durability'};await f.monitor.start();assert.equal(f.calls.length,2);assert.equal(f.calls[1][1].reason_code,'local_durability_error');
});
test('lost OPEN reply followed by recovery sends RESOLVE for the SAME incident',async()=>{
  const f=fixture();f.samples.orders_main=conflict();f.unavailable=true;await f.monitor.start();const opened=f.calls[0][1];f.unavailable=false;f.samples.orders_main=clean();f.time=1;await f.monitor.tick();assert.equal(f.calls[1][0],'resolve');assert.equal(f.calls[1][1].incident_id,opened.incident_id);assert.equal(f.calls[1][1].report_version,2);
});
test('unknown, other epoch and edits after observation cannot close an incident',async()=>{
  for(const sample of [{known:false},{...clean(),epoch:'new-E'},{...clean(),isCurrent:()=>false}]){
    const f=fixture();f.samples.orders_main=conflict();await f.monitor.start();f.samples.orders_main=sample;await f.monitor.tick();assert.equal(f.calls.length,1);
  }
});
test('a new mutation during resolution recheck retains the unresolved intent',async()=>{
  const f=fixture();f.samples.orders_main=conflict();await f.monitor.start();let reads=0;
  f.samples.orders_main={...clean(),get verified(){return ++reads===1}};await f.monitor.tick();assert.equal(f.calls.length,1);
});
test('new failure after verified recovery has a fresh incident id',async()=>{
  const f=fixture();f.samples.orders_main=conflict();await f.monitor.start();f.samples.orders_main=clean();await f.monitor.tick();f.samples.orders_main=conflict();await f.monitor.tick();assert.notEqual(f.calls[0][1].incident_id,f.calls[2][1].incident_id);
});
test('manual review is unverified, and returning failed installation opens a new episode',async()=>{
  const f=fixture();f.samples.orders_main=conflict();await f.monitor.start();const first=f.view.incidents[0];await f.monitor.review(first);assert.equal(first.resolution_kind,'operator_reviewed_unverified');await f.monitor.tick();assert.equal(f.calls.length,2);assert.notEqual(f.calls[0][1].incident_id,f.calls[1][1].incident_id);
});
test('failed reads have a third state and preserve last known warnings',async()=>{
  const f=fixture();f.samples.orders_main=conflict();await f.monitor.start();f.unavailable=true;await f.monitor.wake();assert.equal(f.view.status,'unavailable');assert.equal(f.view.incidents.length,1);
});
test('retry delay is bounded, no duplicate timer or tight RPC loop',async()=>{
  const f=fixture();f.unavailable=true;f.samples.orders_main=conflict();await f.monitor.start();for(let i=0;i<10;i++)await f.monitor.tick();assert.equal(f.calls.length,1);assert.equal(f.timers.size,1);f.time=5000;await f.monitor.tick();assert.equal(f.calls.length,2);f.monitor.stop();assert.equal(f.timers.size,0);
});
test('secondary tabs read but never report; replacement primary reuses persisted episode',async()=>{
  const f=fixture();f.primary=false;f.samples.orders_main=conflict();await f.monitor.start();assert.equal(f.calls.length,0);f.primary=true;await f.monitor.tick();assert.equal(f.calls.length,1);f.monitor.stop();f.monitor=f.create();await f.monitor.start();assert.equal(f.calls.length,1);
});
test('account change clears old warnings immediately and never resolves the previous account',async()=>{
  const f=fixture();f.samples.orders_main=conflict();await f.monitor.start();f.scope={owner:other,epoch:2};f.samples.orders_main=clean();await f.monitor.accountChanged();assert.equal(f.view.incidents.length,0);assert.equal(f.calls.length,1);assert.equal(f.record('orders_main').episodes.length,1);
});
test('late network reply cannot commit into a replacement account or primary tab',async()=>{
  for(const change of [f=>{f.scope={owner:other,epoch:2}},f=>{f.primary=false}]){
    const f=fixture();let release;f.registry.report=async()=>{await new Promise(resolve=>{release=resolve});return {resolved_at:null}};f.samples.orders_main=conflict();const task=f.monitor.start();while(!release)await Promise.resolve();change(f);release();await task;assert.equal(f.record('orders_main').episodes[0].sentVersion,0);
  }
});
test('monitor storage failure is isolated from domain writers and is visible',async()=>{
  const f=fixture();let writes=0;f.store.update=async()=>{throw Error('quota')};await f.monitor.start();writes++;assert.equal(writes,1);assert.equal(f.view.localError,true);
});
function serverRow(){return {owner_id:owner,incident_id:uuid(1),client_instance_id:'client',device_label:'Office',site:'orders',domain:'orders_main',scope_epoch:'E',severity:'warning',reason_code:'stalled',evidence_kind:'journal',has_pending:true,last_error_code:'',report_version:1,first_reported_at:'2026-10-18T10:00:00Z',last_reported_at:'2026-10-18T10:00:00Z',resolved_at:null,resolution_kind:null}}
test('registry rejects mixed accounts, malformed receipts and stale login bodies',async()=>{
  let scope={owner,epoch:1},row=serverRow(),hold=false;
  const registry=createSyncIncidentRegistry({accountScope:()=>scope,request:async()=>({ok:true,json:async()=>{if(hold)scope={owner,epoch:3};return row}})});
  assert.equal((await registry.report(row,scope)).incident_id,row.incident_id);
  row={...serverRow(),owner_id:other};await assert.rejects(registry.report(serverRow(),scope),/response_invalid/);
  row={...serverRow(),incident_id:uuid(2)};await assert.rejects(registry.report(serverRow(),scope),/receipt_mismatch/);
  row=serverRow();hold=true;await assert.rejects(registry.report(row,scope),/account_changed/);
});
test('resolution proof is checked again by the authenticated scheduler before transport',async()=>{
  let verified=true,release,entered,writes=0;
  const entry=new Promise(resolve=>{entered=resolve}),hold=new Promise(resolve=>{release=resolve});
  const scope={owner,epoch:1},registry=createSyncIncidentRegistry({accountScope:()=>scope,request:async(_path,options)=>{
    entered();await hold;options.assertRequestScope();writes++;return new Response(JSON.stringify({...serverRow(),resolved_at:'2026-10-18T12:00:00Z',resolution_kind:'clean_verified'}));
  }});
  const task=registry.resolve(serverRow(),scope,()=>verified);await entry;verified=false;release();await assert.rejects(task,/observation_changed/);assert.equal(writes,0);
});
test('only exact monitoring RPC names bypass business capability handshake',()=>{
  for(const name of ['report','resolve','list_active','mark']){
    const rpc={report:'report_sync_incident_v1',resolve:'resolve_sync_incident_v1',list_active:'list_active_sync_incidents_v1',mark:'mark_sync_incident_reviewed_v1'}[name];
    assert.equal(syncRequestNeedsCapabilities('/rest/v1/rpc/'+rpc,'POST'),false);assert.equal(syncRequestNeedsCapabilities('/rest/v1/rpc/'+rpc+'_other','POST'),true);
  }
  assert.equal(syncRequestNeedsCapabilities('/rest/v1/rpc/save_kupa_document_v6','POST'),true);assert.equal(MIN_SYNC_CAPABILITIES.storageWriterProtocol,2);
});
test('closed sheet discovers durable draft/flight/conflict and fails unknown on unreadable emergency',async()=>{
  const book=createDefaultNotesSheet();let saved={record:{base:book,working:book,revision:1,flight:null,conflict:null},drafts:[]},broken=false;
  const sync=createSpreadsheetSync({domain:'orders',account:()=>owner,enabled:()=>true,store:{load:async()=>structuredClone(saved),inspectEmergency:()=>{if(broken)throw Error('corrupt');return []}}});
  assert.equal(classifySyncIncident(await sync.incidentSample()).state,'clean_verified');
  saved.drafts=[{}];assert.equal((await sync.incidentSample()).pending,true);saved.drafts=[];
  saved.record.flight={};assert.equal((await sync.incidentSample()).pending,true);saved.record.conflict={};assert.equal(classifySyncIncident(await sync.incidentSample()).state,'blocked');
  broken=true;assert.equal(classifySyncIncident(await sync.incidentSample()).state,'unknown');
});
for(const app of ['orders','kupa'])test(`${app} monitoring HTTP/transport errors never trip business writes or require capabilities`,async t=>{
  const oldStorage=globalThis.localStorage,oldFetch=globalThis.fetch;t.after(()=>{globalThis.localStorage=oldStorage;globalThis.fetch=oldFetch});
  const credentials={user:{id:owner},access_token:'fixture',expires_at:9999999999};globalThis.localStorage={getItem:()=>JSON.stringify(credentials)};
  const api=app==='orders'?ordersAuth({}):kupaAuth({session:{supaSession:credentials}}),request=app==='orders'?api.supaFetch:api.supaRest;
  let mode='http',writes=0;
  globalThis.fetch=async url=>{
    if(url.endsWith('/report_sync_incident_v1')){if(mode==='network')throw new TypeError('Failed to fetch');return new Response('{}',{status:503})}
    if(url.endsWith('/get_netunim_sync_capabilities'))return new Response(JSON.stringify(MIN_SYNC_CAPABILITIES));
    writes++;return new Response('{}');
  };
  assert.equal((await request('/rest/v1/rpc/report_sync_incident_v1',{method:'POST',body:'{}',networkRetry:false})).status,503);
  mode='network';await assert.rejects(request('/rest/v1/rpc/report_sync_incident_v1',{method:'POST',body:'{}',networkRetry:false}));
  assert.equal((await request('/rest/v1/rpc/save_kupa_document_v6',{method:'POST',body:'{}'})).status,200);assert.equal(writes,1);
});
