import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdersSync} from './sync_document_ports.mjs';
const clone=structuredClone,noop=()=>{};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}

function fixture({phase,change}={}){
  const entered=deferred(),release=deferred(),calls=[];
  let live={owner:'A:orders',epoch:'E',accountOwner:'A',loginEpoch:1,writable:true};
  const model={state:{notes:[{id:'N',content:'same local state'}],checks:[]}},before=clone(model.state);
  const session={cloudRevision:7,localGeneration:0},tab={primaryTab:true};
  const head=()=>({seq:0,base:{owner:live.owner,epoch:live.epoch,revision:7,ackSeq:0,state:clone(before)},pending:false,flight:null,control:null});
  const wait=async boundary=>{if(phase===boundary){entered.resolve();await release.promise}};
  const api=createOrdersSync({model,session,tab,files:{},getCloudWriteScope:()=>({...live}),
    cloudEnabled:()=>true,cloudHasLocalWork:()=>false,isOnline:()=>true,prepareCloudState:clone,
    sameOrderCloudData:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    refreshStorageV2CloudState:async()=>{const captured=head();await wait('head');return captured},
    readCloud:async()=>{calls.push(['read',live.accountOwner]);await wait('read');return {revision:8,state:{notes:[{id:'N',content:'old account remote'}]}}},
    adoptStorageV2CloudHead:async()=>{calls.push(['adopt',live.accountOwner]);await wait('adopt');return {seq:0,revision:8}},
    applyOrderCloudState:state=>{calls.push(['publish',live.accountOwner]);model.state=clone(state)},
    setStorageV2CloudControl:async()=>{calls.push(['control',live.accountOwner])},
    setCloud:noop,render:noop,refreshCloudTimestamp:noop,pollSharedChecks:async()=>{},refreshKupaReadout:async()=>false});
  return {api,model,before,session,calls,entered,release,switch(){
    if(change==='account')live={...live,owner:'B:orders',accountOwner:'B',epoch:'B'};
    if(change==='epoch')live={...live,epoch:'replacement'};
    if(change==='login')live={...live,loginEpoch:2};
    session.cloudBusy=true;
  }};
}

for(const phase of ['head','read','adopt'])for(const change of ['account','epoch','login'])test('Morning refresh fences '+change+' replacement during '+phase,async t=>{
  t.mock.method(console,'error',noop);
  const f=fixture({phase,change}),pending=f.api.refreshForMorningRecovery();await f.entered.promise;
  f.switch();f.release.resolve();assert.equal(await pending,false);
  assert.deepEqual(f.model.state,f.before);assert.equal(f.session.cloudRevision,7);
  assert.equal(f.session.cloudBusy,true,'old completion cannot clear replacement work');
  assert.ok(!f.calls.some(([action,owner])=>action==='publish'||action==='control'||action==='adopt'&&owner==='B'),JSON.stringify(f.calls));
  if(phase==='head')assert.deepEqual(f.calls,[],'stale journal read must not start HTTP');
});
test('unchanged Morning scope still adopts and publishes the verified remote state',async()=>{
  const f=fixture();assert.equal(await f.api.refreshForMorningRecovery(),true);
  assert.equal(f.model.state.notes[0].content,'old account remote');assert.equal(f.session.cloudRevision,8);assert.equal(f.session.cloudBusy,false);
});
