import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncDocument} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createSyncChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';
import {createUiStatus} from '../netunim-kupa/site/assets/js/ui/status.js';

const clone=structuredClone,noop=()=>{};

function fixture({onCheckpoint=async()=>{},financeReadError=null}={}){
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  globalThis.localStorage={getItem:()=>null,setItem:noop,removeItem:noop};
  const model={state:{}},normalization=createStateNormalization({model,externalWorkbooks:true});
  model.state=normalization.normalizeState({creditSync:{version:4,profiles:[],cardMappings:{}}});
  model.state.notes=[{id:'local-note',content:'preserve local work',createdAt:'2026-10-07',updatedAt:'2026-10-07'}];
  const session={connectionMode:'supabase',backendReady:true,dbRevision:479,financeRevision:10,localGeneration:0,cloudConflictPending:true,serverInfo:{lastSavedAt:null}};
  const checksSession={},tab={primaryTab:true},statuses=[],saveStatuses=[],checkpoints=[],reads=[];
  const cloud={seq:1,base:{revision:479,ackSeq:0,state:normalization.prepareKupaCloudState(model.state)},pending:true,flight:null,control:{conflict:{kind:'record-conflict',domain:'kupa'}}};
  const remote={revision:480,financeRevision:11,financeAvailable:true,financeUpdatedAt:'2026-10-08T07:00:00Z',state:clone(model.state)};
  remote.state.notes=[{id:'remote-note',content:'remote work',createdAt:'2026-10-08',updatedAt:'2026-10-08'}];
  remote.state.bank={...remote.state.bank,source:'hapoalim',currentBalance:12345,updatedAt:'2026-10-08T07:00:00Z',asOfDate:'2026-10-08',bankSyncAt:'2026-10-08T07:00:00Z'};
  remote.state.creditSync={version:4,profiles:[],cardMappings:{},syncedAt:'2026-10-08T07:00:00Z'};
  const header={replaceChildren:(_icon,text)=>statuses.push([header.className.split(' ').at(-1),text.trim()])};
  const save={};
  globalThis.document={getElementById:id=>id==='cloudHeaderStatus'?header:id==='saveIndicator'?save:null,createElement:()=>({}),createTextNode:text=>text};
  const status=createUiStatus({session,checksSession,tab,storageRecovery:{isReady:()=>true}});
  const setCloudHeaderStatus=(...args)=>status.setCloudHeaderStatus(...args),setSaveStatus=(...args)=>{status.setSaveStatus(...args);saveStatuses.push([save.textContent,save.className.split(' ').at(-1)])};
  const sharedChecksV2={requested:true,primaryReady:true,lastRemoteUpdatedAt:'2026-10-08T07:00:00Z',sync:async()=>true,cloudState:async()=>({base:{revision:139,state:{checks:[],bankEvents:[]}},pending:false,control:null})};
  const checks=createSyncChecks({sharedChecksV2,checksSession,model,session,tab,toast:noop,render:noop,setSaveStatus:(text,mode)=>setSaveStatus(text,mode,'shared-checks'),setCloudHeaderStatus:(mode,text)=>setCloudHeaderStatus(mode,text,'shared-checks'),refreshCloudHeaderTimestamp:status.refreshCloudHeaderTimestamp});
  const api=createSyncDocument({model,session,checksSession,tab,
    prepareKupaCloudState:normalization.prepareKupaCloudState,applyKupaCloudState:normalization.applyKupaCloudState,
    refreshStorageV2CloudState:async()=>clone(cloud),storageV2CloudOutboxActive:()=>true,
    readSupabaseDocument:async()=>{reads.push('main');return clone(remote)},
    readFinanceSyncDocument:async()=>{reads.push('finance');if(financeReadError)throw financeReadError;return {revision:remote.financeRevision,updated_at:remote.financeUpdatedAt,state:{bank:clone(remote.state.bank),creditSync:clone(remote.state.creditSync)}}},
    replaceStorageV2CurrentState:async(state,options)=>{await onCheckpoint({model,session,tab,cloud,state,options});checkpoints.push(clone(state));return options.expectedSeq},
    clearStorageV2CloudControl:async({onlyIfClean})=>{assert.equal(onlyIfClean.kind,cloud.control.conflict.kind);assert.equal(onlyIfClean.seq,cloud.seq);assert.equal(onlyIfClean.baseRevision,cloud.base.revision);cloud.control=null;return true},
    assertAccountOwner:()=>true,syncSharedChecksFromCloud:checks.syncSharedChecksFromCloud,
    listBackups:async()=>[],backupSnapshotToComputer:async()=>{},setConnectedStatus:noop,hideConnectScreen:noop,
    adoptStorageV2CloudHead:async(revision,state,{cloudState})=>{cloud.base={revision,state:clone(cloudState),ackSeq:cloud.seq};checkpoints.push(clone(state))},
    pollSharedChecks:checks.pollSharedChecks,setCloudHeaderStatus,setSaveStatus,
    render:noop,toast:noop,refreshOrdersFinanceSummary:async()=>false,
  });
  return {api,checks,status,model,session,tab,cloud,remote,statuses,saveStatuses,checkpoints,reads};
}

test('successful Shared Checks polling cannot mark a conflicted Kupa Main document synced',async()=>{
  const f=fixture();
  assert.equal(await f.api.cloudPoll(),false);
  assert.equal(f.statuses.at(-1)[0],'conflict');
  assert.ok(!f.saveStatuses.some(([,mode])=>mode==='ok'));
  assert.equal(f.session.cloudConflictPending,true);
});

test('Kupa Main conflict does not block independent Finance hydration or change local Main work',async()=>{
  const f=fixture(),before=clone(f.model.state),control=clone(f.cloud.control),base=clone(f.cloud.base);
  assert.equal(await f.api.cloudPoll(),false);
  assert.equal(f.model.state.bank.currentBalance,12345);
  assert.equal(f.model.state.bank.updatedAt,f.remote.financeUpdatedAt);
  assert.equal(Date.parse(f.model.state.creditSync.syncedAt),Date.parse(f.remote.financeUpdatedAt));
  assert.equal(f.session.financeRevision,11);
  assert.deepEqual(f.model.state.notes,before.notes);
  assert.deepEqual(f.cloud.control,control);assert.deepEqual(f.cloud.base,base);
  assert.equal(f.cloud.pending,true);assert.equal(f.session.dbRevision,479);
  assert.equal(f.checkpoints.length,1);
  assert.deepEqual(f.checkpoints[0].notes,before.notes);
  assert.deepEqual(f.reads,['finance']);
});

test('a stale dirty-head fence is revalidated and the newer Main cloud head is adopted',async t=>{
  const f=fixture();t.after(()=>{f.session.cloudPollingEnabled=false;clearTimeout(f.session.cloudPollTimer)});
  f.cloud.pending=false;f.cloud.base.ackSeq=f.cloud.seq;f.cloud.control.conflict={kind:'storage-v2-dirty-head',domain:'kupa'};
  assert.equal(await f.api.cloudPoll(),true);
  assert.equal(f.cloud.control,null);assert.equal(f.session.cloudConflictPending,false);
  assert.equal(f.session.dbRevision,480);assert.equal(f.cloud.base.revision,480);
  assert.deepEqual(f.model.state.notes,f.remote.state.notes);
  assert.deepEqual(f.reads,['main']);assert.equal(f.statuses.at(-1)[0],'synced');
});

test('an unjournaled live difference keeps its dirty-head fence while Finance refreshes',async()=>{
  const f=fixture();f.cloud.pending=false;f.cloud.base.ackSeq=f.cloud.seq;f.cloud.control.conflict={kind:'storage-v2-dirty-head',domain:'kupa'};
  f.model.state.notes[0].content='untracked difference to preserve';
  assert.equal(await f.api.cloudPoll(),false);
  assert.equal(f.cloud.control.conflict.kind,'storage-v2-dirty-head');
  assert.equal(f.model.state.notes[0].content,'untracked difference to preserve');
  assert.equal(f.model.state.bank.currentBalance,12345);assert.equal(f.session.dbRevision,479);
});

for(const kind of ['concurrent-ack','ack-publication-failed','entity-conflict'])test(`${kind} is never retired by clean Main polling`,async()=>{
  const f=fixture();f.cloud.pending=false;f.cloud.base.ackSeq=f.cloud.seq;f.cloud.control.conflict={kind,domain:'kupa'};
  assert.equal(await f.api.cloudPoll(),false);assert.equal(f.cloud.control.conflict.kind,kind);
  assert.equal(f.session.cloudConflictPending,true);assert.equal(f.session.dbRevision,479);
});

test('offline polling leaves the dirty-head fence and every local datum unchanged',async()=>{
  const f=fixture(),before=clone(f.model.state);f.cloud.pending=false;f.cloud.base.ackSeq=f.cloud.seq;f.cloud.control.conflict={kind:'storage-v2-dirty-head',domain:'kupa'};
  navigator.onLine=false;
  assert.equal(await f.api.cloudPoll(),false);assert.deepEqual(f.model.state,before);
  assert.equal(f.cloud.control.conflict.kind,'storage-v2-dirty-head');assert.deepEqual(f.reads,[]);
});

for(const cause of ['network','quota'])test(`a Finance ${cause} failure cannot advance its revision or publish its data`,async t=>{
  t.mock.method(console,'warn',noop);
  const f=fixture(cause==='network'?{financeReadError:new TypeError('Failed to fetch')}:{onCheckpoint:async()=>{throw new DOMException('quota','QuotaExceededError')}}),before=clone(f.model.state);
  assert.equal(await f.api.cloudPoll(),false);
  assert.deepEqual(f.model.state,before);assert.equal(f.session.financeRevision,10);
  assert.equal(f.cloud.control.conflict.kind,'record-conflict');assert.equal(f.checkpoints.length,0);
});

test('an edit during Finance commit stays visible and cannot be published over by the older snapshot',async()=>{
  const f=fixture({onCheckpoint:async({model,session,cloud,options})=>{assert.equal(options.expectedSeq,1);model.state.notes[0].content='new edit during commit';session.localGeneration++;cloud.seq++;cloud.pending=true}});
  assert.equal(await f.api.cloudPoll(),false);
  assert.equal(f.model.state.notes[0].content,'new edit during commit');
  assert.equal(f.model.state.bank.currentBalance,null);assert.equal(f.session.financeRevision,10);
  assert.equal(f.cloud.seq,2);assert.equal(f.cloud.pending,true);assert.equal(f.cloud.control.conflict.kind,'record-conflict');
});

test('Finance hydration preserves manual bank data, adjustments and the Main snapshot watermark',async()=>{
  const f=fixture();Object.assign(f.model.state.bank,{source:'manual',currentBalance:500,updatedAt:'2026-10-07T07:00:00Z',asOfDate:'2026-10-07',sourceAccount:null,adjustments:[{id:'A',type:'manual',amount:5}],snapshotToken:'main-watermark',snapshotSeq:2});
  const before=clone(f.model.state.bank);
  assert.equal(await f.api.cloudPoll(),false);
  for(const key of ['currentBalance','source','updatedAt','asOfDate','adjustments','snapshotToken','snapshotSeq'])assert.deepEqual(f.model.state.bank[key],before[key],key);
  assert.equal(f.session.financeRevision,11);
});

test('Main success cannot hide a Shared conflict, and logout clears all document statuses',()=>{
  const f=fixture();f.session.cloudConflictPending=false;
  f.status.setCloudHeaderStatus('conflict','Shared conflict','shared-checks');
  f.status.setCloudHeaderStatus('synced','Main synced');
  assert.equal(f.statuses.at(-1)[0],'conflict');
  f.session.cloudConflictPending=true;
  f.status.setCloudHeaderStatus('off','Signed out');
  assert.deepEqual(f.statuses.at(-1),['off','Signed out']);
});
