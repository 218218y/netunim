import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudPolling as orders} from '../netunim-orders/site/assets/js/sync/polling.js';
import {createCloudPolling as kupa} from '../netunim-kupa/site/assets/js/sync/polling.js';
import {cloudWriteScopeIsCurrent} from '../shared/cloud-write-scope.js';
const clone=structuredClone,noop=()=>{};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function fixture(app,{phase,change}={}){
  const entered=deferred(),release=deferred(),calls=[];
  let live={owner:app+':A',epoch:'E',accountOwner:'A',loginEpoch:1,writable:true};
  const state={notes:[{id:'N',content:'same local state'}],checks:[]},model={state:clone(state)},tab={primaryTab:true};
  const session={localGeneration:0,cloudRevision:7,dbRevision:7,financeRevision:0,connectionMode:'supabase',backendReady:true};
  const head=()=>({seq:0,base:{owner:live.owner,epoch:live.epoch,revision:7,ackSeq:0,state:clone(state)},pending:false,flight:null,control:null});
  const wait=async boundary=>{if(phase===boundary){entered.resolve();await release.promise}};
  const remote={revision:8,financeRevision:0,state:{notes:[{id:'N',content:'old account reply'}],checks:[]}};
  const adopt=async(row,...args)=>{
    const options=app==='orders'?args[2]:args[0];calls.push(['adopt',live.accountOwner]);await wait('adopt');
    if(options?.isCurrent&&!options.isCurrent())return false;
    calls.push(['publish',live.accountOwner]);model.state=clone(row.state);return true;
  };
  const factory=app==='orders'?orders:kupa;
  const api=factory({model,session,tab,files:{},
    access:{getCloudWriteScope:()=>({...live}),writeScopeCurrent:(scope,h)=>cloudWriteScopeIsCurrent(scope,live,h),isOnline:()=>true,cloudEnabled:()=>true,cloudHasLocalWork:()=>false,storageV2PreparationActive:()=>false,storageV2CloudOutboxActive:()=>true,assertAccountOwner:noop},
    state:{prepareCloudState:clone,prepareKupaCloudState:clone,sameOrderCloudData:(a,b)=>JSON.stringify(a)===JSON.stringify(b),refreshStorageV2CloudState:async()=>{const captured=head();await wait('head');return captured}},
    remote:{readCloudMeta:async()=>({revision:8}),readCloud:async()=>{calls.push(['read',live.accountOwner]);await wait('read');return clone(remote)},readSupabaseDocument:async()=>{calls.push(['read',live.accountOwner]);await wait('read');return clone(remote)}},
    view:{setCloud:noop,render:noop,toast:noop,setSaveStatus:noop,setCloudHeaderStatus:noop},
    adoption:{adoptRemoteRow:adopt,applyCloudRow:adopt,applyFinanceOnlyRow:adopt,reviewCleanConflict:async h=>h,setStorageV2CloudControl:async()=>calls.push(['control',live.accountOwner]),writeStateToFolder:noop},
    secondary:{pollSharedChecks:async()=>{},refreshKupaReadout:async()=>{},pollIndependentFinance:async()=>{},refreshOrdersFinanceSummary:async()=>{}},
    write:{requestCloudSave:async()=>true,requestStorageV2CloudSave:async()=>true},
    confirmation:{pollAccessCurrent:()=>true,pollViewCurrent:()=>true,markCloudPollDeferred:()=>false,confirmCloudPollSynced:async()=>true,markCloudPollSynced:async()=>true,markCloudPollFailure:()=>false},
  });
  return {api,model,state,session,calls,entered,release,switch(){
    if(change==='account')live={...live,owner:app+':B',accountOwner:'B',epoch:'B'};
    if(change==='epoch')live={...live,epoch:'replacement'};
    if(change==='login')live={...live,loginEpoch:2};
    session.cloudBusy=true;session.cloudSyncBusy=true;
  }};
}
for(const app of ['orders','kupa']){
  for(const phase of ['head','read','adopt'])for(const change of ['account','epoch','login'])test(app+' poll fences '+change+' replacement during '+phase,async()=>{
    const f=fixture(app,{phase,change}),pending=f.api.poll();await f.entered.promise;f.switch();f.release.resolve();assert.equal(await pending,false);
    assert.deepEqual(f.model.state,f.state);assert.equal(f.session.cloudRevision,7);assert.equal(f.session.dbRevision,7);
    assert.equal(f.session[app==='orders'?'cloudBusy':'cloudSyncBusy'],true,'old completion cannot clear replacement work');
    assert.ok(!f.calls.some(([action,owner])=>action==='publish'||action==='control'||action==='adopt'&&owner==='B'),JSON.stringify(f.calls));
    if(phase==='head')assert.deepEqual(f.calls,[]);
  });
  test(app+' unchanged poll scope still adopts its newer remote head',async()=>{
    const f=fixture(app);assert.equal(await f.api.poll(),true);assert.equal(f.model.state.notes[0].content,'old account reply');
  });
}
