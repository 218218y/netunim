import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteAdoption} from '../netunim-kupa/site/assets/js/sync/remote-adoption.js';
import {cloudWriteScopeIsCurrent} from '../shared/cloud-write-scope.js';
const clone=structuredClone,noop=()=>{};
function gate(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function fixture({phase,change,discard=true}={}){
  let pending=discard;
  let live={owner:'A:kupa',epoch:'E',accountOwner:'A',loginEpoch:1,writable:true};const entered=gate(),release=gate(),calls=[];
  const initial={notes:[{id:'N',content:'original'}],credits:[],checks:[],bank:{adjustments:[]},creditSync:{}},model={state:clone(initial),lastNormalizeRemovedCredits:0};
  const session={localGeneration:0,dbRevision:7,financeRevision:0,serverInfo:{}},tab={primaryTab:true};
  const head=()=>({seq:0,base:{owner:live.owner,epoch:live.epoch,revision:7,ackSeq:0,state:clone(initial)},pending,flight:null,control:null});
  const remote={revision:8,financeRevision:0,financeAvailable:false,state:{...clone(initial),notes:[{id:'N',content:'old account remote'}]}};
  const wait=async boundary=>{if(phase===boundary){entered.resolve();await release.promise}};
  const api=createRemoteAdoption({model,session,tab,access:{getCloudWriteScope:()=>({...live}),writeScopeCurrent:(scope,h)=>cloudWriteScopeIsCurrent(scope,live,h),storageV2CloudOutboxActive:()=>true,assertAccountOwner:noop,markCloudMode:noop},
    journal:{refreshStorageV2CloudState:async()=>{const captured=head();await wait('head');return captured},resetStorageV2CloudHead:async()=>{calls.push(['reset',live.accountOwner]);await wait('reset');pending=false},adoptStorageV2CloudHead:async()=>({seq:0,revision:8,pending:false,control:null}),setStorageV2CloudControl:async()=>calls.push(['control',live.accountOwner])},
    projection:{prepareKupaCloudState:clone,applyKupaCloudState:clone},transport:{readSupabaseDocument:async()=>{calls.push(['read',live.accountOwner]);await wait('read');return clone(remote)}},
    view:{setSaveStatus:noop,setCloudHeaderStatus:noop,hideConnectScreen:noop,setConnectedStatus:noop,render:noop},mirror:{backupSnapshotToComputer:noop},secondary:{syncSharedChecksFromCloud:async()=>{},refreshOrdersFinanceSummary:async()=>{}},write:{requestStorageV2CloudSave:async()=>true,startCloudPolling:noop},
  });
  return {api,entered,release,model,session,calls,switch(){
    if(change==='account')live={...live,owner:'B:kupa',accountOwner:'B',epoch:'B'};
    if(change==='epoch')live={...live,epoch:'replacement'};
    if(change==='login')live={...live,loginEpoch:2};
    model.state={...clone(initial),notes:[{id:'B',content:'replacement view'}]};session.dbRevision=20;return clone(model.state);
  }};
}
for(const discard of [false,true])for(const phase of discard?['head','read','reset']:['head','read'])for(const change of ['account','epoch','login'])test('cloud '+(discard?'discard':'load')+' fences '+change+' during '+phase,async()=>{
  const f=fixture({phase,change,discard}),pending=f.api.loadSupabaseState({discardLocalV2:discard});await f.entered.promise;const expected=f.switch();f.release.resolve();
  await assert.rejects(pending,/cloud_sync_scope_changed/);assert.deepEqual(f.model.state,expected);assert.equal(f.session.dbRevision,20);
  assert.ok(!f.calls.some(([action,owner])=>action==='control'||action==='reset'&&owner==='B'),JSON.stringify(f.calls));
  if(phase==='head')assert.deepEqual(f.calls,[]);
});
for(const discard of [false,true])test('unchanged cloud '+(discard?'discard':'load')+' still applies the remote document',async()=>{
  const f=fixture({discard});await f.api.loadSupabaseState({discardLocalV2:discard});
  assert.equal(f.model.state.notes[0].content,'old account remote');assert.equal(f.session.dbRevision,8);
});
