import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncDocument as createOrdersSync} from '../netunim-orders/site/assets/js/sync/document.js';
import {createSyncDocument as createKupaSync} from '../netunim-kupa/site/assets/js/sync/document.js';

const noop=()=>{},clone=structuredClone;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
async function settle(){for(let turn=0;turn<30;turn++)await Promise.resolve()}
function fixture(app,t){
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,originalError=console.error;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  const jobs=new Map(),timerErrors=[],reported=[],gates=[];
  let next=0;
  globalThis.setTimeout=(run,delay)=>{const id=++next;jobs.set(id,{run,delay});return id};
  globalThis.clearTimeout=id=>jobs.delete(id);
  console.error=(...args)=>reported.push(args);
  const model={state:{notes:[{id:'N',content:'retained'}],checks:[]}},tab={primaryTab:true};
  const session={localGeneration:0,cloudRevision:7,dbRevision:7,financeRevision:0,connectionMode:'supabase',backendReady:true};
  const head={seq:0,base:{revision:7,ackSeq:0,owner:app+':A',epoch:'E',state:clone(model.state)},pending:false,flight:null,control:null};
  let reads=0,preparing=false;
  const ports={model,session,tab,files:{},checksSession:{},toast:noop,render:noop,
    setCloud:noop,setCloudHeaderStatus:noop,setSaveStatus:noop,
    prepareCloudState:clone,prepareKupaCloudState:clone,cloudEnabled:()=>true,cloudHasLocalWork:()=>false,
    sameOrderCloudData:(a,b)=>JSON.stringify(a)===JSON.stringify(b),
    refreshStorageV2CloudState:async()=>clone(head),storageV2CloudOutboxActive:()=>true,assertAccountOwner:noop,
    readCloudMeta:async()=>({revision:7}),readSupabaseDocument:async()=>({revision:7,financeRevision:0}),
    pollSharedChecks:async()=>{},refreshKupaReadout:async()=>false,refreshOrdersFinanceSummary:async()=>false,
    refreshCloudTimestamp:noop,storageV2PreparationActive:()=>preparing,
  };
  const api=(app==='orders'?createOrdersSync:createKupaSync)({...ports,
    readCloudMeta:()=>{reads++;return ports.readCloudMeta()},readSupabaseDocument:()=>{reads++;return ports.readSupabaseDocument()},
    pollSharedChecks:()=>ports.pollSharedChecks(),
  });
  t.after(async()=>{
    for(const gate of gates)gate.resolve();
    await api.quiesceForStorageCutover();jobs.clear();
    globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;console.error=originalError;
    if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;
  });
  return {api,session,tab,head,model,ports,jobs,timerErrors,reported,reads:()=>reads,
    start:()=>app==='orders'?api.startPolling():api.startCloudPolling(),
    stop:()=>app==='orders'?api.stopPolling():api.stopCloudPolling(),
    preparing:value=>{preparing=value},
    gate(){const gate=deferred();gates.push(gate);return gate},
    fire(){const [id,job]=jobs.entries().next().value;jobs.delete(id);const result=job.run();if(result?.catch)result.catch(error=>timerErrors.push(error));return result},
  };
}

for(const app of ['orders','kupa']){
  test(`${app} repeated start during a held poll owns only one future timer`,async t=>{
    const f=fixture(app,t),entered=f.gate(),release=f.gate();
    f.ports[app==='orders'?'readCloudMeta':'readSupabaseDocument']=async()=>{entered.resolve();await release.promise;return {revision:7,financeRevision:0}};
    f.start();f.fire();await entered.promise;
    const running=f.api.cloudPoll();
    f.start();f.start();f.start();
    assert.equal(f.jobs.size,0,'a running cycle owns the next scheduling decision');
    release.resolve();await running;await settle();
    assert.equal(f.jobs.size,1);assert.equal(f.reads(),1);
  });

  test(`${app} scheduled Shared failure is reported without a rejected timer callback`,async t=>{
    const f=fixture(app,t),entered=f.gate(),release=f.gate(),failure=new Error('shared journal read failed');
    f.ports.pollSharedChecks=async()=>{entered.resolve();await release.promise;throw failure};
    f.start();f.fire();await entered.promise;
    const manual=f.api.cloudPoll();release.resolve();
    await assert.rejects(manual,error=>error===failure);
    await settle();
    assert.deepEqual(f.timerErrors,[],'native timers do not consume a returned rejected promise');
    assert.equal(f.reported.some(args=>args.includes(failure)),true);
    assert.equal(f.jobs.size,1,'the existing cadence continues after reporting the failure');
    assert.deepEqual(f.head,{seq:0,base:{revision:7,ackSeq:0,owner:app+':A',epoch:'E',state:clone(f.model.state)},pending:false,flight:null,control:null});
    assert.equal(f.model.state.notes[0].id,'N');
  });

  test(`${app} stop invalidates a delivered old callback and restart schedules one cycle`,async t=>{
    const f=fixture(app,t);f.start();
    const stale=[...f.jobs.values()][0].run;
    assert.equal(f.stop(),true);assert.equal(f.stop(),false);assert.equal(f.jobs.size,0);
    assert.equal(f.start(),true);const current=f.session.cloudPollTimer;
    stale();await settle();
    assert.equal(f.reads(),0);assert.equal(f.session.cloudPollTimer,current);assert.equal(f.jobs.size,1);
    f.fire();await settle();assert.equal(f.reads(),1);assert.equal(f.jobs.size,1);
  });

  test(`${app} stop and restart drain the held operation without starting a second cycle`,async t=>{
    const f=fixture(app,t),entered=f.gate(),release=f.gate();
    f.ports[app==='orders'?'readCloudMeta':'readSupabaseDocument']=async()=>{entered.resolve();await release.promise;return {revision:7,financeRevision:0}};
    f.start();f.fire();await entered.promise;const running=f.api.cloudPoll();
    f.stop();assert.equal(f.jobs.size,0);f.start();assert.equal(f.jobs.size,0);
    release.resolve();assert.equal(await running,true);await settle();
    assert.equal(f.reads(),1);assert.equal(f.jobs.size,1);
    assert.equal(f.model.state.notes[0].id,'N');assert.equal(f.head.base.ackSeq,0);
  });

  test(`${app} cutover drains Shared finally work before completing and never rearms`,async t=>{
    const f=fixture(app,t),entered=f.gate(),release=f.gate();
    f.ports.pollSharedChecks=async()=>{entered.resolve();await release.promise};
    f.start();f.fire();await entered.promise;
    let drained=false;const cutover=f.api.quiesceForStorageCutover().then(()=>{drained=true});
    await settle();assert.equal(drained,false);assert.equal(f.jobs.size,0);
    release.resolve();await cutover;await settle();
    assert.equal(f.session.cloudPollingEnabled,false);assert.equal(f.session.cloudPollTimer,null);assert.equal(f.jobs.size,0);
  });

  for(const loss of ['network','leadership','preparation'])test(`${app} scheduled work rechecks ${loss} and can resume with one timer`,async t=>{
    const f=fixture(app,t);f.start();
    if(loss==='network')navigator.onLine=false;
    if(loss==='leadership')f.tab.primaryTab=false;
    if(loss==='preparation')f.preparing(true);
    f.fire();await settle();assert.equal(f.reads(),0);
    assert.equal(f.jobs.size,loss==='preparation'?0:1);
    navigator.onLine=true;f.tab.primaryTab=true;f.preparing(false);f.start();
    assert.equal(f.jobs.size,1);f.fire();await settle();assert.equal(f.reads(),1);assert.equal(f.jobs.size,1);
  });
}
