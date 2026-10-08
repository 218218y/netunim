import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaCloudStartup} from '../netunim-kupa/site/assets/js/startup/cloud-hydration.js';
import {createKupaLocalServices} from '../netunim-kupa/site/assets/js/startup/local-services.js';
import {createKupaConnectionStartup} from '../netunim-kupa/site/assets/js/startup/connection.js';
import {createRuntimeResources} from '../shared/runtime-resources.js';

const noop=()=>{};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function cloudFixture(){
  const calls=[],statuses=[],session={},state={allowed:true,online:true,authenticated:true,noDocument:false};
  const ports={session,access:{allowed:()=>state.allowed,online:()=>state.online,authenticated:()=>state.authenticated},
    capabilities:{ensure:async()=>calls.push('capabilities')},restore:{resume:async()=>calls.push('restore')},
    cloud:{configured:()=>true,openAutomatic:async()=>{calls.push('open');return true},noDocument:()=>state.noDocument,
      showNoDocument:async()=>calls.push('no-document'),startPolling:()=>calls.push('polling')},
    status:{setCloudHeaderStatus:(...args)=>statuses.push(args),setConnectUI:options=>statuses.push(options)},
  };
  return {runtime:createKupaCloudStartup(ports),ports,calls,statuses,session,state};
}

test('Kupa cloud preparation publishes a frozen mode and hydrates once in order',async()=>{
  const f=cloudFixture(),preparation=f.runtime.prepare({localEngineActive:false});
  assert.equal(f.runtime.prepare({localEngineActive:false}),preparation);assert.ok(Object.isFrozen(await preparation));
  assert.equal(f.session.startupCloudHydrating,true);
  const task=f.runtime.hydrate();assert.equal(f.runtime.hydrate(),task);assert.equal(await task,'opened');
  assert.deepEqual(f.calls,['capabilities','restore','open']);assert.equal(f.session.startupCloudHydrating,false);
  await f.runtime.hydrate();assert.equal(f.calls.length,3);
  assert.throws(()=>f.runtime.prepare({localEngineActive:true}),/startup_mode_changed/);
});

for(const outcome of ['local','offline','signed-out','blocked'])test(`Kupa ${outcome} startup skips remote effects and releases the hydration gate`,async()=>{
  const f=cloudFixture();if(outcome==='offline')f.state.online=false;if(outcome==='signed-out')f.state.authenticated=false;if(outcome==='blocked')f.state.allowed=false;
  await f.runtime.prepare({localEngineActive:outcome==='local'});
  assert.equal(await f.runtime.hydrate(),outcome);assert.deepEqual(f.calls,outcome==='offline'?['polling']:[]);
  assert.equal(f.session.startupCloudHydrating,false);
});

for(const boundary of ['capabilities','restore'])for(const lost of ['allowed','online','authenticated'])test(`Kupa ${lost} loss after ${boundary} stops subsequent cloud startup effects`,async()=>{
  const f=cloudFixture();f.ports[boundary==='capabilities'?'capabilities':'restore'][boundary==='capabilities'?'ensure':'resume']=async()=>{f.calls.push(boundary);f.state[lost]=false};
  await f.runtime.prepare({localEngineActive:false});assert.equal(await f.runtime.hydrate(),'deferred');
  assert.deepEqual(f.calls,boundary==='capabilities'?['capabilities']:['capabilities','restore']);assert.equal(f.session.startupCloudHydrating,false);
});

test('Kupa capability failure retains the original error and cannot begin remote restore/hydration',async()=>{
  const f=cloudFixture(),error=new Error('DB protocol mismatch');f.ports.capabilities.ensure=async()=>{throw error};
  await f.runtime.prepare({localEngineActive:false});assert.equal(await f.runtime.hydrate(),'capability-failure');
  assert.equal(f.session.syncCapabilitiesError,error);assert.equal(f.session.startupCloudHydrating,false);assert.deepEqual(f.calls,[]);
  assert.equal(f.statuses.at(-1).showCloud,false);
});

test('Kupa failed plan installation and unexpected hydration failure remain failed without replay',async()=>{
  const f=cloudFixture(),error=new Error('status failure');f.ports.status.setCloudHeaderStatus=()=>{throw error};
  const preparation=f.runtime.prepare({localEngineActive:false});await assert.rejects(preparation,cause=>cause===error);
  assert.equal(f.runtime.prepare({localEngineActive:false}),preparation);await assert.rejects(f.runtime.hydrate(),/plan_required/);
  const next=cloudFixture();let reads=0;next.ports.cloud.openAutomatic=async()=>{reads++;throw error};
  await next.runtime.prepare({localEngineActive:false});const hydration=next.runtime.hydrate();await assert.rejects(hydration,cause=>cause===error);
  assert.equal(next.runtime.hydrate(),hydration);assert.equal(reads,1);assert.equal(next.session.startupCloudHydrating,false);
});

test('Kupa restore network failure retains its existing report-and-continue policy',async t=>{
  t.mock.method(console,'error',noop);const f=cloudFixture();f.ports.restore.resume=async()=>{throw new TypeError('Failed to fetch')};
  await f.runtime.prepare({localEngineActive:false});assert.equal(await f.runtime.hydrate(),'opened');
  assert.deepEqual(f.calls,['capabilities','open']);assert.ok(f.statuses.some(([mode])=>mode==='conflict'));
});

test('Kupa missing-document UI is shown only while account access remains valid',async()=>{
  for(const loseAccount of [false,true]){
    const f=cloudFixture();f.state.noDocument=true;f.ports.cloud.openAutomatic=async()=>{f.calls.push('open');if(loseAccount)f.state.authenticated=false;return false};
    await f.runtime.prepare({localEngineActive:false});assert.equal(await f.runtime.hydrate(),loseAccount?'deferred':'no-document');
    assert.equal(f.calls.includes('no-document'),!loseAccount);
  }
});

test('Kupa regained connectivity enables the write gate before the first remote effect',async()=>{
  const f=cloudFixture(),gate=deferred(),entered=deferred();f.state.online=false;
  await f.runtime.prepare({localEngineActive:false});f.state.online=true;
  f.ports.capabilities.ensure=async()=>{entered.resolve();await gate.promise};
  const hydration=f.runtime.hydrate();await entered.promise;assert.equal(f.session.startupCloudHydrating,true);
  gate.resolve();await hydration;assert.equal(f.session.startupCloudHydrating,false);
});

test('Kupa optional local services run once, wait for both effects and report independent failures',async()=>{
  const calls=[],errors=[],gate=deferred(),quota=new Error('quota'),permission=new Error('permission');
  const runtime=createKupaLocalServices({storage:{requestPersistentBrowserStorage:async()=>{calls.push('persist');await gate.promise;throw quota}},
    backup:{restoreTarget:async()=>{calls.push('backup');throw permission}},onError:(error,phase)=>errors.push({error,phase})});
  const start=runtime.start();assert.equal(runtime.start(),start);for(let i=0;i<3;i++)await Promise.resolve();
  assert.deepEqual(calls,['persist','backup']);assert.deepEqual(errors,[{error:permission,phase:'backup target startup'}]);
  gate.resolve();await start;assert.equal(errors[1].error,quota);assert.equal(runtime.start(),start);
});

test('Kupa connection bindings have one owner, join repeated starts and dispose without cancelling a running action',async()=>{
  const targets=new Map(['chooseFolder','chooseDataFile','openLastFolder','openCloud'].map(id=>[id,new EventTarget()]));
  const resources=createRuntimeResources(),calls=[],gate=deferred();let running;
  const runtime=createKupaConnectionStartup({events:{listen:(id,handler)=>resources.listen(targets.get(id),'click',handler),dispose:()=>resources.dispose()},
    actions:{chooseFolder:()=>{calls.push('folder');running=gate.promise.then(()=>calls.push('saved'))},chooseDataFile:noop,openLastFolder:noop,openCloud:()=>calls.push('cloud')},
    presentation:{tryAutoOpenRemembered:async()=>false,showFirstRun:()=>calls.push('first-run')},access:{allowed:()=>true}});
  const binding=runtime.bind();assert.equal(runtime.bind(),binding);await binding;
  targets.get('chooseFolder').dispatchEvent(new Event('click'));assert.deepEqual(calls,['folder']);
  assert.equal(runtime.dispose(),true);assert.equal(runtime.dispose(),false);
  targets.get('openCloud').dispatchEvent(new Event('click'));gate.resolve();await running;
  assert.deepEqual(calls,['folder','saved']);await assert.rejects(runtime.openLocal(),/connection_disposed/);
});

test('Kupa partial connection binding failures are retained and cannot duplicate acquired listeners',async()=>{
  const registered=[],error=new Error('element missing');
  const runtime=createKupaConnectionStartup({events:{listen:id=>{registered.push(id);if(id==='openLastFolder')throw error},dispose:noop},
    actions:{chooseFolder:noop,chooseDataFile:noop,openLastFolder:noop,openCloud:noop},
    presentation:{tryAutoOpenRemembered:async()=>false,showFirstRun:noop},access:{allowed:()=>true}});
  const binding=runtime.bind();await assert.rejects(binding,cause=>cause===error);assert.equal(runtime.bind(),binding);
  assert.deepEqual(registered,['chooseFolder','chooseDataFile','openLastFolder']);
});

test('Kupa local connection does not show a primary prompt after losing access during the folder read',async()=>{
  let allowed=true,prompts=0;
  const runtime=createKupaConnectionStartup({events:{listen:noop,dispose:noop},actions:{chooseFolder:noop,chooseDataFile:noop,openLastFolder:noop,openCloud:noop},
    presentation:{tryAutoOpenRemembered:async()=>{allowed=false;return false},showFirstRun:()=>prompts++},access:{allowed:()=>allowed}});
  assert.equal(await runtime.openLocal(),false);assert.equal(prompts,0);
});

test('Kupa startup factories reject missing ports before acquiring any resources',()=>{
  assert.throws(()=>createKupaCloudStartup({session:{}}),/access_allowed_required/);
  assert.throws(()=>createKupaLocalServices({storage:{}}),/requestPersistentBrowserStorage_required/);
  assert.throws(()=>createKupaConnectionStartup({events:{}}),/events_listen_required/);
});
