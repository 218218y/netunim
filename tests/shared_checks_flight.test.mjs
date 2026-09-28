import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedChecksFlight} from '../shared/shared-checks-flight.js';
import {createSyncChecks as ordersChecks} from '../netunim-orders/site/assets/js/sync/checks.js';
import {createSyncChecks as kupaChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
import {createDomainsBankController} from '../netunim-kupa/site/assets/js/domains/bank/controller.js';

const noop=()=>{};
function gate(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});

test('shared-check flight serializes pull and save and releases its busy slot',async()=>{
  const state={},flight=createSharedChecksFlight({state,pullKey:'pull',saveKey:'save',busyKey:'busy'}),wait=gate(),started=gate(),order=[];
  const pull=flight.pull(async()=>{order.push('pull');started.resolve();await wait.promise;return true});
  assert.equal(flight.pull(()=>assert.fail('duplicate pull')),pull);await started.promise;
  const save=flight.save(async()=>{order.push('save');return true});
  assert.equal(flight.save(()=>assert.fail('duplicate save')),save);
  assert.equal(flight.status(),'pulling');wait.resolve();
  assert.deepEqual(await Promise.all([pull,save]),[true,true]);
  assert.deepEqual(order,['pull','save']);assert.equal(state.busy,false);
});

for(const app of ['orders','kupa'])test(`${app}: Shared Checks V2 joins concurrent pull and verifies the same cloud head`,async()=>{
  const model={state:{checks:[]}},checksSession={},wait=gate(),started=gate(),calls=[];
  const sharedChecksV2={requested:true,primaryReady:true,lastRemoteUpdatedAt:'2026-09-27T10:00:00Z',
    async sync(){calls.push('sync');started.resolve();await wait.promise;model.state.checks=[{id:'C',amount:25}];return true},
    async cloudState(){return {base:{revision:8,state:{checks:[{id:'C',amount:25}],bankEvents:[{seq:1,checkId:'C'}]}},pending:false,control:null}}};
  const common={sharedChecksV2,model,checksSession,tab:{primaryTab:true},files:{},toast:noop};
  const api=app==='orders'?ordersChecks({...common,loadSession:()=>true,recomputeKupaNetFromCache:noop,refreshCloudTimestamp:noop,renderKupaDependentView:noop})
    :kupaChecks({...common,session:{backendReady:true,connectionMode:'supabase'},setSaveStatus:noop,setCloudHeaderStatus:noop,refreshCloudHeaderTimestamp:noop,render:noop});
  const first=api.syncSharedChecksFromCloud({quiet:true});await started.promise;
  const joined=api.syncSharedChecksFromCloud({required:true,quiet:true});assert.equal(calls.length,1);
  wait.resolve();assert.deepEqual(await Promise.all([first,joined]),[true,true]);
  assert.equal(checksSession[app==='orders'?'checksCloudRevision':'sharedChecksRevision'],8);
  assert.equal(checksSession[app==='orders'?'checksBankEvents':'sharedChecksBankEvents'][0].seq,1);
  assert.equal(await api.saveSharedChecksToCloud(),true);assert.equal(calls.length,2);
});

for(const app of ['orders','kupa'])test(`${app}: no Shared V2 runtime cannot fall back to a legacy checks writer`,async()=>{
  const api=(app==='orders'?ordersChecks:kupaChecks)({tab:{primaryTab:true},checksSession:{}});
  assert.equal(await api.syncSharedChecksFromCloud(),false);
  await assert.rejects(api.syncSharedChecksFromCloud({required:true}),/shared_checks_v2_required/);
  assert.equal(await api.saveSharedChecksToCloud(),false);
});

for(const app of ['orders','kupa'])test(`${app}: V2 poll renders a changed check once`,async()=>{
  const model={state:{checks:[{id:'C',amount:10}]}},checksSession={},session={backendReady:true,connectionMode:'supabase'};
  let renders=0,amount=25;
  const sharedChecksV2={requested:true,primaryReady:true,
    async sync(){model.state.checks=[{id:'C',amount}];return true},
    async cloudState(){return {base:{revision:8,state:{checks:model.state.checks,bankEvents:[]}},pending:false,control:null}}};
  const common={sharedChecksV2,model,checksSession,session,tab:{primaryTab:true},files:{},toast:noop};
  const api=app==='orders'?ordersChecks({...common,loadSession:()=>true,recomputeKupaNetFromCache:noop,refreshCloudTimestamp:noop,renderKupaDependentView:()=>{renders++}})
    :kupaChecks({...common,setSaveStatus:noop,setCloudHeaderStatus:noop,refreshCloudHeaderTimestamp:noop,render:()=>{renders++}});
  await api.pollSharedChecks();assert.equal(renders,1);
  await api.pollSharedChecks();assert.equal(renders,1);
  amount=30;await api.pollSharedChecks();assert.equal(renders,2);
});

test('bank snapshot refuses a check mutation in its final guard continuation',async()=>{
  let local=false,observations=0,writes=0;
  const bank=createDomainsBankController({model:{state:{bank:{}}},session:{connectionMode:'supabase'},checksSession:{},
    sharedChecksHaveLocalWork:()=>{observations++;if(observations===2)queueMicrotask(()=>{local=true});return local},
    syncSharedChecksFromCloud:async()=>true,saveSharedChecksToCloud:async()=>assert.fail('mutation arrived after the drain check'),
    sharedChecksObservedSequence:()=>0,saveState:async()=>{writes++;return true},toast:noop,render:noop,bridge:{}});
  await assert.rejects(bank.commitBankSnapshot(1000));assert.equal(writes,0);
});
