import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalMutationAdmission,hasFailedLocalMutation} from '../shared/local-mutation-admission.js';
import {createOrdersLocalCommit} from '../netunim-orders/site/assets/js/storage/local-commit.js';
import {createLocalCommitOwner} from '../netunim-kupa/site/assets/js/storage/local-commit.js';
import {postAckFixture} from './post_ack_fixture.mjs';
const noop=()=>{};
function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

test('50 admissions retain one failed draft across newer success without rollback or duplicate submission',async()=>{
  const session={},failures=[],gates=Array.from({length:50},gate);let submissions=0;
  const admission=createLocalMutationAdmission({session,onFailure:error=>failures.push(error)});
  const receipts=gates.map((g,i)=>admission.admit(i,()=>{submissions++;return {localOk:false,accepted:true,committed:g.promise}}));
  assert.equal(receipts[0].phase,'durable-pending');gates[24].reject(Error('IDB abort'));
  for(let i=49;i>=0;i--)if(i!==24)gates[i].resolve(true);
  const results=await Promise.all(receipts.map(receipt=>receipt.settled));
  assert.equal(results.filter(Boolean).length,49);assert.equal(submissions,50);assert.equal(failures.length,1);
  assert.equal(hasFailedLocalMutation(session),true);assert.ok(session.localUndurableGenerations.has('failed:24'));
  assert.equal(receipts[24].phase,'failed');assert.equal(receipts[49].phase,'durable');
});
test('synchronous rejection and false commit never masquerade as durable admission',async()=>{
  for(const kind of ['throw','false','missing']){
    const session={},errors=[],admission=createLocalMutationAdmission({session,onFailure:error=>errors.push(error)});
    const receipt=admission.admit(1,()=>{if(kind==='throw')throw Error('storage_v2_write_unavailable');return {localOk:true,accepted:true,committed:kind==='missing'?null:Promise.resolve(false)}});
    assert.equal(await receipt.committed,false);assert.equal(hasFailedLocalMutation(session),true);assert.equal(errors.length,1);
    assert.ok(['failed','rejected'].includes(receipt.phase));
  }
});
test('late failure preserves its original risk without notifying a replacement account',async()=>{
  let scope='A',reports=0;const session={},g=gate(),old=new Set();
  session.localUndurableGenerations=old;
  const admission=createLocalMutationAdmission({session,scope:()=>scope,onFailure:()=>reports++});
  const receipt=admission.admit(1,()=>({localOk:false,accepted:true,committed:g.promise}));
  scope='B';session.localUndurableGenerations=new Set();g.reject(Error('late abort'));
  assert.equal(await receipt.settled,false);assert.equal(reports,0);assert.ok(old.has('failed:1'));
  assert.equal(session.localUndurableGenerations.size,0);
});

test('a retry retires failed markers only with complete durable proof and a stable generation',async()=>{
  const session={localGeneration:1},admission=createLocalMutationAdmission({session,onFailure:noop});
  admission.reject(1,Error('failed'));
  assert.equal(await admission.reconcile(async()=>false),false);
  assert.equal(await admission.reconcile(async()=>{session.localGeneration++;return true}),false);
  assert.equal(hasFailedLocalMutation(session),true);
  assert.equal(await admission.reconcile(async()=>true),true);assert.equal(session.localUndurableGenerations.size,0);
});

for(const app of ['orders','kupa'])for(const fault of ['admission','commit','unconfirmed'])test(`${app}: ${fault} keeps the optimistic draft explicitly unsafe and blocks cloud publication`,async t=>{
  t.mock.method(console,'error',noop);
  const f=await postAckFixture(app),statuses=[],g=gate();let publications=0;
  const fail=()=>{if(fault==='admission')throw Error('storage_v2_write_unavailable');return false};
  const view={setSave:(...args)=>statuses.push(args),setCloud:(...args)=>statuses.push(args),folderSaveTitle:()=>'',
    setSaveStatus:(...args)=>statuses.push(args),setCloudHeaderStatus:(...args)=>statuses.push(args),showSecondaryTabGuard:noop,isOnline:()=>true};
  f.model.state.notes[0].content='visible uncommitted draft';
  let result;
  if(app==='orders'){
    const owner=createOrdersLocalCommit({access:{primary:()=>true,error:()=>null,showSecondaryTabGuard:noop},session:f.session,
      journal:{localSnapshot:fail,storageV2CommitPromise:()=>g.promise,storageV2DurabilityAtRisk:()=>true},projection:{touch:noop,touchAll:noop},view,platform:{reload:noop}});
    const receipt=owner.accept({operations:[{type:'put',collection:'notes',id:'original-note',mode:'replace',record:f.model.state.notes[0]}]});
    result=receipt.settled;
  }else{
    const owner=createLocalCommitOwner({model:f.model,session:f.session,tab:f.tab,journal:{storageV2Primary:()=>true,storageV2CommitPromise:()=>g.promise,
      storageV2DurabilityAtRisk:()=>true,persistImmediateBrowserSnapshot:fail,refreshStorageV2CloudState:()=>f.runtime.cloudState()},
      projection:{normalizeState:structuredClone,prepareKupaCloudState:f.project,creditNormalizationMayDelete:()=>false},
      publication:{requestCloudSave:async()=>{publications++;return true}},view});
    result=owner.saveStateAccepted('edit',{operations:[{type:'put',collection:'notes',id:'original-note',mode:'replace',record:f.model.state.notes[0]}]});
  }
  if(fault==='commit')g.reject(Error('QuotaExceededError'));else g.resolve(false);
  assert.equal(await result,false);assert.equal(hasFailedLocalMutation(f.session),true);assert.equal(publications,0);
  assert.ok(statuses.some(args=>args.some(value=>String(value).includes('לא נשמר'))));
  assert.equal(f.model.state.notes[0].content,'visible uncommitted draft');
  assert.equal((await f.runtime.recoverReadOnly()).state.notes[0].content,'flight-value');
  assert.equal(await f.save(),false);assert.equal(f.calls.length,0);
});

for(const app of ['orders','kupa'])test(`${app}: failure during an in-flight ACK cannot overwrite the newer visible draft`,async t=>{
  t.mock.method(console,'warn',noop);
  const f=await postAckFixture(app,{onCommitted:f=>{
    f.model.state.notes[0].content='draft not admitted to journal';
    f.session.localUndurableGenerations=new Set(['failed:late']);
  }});
  assert.equal(await f.save(),false);
  assert.equal(f.model.state.notes[0].content,'draft not admitted to journal');
  const head=await f.runtime.cloudState();assert.equal(head.base.revision,11);assert.ok(head.control.conflict);
  assert.equal((await f.runtime.recoverReadOnly()).state.notes[0].content,'flight-value');
});
