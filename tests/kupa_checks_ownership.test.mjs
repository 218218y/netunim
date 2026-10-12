import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
import {createChecksPersistence} from '../netunim-kupa/site/assets/js/sync/checks-persistence.js';
import {createSharedChecksMerge} from '../netunim-kupa/site/assets/js/sync/checks-merge.js';

const noop=()=>{};
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function fixture(){
  const held=gate(),events=[],checksSession={sharedChecksGeneration:0},model={state:{checks:[]}};
  const cloud={base:{state:{checks:[],bankEvents:[]},revision:1,owner:'A',epoch:'E',ackSeq:0},seq:0,pending:false};
  const api=createSyncChecks({checksSession,model,session:{backendReady:true,connectionMode:'supabase'},tab:{primaryTab:true},
    loadSession:()=>({user:{id:'A'}}),isOnline:()=>true,
    sharedChecksV2:{requested:true,primaryReady:true,hasLocalWork:false,sync:()=>held.promise,cloudState:async()=>cloud},
    toast:noop,render:()=>events.push('render'),setSaveStatus:()=>events.push('save'),setCloudHeaderStatus:()=>events.push('cloud'),refreshCloudHeaderTimestamp:noop});
  return {api,held,events,checksSession};
}

test('Kupa Checks flights stay private while a cloud pull is held',async()=>{
  const f=fixture(),pull=f.api.syncSharedChecksFromCloud();await tick();
  try{
    assert.equal(Object.hasOwn(f.checksSession,'sharedChecksPullPromise'),false);
    assert.equal(Object.hasOwn(f.checksSession,'sharedChecksSavePromise'),false);
    assert.equal(f.api.runtime.isPending(),true);
  }finally{f.held.resolve(true);await pull}
});

test('Kupa Checks disposal drains a held pull and fences its late status publication',async()=>{
  const f=fixture(),pull=f.api.syncSharedChecksFromCloud();await tick();
  try{
    assert.equal(f.api.runtime.dispose(),true);assert.equal(f.api.runtime.dispose(),false);
    let drained=false;const drain=f.api.runtime.drain().then(()=>{drained=true});await tick();
    assert.equal(drained,false);const before=f.events.length;
    f.held.resolve(true);assert.equal(await pull,false);await drain;
    assert.equal(f.events.length,before);assert.equal(f.api.runtime.isPending(),false);
    assert.equal(await f.api.saveSharedChecksToCloud(),false);
  }finally{f.held.resolve(true);await pull}
});

test('a reserved Checks save cannot start after disposal while waiting behind a pull',async()=>{
  const f=fixture(),pull=f.api.syncSharedChecksFromCloud();await tick();
  const save=f.api.saveSharedChecksToCloud();f.api.runtime.dispose();f.held.resolve(true);
  assert.deepEqual(await Promise.all([pull,save]),[false,false]);await f.api.runtime.drain();
  assert.equal(f.api.runtime.isPending(),false);
});

function persistenceFixture(){
  let next=0;const jobs=new Map(),commits=[],sent=[],backups=[];
  const timers={setTimeout(run,delay){const id=++next;jobs.set(id,{run,delay});return id},clearTimeout:id=>jobs.delete(id)};
  const session={backendReady:true,connectionMode:'supabase'},checksSession={},model={state:{checks:[{id:'C'}]}};
  const api=createChecksPersistence({session,checksSession,model,files:{backupsDirHandle:{}},tab:{primaryTab:true},timers,
    sharedChecksV2:{requested:true,cloudReady:true,persist(operations,options){const held=gate();commits.push({held,operations,options});return {emergencyDurable:false,committed:held.promise}}},
    checksStatus:{save:noop,cloud:noop},loadSession:()=>({user:{id:'A'}}),normalizeState:x=>x,
    backupSnapshotToComputer:async()=>{backups.push('backup')},saveSharedChecksToCloud:async message=>{sent.push(message)}});
  function fire(delay){for(const [id,job] of [...jobs])if(job.delay===delay){jobs.delete(id);job.run()}}
  return {api,commits,jobs,session,checksSession,sent,backups,fire};
}

test('Checks follow-ups wait for durability and coalesce only the unsent cloud wakeup',async()=>{
  const f=persistenceFixture();
  const first=f.api.saveChecksState('first',{operations:[{type:'put',id:'C'}]});
  const second=f.api.saveChecksState('second',{deletedIds:['D'],mutationType:'delete',operations:[{type:'delete',id:'D'}]});
  assert.equal(f.jobs.size,1);assert.equal([...f.jobs.values()][0].delay,220);
  f.fire(220);await tick();assert.deepEqual(f.sent,[]);
  f.commits[0].held.resolve();await first;f.commits[1].held.resolve();await second;await tick();
  assert.deepEqual(f.sent,['second']);assert.deepEqual(f.commits[1].options.deleteIds,['D']);
  f.fire(0);await f.api.runtime.drain();assert.deepEqual(f.backups,['backup']);
  assert.equal(f.session.localUndurableGenerations.size,0);assert.equal(f.api.runtime.isPending(),false);
  assert.equal(Object.hasOwn(f.checksSession,'sharedChecksSaveTimer'),false);
});

for(const close of ['cancelPending','dispose'])test(`${close} fences future receipt follow-ups without cancelling an accepted append`,async()=>{
  const f=persistenceFixture(),saving=f.api.saveChecksState('held',{operations:[{type:'put',id:'C'}]});
  f.api.runtime[close]();let settled=false;
  const drain=f.api.runtime.drain().then(()=>{settled=true});await tick();assert.equal(settled,false);
  f.commits[0].held.resolve();assert.equal(await saving,true);await drain;
  assert.equal(f.jobs.size,0);assert.deepEqual(f.sent,[]);assert.deepEqual(f.backups,[]);
  assert.equal(f.session.localUndurableGenerations.size,0);
  if(close==='dispose')assert.equal(await f.api.saveChecksState('closed'),false);
});

test('Checks drain waits for a started backup after cancellation',async()=>{
  const held=gate(),entered=gate(),f=persistenceFixture();
  // Exercise the actual owner with a backup port that remains inside I/O.
  const api=createChecksPersistence({session:{},checksSession:{},model:{state:{}},tab:{primaryTab:true},files:{backupsDirHandle:{}},
    timers:{setTimeout(run){f.jobs.set(1,{run,delay:0});return 1},clearTimeout:id=>f.jobs.delete(id)},
    sharedChecksV2:{requested:true,persist:()=>({emergencyDurable:true,committed:Promise.resolve()})},checksStatus:{save:noop,cloud:noop},
    normalizeState:x=>x,backupSnapshotToComputer:async()=>{entered.resolve();await held.promise}});
  await api.saveChecksState();f.fire(0);await entered.promise;api.runtime.cancelPending();
  let drained=false;const drain=api.runtime.drain().then(()=>{drained=true});await tick();assert.equal(drained,false);
  held.resolve();await drain;assert.equal(api.runtime.isPending(),false);
});

test('Checks drain also waits for an append accepted during a started backup',async()=>{
  const receipt=gate(),entered=gate(),resume=gate(),jobs=new Map();let writes=0;
  const api=createChecksPersistence({session:{},checksSession:{},model:{state:{}},tab:{primaryTab:true},files:{backupsDirHandle:{}},
    timers:{setTimeout(run){jobs.set(1,run);return 1},clearTimeout:id=>jobs.delete(id)},
    sharedChecksV2:{requested:true,persist:()=>({emergencyDurable:false,committed:++writes===1?Promise.resolve():receipt.promise})},
    checksStatus:{save:noop,cloud:noop},normalizeState:x=>x,
    backupSnapshotToComputer:async()=>{entered.resolve();await resume.promise;void api.saveChecksState('edit during backup')}});
  await api.saveChecksState('first');const run=jobs.get(1);jobs.delete(1);run();await entered.promise;
  api.runtime.cancelPending();let drained=false;const drain=api.runtime.drain().then(()=>{drained=true});
  try{
    resume.resolve();await tick();assert.equal(writes,2);assert.equal(drained,false);
  }finally{receipt.resolve();await drain;api.runtime.cancelPending();await api.runtime.drain()}
});

test('Kupa one-shot bootstrap policy survives extraction and explicit deletions remain required',()=>{
  const checksSession={sharedChecksBootstrapActive:true},merge=createSharedChecksMerge({checksSession});
  const base=[{id:'C',amount:10,status:'בקופה'}];
  assert.equal(merge(base,[],base).repairedEmptyBootstrap,true);assert.equal(checksSession.sharedChecksBootstrapActive,false);
  assert.equal(merge(base,[],base).repairedEmptyBootstrap,false);assert.equal(merge(base,[],base).checks.length,1);
  assert.equal(merge(base,[],base,{deleteIds:['C']}).checks.length,0);
  const remote=[{...base[0],amount:20}];assert.equal(merge(base,[],remote).checks[0].amount,20);
  assert.ok(merge(base,[],remote,{deleteIds:['C']}).conflicts.length>0);
});
