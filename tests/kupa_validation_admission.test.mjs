import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalCommitOwner} from '../netunim-kupa/site/assets/js/storage/local-commit.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';
import {hasFailedLocalMutation} from '../shared/local-mutation-admission.js';
import {postAckFixture} from './post_ack_fixture.mjs';

const noop=()=>{},gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function fixture(){
  const model={state:{}},normalization=createStateNormalization({model});
  model.state=normalization.normalizeState({notes:[{id:'N',content:'durable'}]});
  const session={localGeneration:0,connectionMode:'supabase',backendReady:true},tab={primaryTab:true},messages=[];
  let ready=true,scope='A',writes=0,published=0,recovered=structuredClone(model.state),refresh=async()=>({base:{}});
  const owner=createLocalCommitOwner({model,session,tab,
    journal:{storageV2Primary:()=>ready,mutationScope:()=>scope,storageV2CommitPromise:async()=>true,storageV2DurabilityAtRisk:()=>false,
      persistImmediateBrowserSnapshot:()=>{writes++;return true},recoverStorageV2State:async()=>({state:structuredClone(recovered)}),refreshStorageV2CloudState:()=>refresh()},
    projection:{...normalization,creditNormalizationMayDelete:()=>false},publication:{requestCloudSave:async()=>{published++;return true}},
    view:{setSaveStatus:(...args)=>messages.push(args),setCloudHeaderStatus:(...args)=>messages.push(args),showSecondaryTabGuard:noop,isOnline:()=>true}});
  const edit=()=>{model.state.notes[0].content='optimistic';return {operations:[{type:'put',collection:'notes',id:'N',mode:'replace',record:model.state.notes[0]}]}};
  return {model,session,tab,messages,owner,edit,writes:()=>writes,published:()=>published,
    notReady:()=>{ready=false},changeScope:()=>{scope='B';session.localUndurableGenerations=new Set()},
    setRefresh:value=>{refresh=value},setRecovered:value=>{recovered=structuredClone(value)}};
}

test('invariant rejection marks the visible draft and never submits invalid data',async()=>{
  const f=fixture(),options=f.edit();f.model.state.notes.push({...f.model.state.notes[0]});
  assert.equal(await f.owner.saveStateAccepted('invalid',options),false);
  assert.equal(f.writes(),0);assert.equal(f.published(),0);assert.equal(f.session.localGeneration,1);
  assert.equal(hasFailedLocalMutation(f.session),true);assert.ok(f.messages.some(row=>row[0].includes('לא נשמר')));
  assert.equal(f.model.state.notes.length,2,'invalid draft stays available for deliberate export');
});

for(const guard of ['secondary','not-ready','source-switch'])test(`${guard}: rejected optimistic typed edit is unsafe, a call without mutation intent is not`,async()=>{
  const f=fixture();
  if(guard==='secondary')f.tab.primaryTab=false;else if(guard==='not-ready')f.notReady();else f.session.localSourceSwitchPending=true;
  assert.equal(await f.owner.saveStateAccepted('guard only'),false);
  assert.equal(hasFailedLocalMutation(f.session),false);assert.equal(f.session.localGeneration,0);
  assert.equal(await f.owner.saveStateAccepted('rejected edit',f.edit()),false);
  assert.equal(hasFailedLocalMutation(f.session),true);assert.equal(f.writes(),0);assert.equal(f.published(),0);
  assert.ok(f.messages.some(row=>row[0].includes('לא נשמר')));
});

test('a late prepublication error retains its original scope instead of poisoning a replacement account',async()=>{
  const f=fixture(),entered=gate(),held=gate();f.setRefresh(()=>{entered.resolve();return held.promise});
  const saving=f.owner.saveStateAccepted('old owner',f.edit());await entered.promise;
  const old=f.session.localUndurableGenerations;f.changeScope();const count=f.messages.length;
  held.reject(Error('late local read failed'));assert.equal(await saving,false);
  assert.equal(f.session.localUndurableGenerations.size,0);assert.equal(f.messages.length,count);
  assert.ok([...old].some(token=>String(token).startsWith('failed:')));
});

test('a newer valid Main edit cannot conceal an earlier invalid visible draft',async()=>{
  const f=fixture(),options=f.edit();f.model.state.notes.push({...f.model.state.notes[0]});
  assert.equal(await f.owner.saveStateAccepted('invalid',options),false);
  f.model.state.notes.pop();f.model.state.notes[0].content='later valid edit';
  assert.equal(await f.owner.saveStateAccepted('newer',options),false);
  assert.equal(hasFailedLocalMutation(f.session),true);assert.equal(f.published(),0);
});

test('a validation failure during a real cloud flight fences ACK without journaling or erasing the draft',async()=>{
  let rejected=false;
  const f=await postAckFixture('kupa',{beforeResponse:async f=>{
    const owner=createLocalCommitOwner({model:f.model,session:f.session,tab:f.tab,
      journal:{storageV2Primary:()=>true,persistImmediateBrowserSnapshot:()=>{throw Error('invalid data reached journal')}},projection:{},publication:{},
      view:{setSaveStatus:noop,setCloudHeaderStatus:noop,showSecondaryTabGuard:noop}});
    f.model.state.notes.push({...f.model.state.notes[0]});
    rejected=await owner.saveStateAccepted('invalid',{operations:[{type:'put',collection:'notes',id:'original-note',mode:'replace',record:f.model.state.notes[0]}]})===false;
  }});
  assert.equal(await f.save(),false);assert.equal(rejected,true);assert.equal(hasFailedLocalMutation(f.session),true);
  assert.equal(f.model.state.notes.filter(row=>row.id==='original-note').length,2);
  const durable=await f.runtime.recoverReadOnly(),cloud=await f.runtime.cloudState();
  assert.equal(durable.state.notes.filter(row=>row.id==='original-note').length,1);
  assert.equal(cloud.base.revision,10);assert.ok(cloud.flight,'original immutable flight stays available for recovery');
});
