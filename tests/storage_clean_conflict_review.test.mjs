import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const clone=structuredClone;
const initial={notes:[{id:'N',content:'acknowledged local work'}],setting:1};
const change=content=>[{type:'put',collection:'notes',mode:'replace',id:'N',record:{id:'N',content}}];
const conflict={kind:'storage-v2-dirty-head',domain:'kupa',baseRevision:479,currentRemoteRevision:480};
const review={onlyIfClean:{kind:conflict.kind,seq:0,baseRevision:479}};

async function fixture(){
  const db=memoryDb(),journal=createStorageJournal({owner:'account-A:kupa',schema:{collections:['notes'],fields:['setting']},validate:value=>assert.ok(Array.isArray(value.notes)),db,emergency:emergencyStore()});
  await journal.initializeCloudHead(479,initial);
  await journal.setCloudControl({conflict});
  return {db,journal};
}

test('a disproved dirty-head fence is removed without changing the acknowledged data or cursor',async()=>{
  const {journal}=await fixture(),before=await journal.recover();
  assert.equal(await journal.clearCloudControl(review),true);
  const after=await journal.recover(),cloud=await journal.cloudState();
  assert.deepEqual(after.state,before.state);assert.equal(after.seq,0);
  assert.equal(cloud.base.revision,479);assert.equal(cloud.base.ackSeq,0);
  assert.equal(cloud.pending,false);assert.equal(cloud.flight,null);assert.equal(cloud.control,null);
});

test('clean-fence review refuses durable differences, pending work, flights and changed control metadata',async()=>{
  for(const scenario of ['dirty','pending','flight','kind','revision','sequence','retry']){
    const {journal}=await fixture();
    if(scenario==='dirty')await journal.replaceCurrentState({...clone(initial),notes:[{id:'N',content:'untracked difference'}]});
    if(['pending','flight'].includes(scenario))await journal.append(change('pending edit')).committed;
    if(scenario==='flight')await journal.materializeFlight({operationId:'immutable-flight',baseRevision:479});
    if(scenario==='kind')await journal.setCloudControl({conflict:{...conflict,kind:'concurrent-ack'}});
    if(scenario==='retry')await journal.setCloudControl({conflict,retry:{nextAttemptAt:'2026-10-09T00:00:00Z'}});
    const options=clone(review);
    if(scenario==='revision')options.onlyIfClean.baseRevision=478;
    if(scenario==='sequence')options.onlyIfClean.seq=1;
    const before=await journal.recover();
    assert.equal(await journal.clearCloudControl(options),false,scenario);
    assert.deepEqual(await journal.recover(),before,scenario);
  }
});

for(const race of ['edit','control','checkpoint'])test(`a ${race} race between clean review and the transaction keeps the fence and all data`,async()=>{
  const {db,journal}=await fixture(),clear=db.clearControl;
  db.clearControl=async(...args)=>{
    if(race==='edit')await journal.append(change('newer edit')).committed;
    if(race==='control')await journal.setCloudControl({conflict:{...conflict,kind:'entity-conflict'}});
    if(race==='checkpoint')await journal.replaceCurrentState({...clone(initial),setting:2});
    return clear(...args);
  };
  await assert.rejects(journal.clearCloudControl(review),/storage_control_head_changed/);
  const cloud=await journal.cloudState(),recovered=await journal.recover();
  assert.ok(cloud.control?.conflict);
  if(race==='edit'){assert.equal(cloud.pending,true);assert.equal(recovered.state.notes[0].content,'newer edit')}
  if(race==='control')assert.equal(cloud.control.conflict.kind,'entity-conflict');
  if(race==='checkpoint')assert.equal(recovered.state.setting,2);
});

test('a Finance checkpoint captured before a newer local edit cannot overwrite its sequence',async()=>{
  const {journal}=await fixture();
  await journal.append(change('newer local edit')).committed;
  await assert.rejects(journal.replaceCurrentState(initial,{expectedSeq:0}),/storage_checkpoint_stale/);
  assert.equal((await journal.recover()).state.notes[0].content,'newer local edit');
  assert.equal((await journal.cloudState()).pending,true);
});
