import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStorageStartupAdmission} from '../shared/storage-startup-protocol.js';
import {createLifecycle as orders} from '../netunim-orders/site/assets/js/lifecycle.js';
import {createLifecycle as kupa} from '../netunim-kupa/site/assets/js/lifecycle.js';
import {withOrdersStartup,withKupaStartup} from './startup_ports.mjs';
const noop=()=>{};
function fixture(){
  const state={owner:'local',accountV2Active:false,localEngineActive:false},calls=[];
  let primary=true,pending=false,birthPending=false;
  const ports={protocol:{currentOwner:()=>state.owner,readMarkers:async()=>({...state}),verifyLocal:async()=>state.localEngineActive},primary:()=>primary,
    transfer:{preparing:()=>pending,resume:async()=>{calls.push('transfer');state.owner='B';state.accountV2Active=true;state.localEngineActive=false;pending=false}},
    birth:{preparing:()=>birthPending,ensure:async()=>{calls.push('birth');state.localEngineActive=true;birthPending=false}}};
  return {state,calls,ports,admission:createStorageStartupAdmission(ports),lead:value=>{primary=value},pending:value=>{pending=value},birthPending:value=>{birthPending=value}};
}
test('admission resumes transfer before markers and never starts local birth for activated account',async()=>{
  const f=fixture();f.pending(true);const result=await f.admission.admit({...f.state});assert.equal(result.ok,true);assert.equal(result.state.owner,'B');assert.deepEqual(f.calls,['transfer']);
});
test('local admission verifies the marker and does not replay a completed birth',async()=>{
  const f=fixture();await f.admission.admit({...f.state});await f.admission.admit({...f.state});assert.deepEqual(f.calls,['birth']);
});
test('a retained birth must settle even when an existing local marker is present',async()=>{
  const f=fixture();f.state.localEngineActive=true;f.birthPending(true);assert.equal((await f.admission.admit({...f.state})).ok,true);assert.deepEqual(f.calls,['birth']);
});
for(const stage of ['birth','transfer'])test(`unfinished ${stage} cannot publish admission`,async()=>{
  const f=fixture();if(stage==='transfer')f.pending(true);
  if(stage==='birth')f.ports.birth.ensure=async()=>{};else f.ports.transfer.resume=async()=>{};
  const result=await f.admission.admit({...f.state});assert.equal(result.ok,false);assert.equal(result.stage,stage==='birth'?'local':'transfer');
});
for(const lost of ['owner','primary'])test(`loss of ${lost} while birth settles prevents admission`,async()=>{
  const f=fixture();f.ports.birth.ensure=async()=>{f.state.localEngineActive=true;if(lost==='owner')f.state.owner='B';else f.lead(false)};
  await assert.rejects(f.admission.admit({...f.state}),/owner_changed|primary_required/);
});
test('account markers are required independently of a local engine marker',async()=>{
  const f=fixture();f.state.owner='A';f.state.localEngineActive=true;await assert.rejects(f.admission.admit({...f.state}),/account_marker_required/);assert.deepEqual(f.calls,[]);
});
test('secondary admission never runs transfer or birth; viewing is a separate decision',async()=>{
  const f=fixture();f.lead(false);f.pending(true);assert.equal(f.admission.readOnlyRequired(f.state),true);await assert.rejects(f.admission.admit(f.state),/primary_required/);assert.deepEqual(f.calls,[]);
});

for(const [app,create,compose] of [['Orders',orders,withOrdersStartup],['Kupa',kupa,withKupaStartup]])for(const lost of ['owner','leadership'])test(`${app} ${lost} loss during journal recovery blocks activation and rendering`,async t=>{
  t.mock.method(console,'error',noop);let owner='local';const tab={primaryTab:true},session={},events=[];
  const ports=compose({tab,session,storageOwnerCurrent:()=>owner,online:()=>false,
    verifyLocalStorageEngine:async()=>true,verifyStorageV2AccountMarker:async()=>false,
    acquirePrimaryTabLock:async()=>{},hydrateStorageOwner:async()=>{},restoreSupaSession:async()=>null,loadSession:()=>null,
    recoverLocalV2State:async()=>{if(lost==='owner')owner='B';else tab.primaryTab=false;return true},recoverSharedChecksV2Primary:async()=>true,
    render:()=>events.push('render'),hideConnectScreen:noop,setConnectUI:noop,setSave:noop,setCloud:noop,syncFolderAccessButton:noop,
    setCloudHeaderStatus:noop,setSaveStatus:noop,setConnectedStatus:noop,showSecondaryTabGuard:noop});
  const boot=create(ports).boot();await assert.rejects(boot,/owner_changed|primary_required/);
  assert.equal(ports.storageRecovery.isReady(),false);assert.equal(session.storageProtocolBlocked,true);assert.deepEqual(events,[]);
});

test('implementation mutation reproduces premature admission after lost leadership',async()=>{
  let source=fs.readFileSync('shared/storage-startup-protocol.js','utf8').replaceAll('\r\n','\n');
  source=source.replace("'./storage-v2-server-protocol.js'",JSON.stringify(new URL('../shared/storage-v2-server-protocol.js',import.meta.url).href));
  const guard="if(!primary())throw new Error('startup_admission_primary_required');";assert.ok(source.includes(guard));source=source.replaceAll(guard,'');
  const {createStorageStartupAdmission:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const f=fixture();f.ports.birth.ensure=async()=>{f.state.localEngineActive=true;f.lead(false)};
  assert.equal((await unsafe(f.ports).admit({...f.state})).ok,true);
});
