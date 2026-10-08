import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdersCloudStartup} from '../netunim-orders/site/assets/js/startup/cloud-hydration.js';
import {createOrdersLocalServices} from '../netunim-orders/site/assets/js/startup/local-services.js';
import {createOrdersBackgroundStartup} from '../netunim-orders/site/assets/js/startup/background.js';
import {createStorageBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';

const noop=()=>{};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function cloud(overrides={}){
  const calls=[],outcomes=[],state={allowed:true,online:true,authenticated:true,enabled:true,conflict:false,pending:false,checksPending:false,error:''};
  const ports={
    main:{recoverCursor:async()=>calls.push('cursor'),open:async options=>{calls.push('main');assert.deepEqual(options,{renderAfter:true,quiet:true,hydrateSecondary:false,manageStatus:false,startPoll:false});return true},
      cloudState:async()=>({pending:state.pending}),hasLocalWork:()=>false,conflictBlocked:()=>state.conflict},
    checks:{sync:async options=>{calls.push('checks');assert.deepEqual(options,{quiet:true,required:false});return true},pending:()=>state.checksPending,
      lastError:()=>state.error,recordError:error=>{state.error=error.message}},
    finance:{hydrate:async options=>{calls.push('finance');assert.deepEqual(options,{force:true,renderIfChanged:true});return true}},
    status:{beginStartupSync:required=>calls.push({required}),setStartupDomain:(...args)=>outcomes.push(args),setCloud:noop},
    access:{authenticated:()=>state.authenticated,online:()=>state.online,cloudEnabled:()=>state.enabled,canHydrate:()=>state.allowed&&state.online&&state.authenticated},mark:noop,
    ...overrides,
  };
  return {runtime:createOrdersCloudStartup(ports),calls,outcomes,state,ports};
}

test('cloud startup installs a frozen plan and runs Main, Checks and Finance only once in order',async()=>{
  const f=cloud();const preparation=f.runtime.prepare({localEngineActive:false});
  assert.equal(f.runtime.prepare({localEngineActive:false}),preparation);
  const plan=await preparation;assert.ok(Object.isFrozen(plan));
  assert.deepEqual(plan,{ordersOnline:true,sharedOnline:true,cloudEnabled:true,online:true});
  assert.deepEqual(f.calls,['cursor',{required:{orders:true,checks:true,finance:true}}]);
  const main=f.runtime.hydrateMain();assert.equal(f.runtime.hydrateMain(),main);await main;
  const secondary=f.runtime.hydrateSecondary();assert.equal(f.runtime.hydrateSecondary(),secondary);await secondary;
  await f.runtime.hydrateMain();await f.runtime.hydrateSecondary();
  assert.deepEqual(f.calls.slice(2),['main','checks','finance']);
  assert.deepEqual(f.outcomes.map(([domain,state])=>[domain,state]),[['orders','loading'],['orders','ready'],['checks','loading'],['checks','ready'],['finance','loading'],['finance','ready']]);
});

test('secondary hydration cannot bypass an unfinished Main phase',async()=>{
  const entered=deferred(),gate=deferred(),f=cloud();
  f.ports.main.open=async()=>{entered.resolve();await gate.promise;return true};
  await f.runtime.prepare({localEngineActive:false});const main=f.runtime.hydrateMain();await entered.promise;
  await assert.rejects(f.runtime.hydrateSecondary(),/main_hydration_required/);
  assert.equal(f.calls.includes('checks'),false);gate.resolve();await main;
});

for(const mode of ['local','offline','signed-out'])test(`${mode} startup skips remote reads without discarding local readiness`,async()=>{
  const f=cloud();if(mode==='offline')f.state.online=false;if(mode==='signed-out')f.state.authenticated=false;
  const plan=await f.runtime.prepare({localEngineActive:mode==='local'});
  assert.equal(plan.ordersOnline,false);assert.equal(plan.sharedOnline,false);
  await f.runtime.hydrateMain();await f.runtime.hydrateSecondary();
  assert.equal(f.calls.some(call=>['main','checks','finance'].includes(call)),false);
  assert.equal(f.calls.includes('cursor'),mode!=='local');
});

for(const boundary of ['main','checks'])test(`live access is rechecked after ${boundary} before dependent remote reads`,async()=>{
  const f=cloud();
  if(boundary==='main')f.ports.main.open=async()=>{f.state.allowed=false;return true};
  else f.ports.checks.sync=async()=>{f.calls.push('checks');f.state.authenticated=false;return true};
  await f.runtime.prepare({localEngineActive:false});await f.runtime.hydrateMain();await f.runtime.hydrateSecondary();
  assert.equal(f.calls.includes('checks'),boundary==='checks');assert.equal(f.calls.includes('finance'),false);
  assert.equal(f.outcomes.findLast(([domain])=>domain==='finance')[1],'error');
});

test('partial cloud failure preserves pending Shared status and still attempts independent Finance hydration',async t=>{
  t.mock.method(console,'error',noop);const f=cloud(),failure=new Error('shared_rpc_unavailable');
  f.state.checksPending=true;f.ports.checks.sync=async()=>{throw failure};
  await f.runtime.prepare({localEngineActive:false});await f.runtime.hydrateMain();await f.runtime.hydrateSecondary();
  assert.deepEqual(f.outcomes.findLast(([domain])=>domain==='checks'),['checks','deferred',failure.message]);
  assert.equal(f.calls.includes('finance'),true);assert.equal(f.outcomes.at(-1)[1],'ready');
});

for(const outcome of ['pending','conflict','unavailable'])test(`Main ${outcome} retains the correct domain outcome without retry`,async t=>{
  t.mock.method(console,'error',noop);const f=cloud();let opens=0;
  f.state.pending=outcome==='pending';f.state.conflict=outcome==='conflict';
  f.ports.main.open=async()=>{opens++;if(outcome==='unavailable')throw new Error('offline');return true};
  await f.runtime.prepare({localEngineActive:false});await f.runtime.hydrateMain();await f.runtime.hydrateMain();
  assert.equal(opens,1);assert.equal(f.outcomes.at(-1)[1],outcome==='pending'?'deferred':'error');
});

for(const phase of ['cursor','post-hydration-head'])test(`a fatal ${phase} error retains its cause and cannot start dependent hydration`,async()=>{
  const f=cloud(),error=new Error('journal_head_corrupt');
  if(phase==='cursor')f.ports.main.recoverCursor=async()=>{throw error};
  else f.ports.main.cloudState=async()=>{throw error};
  const prepared=f.runtime.prepare({localEngineActive:false});
  if(phase==='cursor')await assert.rejects(prepared,candidate=>candidate===error);
  else{await prepared;const main=f.runtime.hydrateMain();await assert.rejects(main,candidate=>candidate===error);assert.equal(f.runtime.hydrateMain(),main)}
  await assert.rejects(f.runtime.hydrateSecondary());assert.equal(f.calls.includes('checks'),false);
});

test('a failed UI guard installation cannot publish a cloud plan',async()=>{
  const f=cloud();f.ports.status.beginStartupSync=()=>{throw new Error('status_failed')};
  await assert.rejects(f.runtime.prepare({localEngineActive:false}),/status_failed/);
  await assert.rejects(f.runtime.hydrateMain(),/plan_required/);assert.equal(f.calls.includes('main'),false);
});

function local(overrides={}){
  const files={},calls=[],errors=[],snapshot={value:'local'};
  const ports={files,storage:{requestPersistentBrowserStorage:async()=>calls.push('persist'),loadDirHandle:async()=>{calls.push('folder');return {id:'folder'}}},
    folder:{refreshPermission:async interactive=>{assert.equal(interactive,false);calls.push('permission')},syncStatus:()=>calls.push('status'),backupAvailable:()=>true},
    backup:{capture:()=>{calls.push('capture');return structuredClone(snapshot)},save:async value=>calls.push(['backup',value])},
    onError:(error,phase)=>errors.push({error,phase}),...overrides};
  return {runtime:createOrdersLocalServices(ports),ports,files,calls,errors,snapshot};
}

test('local services initialize once and capture backup only after folder readiness and hydration',async()=>{
  const f=local(),gate=deferred();f.ports.storage.loadDirHandle=async()=>{await gate.promise;return {id:'folder'}};
  const ready=f.runtime.start();assert.equal(f.runtime.start(),ready);
  const backup=f.runtime.backupAfterHydration();assert.equal(f.runtime.backupAfterHydration(),backup);
  await Promise.resolve();assert.equal(f.calls.includes('capture'),false);
  f.snapshot.value='hydrated';gate.resolve();await backup;
  assert.deepEqual(f.calls,['persist','permission','capture',['backup',{value:'hydrated'}]]);
  assert.equal(f.files.dirHandle.id,'folder');await f.runtime.start();assert.equal(f.calls.filter(call=>call==='persist').length,1);
});

test('optional persistence, folder and backup failures have separate reported boundaries',async()=>{
  const f=local(),storageError=new Error('storage_refused'),folderError=new Error('folder_missing'),backupError=new Error('quota');
  f.ports.storage.requestPersistentBrowserStorage=async()=>{throw storageError};f.ports.storage.loadDirHandle=async()=>{throw folderError};
  f.ports.backup.save=async()=>{throw backupError};
  await f.runtime.start();await f.runtime.backupAfterHydration();
  assert.deepEqual(f.errors,[{error:storageError,phase:'persistent browser storage'},{error:folderError,phase:'folder startup'},{error:backupError,phase:'automatic folder backup'}]);
  assert.ok(f.calls.includes('status'));assert.ok(f.calls.includes('capture'));
});

test('backup cannot start before local services, and missing folder never captures a snapshot',async()=>{
  const cold=local();await assert.rejects(cold.runtime.backupAfterHydration(),/not_started/);
  const f=local();f.ports.storage.loadDirHandle=async()=>null;f.ports.folder.backupAvailable=()=>false;
  await f.runtime.start();await f.runtime.backupAfterHydration();assert.deepEqual(f.calls,['persist','status']);
});

function background(overrides={}){
  const calls=[],state={allowed:true},ports={polling:{start:()=>calls.push('poll')},finance:{start:()=>calls.push('finance')},
    alerts:{prepare:async()=>calls.push('prepare-alerts'),show:()=>calls.push('alerts')},
    localServices:{backupAfterHydration:async()=>calls.push('backup')},access:{allowed:()=>state.allowed},mark:noop,...overrides};
  return {runtime:createOrdersBackgroundStartup(ports),ports,calls,state};
}

test('background phases join callers and start each owner once in the required order',async()=>{
  const f=background(),task=f.runtime.start({ordersOnline:true});assert.equal(f.runtime.start({ordersOnline:true}),task);
  assert.equal(await task,true);await f.runtime.start({ordersOnline:true});
  assert.deepEqual(f.calls,['poll','backup','prepare-alerts','alerts','finance']);
});

for(const phase of ['backup','prepare','show'])test(`optional ${phase} failure cannot replay effects or suppress Finance startup`,async t=>{
  t.mock.method(console,'error',noop);const f=background();let calls=0;
  const fail=()=>{calls++;throw new Error('optional_failed')};
  if(phase==='backup')f.ports.localServices.backupAfterHydration=fail;else f.ports.alerts[phase]=fail;
  assert.equal(await f.runtime.start({ordersOnline:true}),true);assert.equal(calls,1);assert.equal(f.calls.at(-1),'finance');
});

for(const phase of ['backup','prepare','show'])test(`lost startup access after ${phase} prevents subsequent effects`,async()=>{
  const f=background(),lose=()=>{f.state.allowed=false};
  if(phase==='backup')f.ports.localServices.backupAfterHydration=lose;else f.ports.alerts[phase]=lose;
  assert.equal(await f.runtime.start({ordersOnline:true}),false);assert.equal(f.calls.includes('finance'),false);
  if(phase!=='show')assert.equal(f.calls.includes('alerts'),false);
});

for(const phase of ['polling','finance'])test(`a failed ${phase} startup keeps the original error and never starts twice`,async()=>{
  const f=background(),failure=new Error('start_failed');let calls=0;
  f.ports[phase].start=async()=>{calls++;throw failure};
  const task=f.runtime.start({ordersOnline:true});await assert.rejects(task,error=>error===failure);
  assert.equal(f.runtime.start({ordersOnline:true}),task);await assert.rejects(task,error=>error===failure);assert.equal(calls,1);
});

test('background access rejection has no effects, and offline local startup omits only polling',async()=>{
  const blocked=background();blocked.state.allowed=false;assert.equal(await blocked.runtime.start({ordersOnline:true}),false);assert.deepEqual(blocked.calls,[]);
  const local=background();await local.runtime.start({ordersOnline:false});assert.deepEqual(local.calls,['backup','prepare-alerts','alerts','finance']);
});

test('storage owns cursor hydration, clones the cloud base and retains pending/conflict semantics',async()=>{
  for(const conflict of [false,true]){
    const session={},base={state:{suppliers:[{id:'S'}]},revision:17},head={base,pending:false,flight:{operationId:'in-flight'},control:conflict?{conflict:{kind:'rebase'}}:null};
    const browser=createStorageBrowser({session,storageV2:{primaryReady:true,cloudState:async()=>head}});
    assert.equal(await browser.recoverCloudCursor(),head);assert.deepEqual(session.lastCloudState,base.state);assert.notEqual(session.lastCloudState,base.state);
    assert.equal(session.cloudRevision,17);assert.equal(session.storageV2CloudPending,true);assert.equal(session.cloudConflictBlocked,conflict);assert.equal(session.cloudSaveRequested,!conflict);
    session.lastCloudState.suppliers[0].id='view-mutated';assert.equal(base.state.suppliers[0].id,'S');
  }
});

test('missing or unreadable durable cloud head fails before changing the existing cursor',async()=>{
  const session={cloudRevision:31,lastCloudState:{old:true}},error=new Error('storage_corrupt');
  for(const value of [null,{},error]){
    const browser=createStorageBrowser({session,storageV2:{primaryReady:true,cloudState:async()=>{if(value===error)throw error;return value}}});
    await assert.rejects(browser.recoverCloudCursor(),value===error?candidate=>candidate===error:/cloud_head_missing/);
    assert.equal(session.cloudRevision,31);assert.deepEqual(session.lastCloudState,{old:true});
  }
});
