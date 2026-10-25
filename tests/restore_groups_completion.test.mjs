import test from 'node:test';
import assert from 'node:assert/strict';
import {createRestoreGroup,assertRestoreGroup,createRestoreGroupStore,executeRestoreGroup} from '../shared/restore-groups.js';

function fixture(){
  const data=new Map(),local=new Map();
  const storage={getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)};
  const store=createRestoreGroupStore({localKey:'restore',now:()=>0,storage,put:async(key,value)=>{data.set(key,structuredClone(value))},get:async key=>structuredClone(data.get(key)),remove:async key=>{data.delete(key)}});
  return {store,data,local};
}
const group=()=>createRestoreGroup({appSite:'orders',restoreGroupId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',now:0,main:{state:{notes:[]},baseRevision:1},checks:{state:{checks:[]},baseRevision:2}});

test('restore cannot apply or complete before the remote receipt and local adoption both settle',async()=>{
  const {store}=fixture(),input=await group(),receipt={main_revision:2,checks_revision:3};
  let releaseRemote,releaseLocal,enteredRemote,enteredLocal;
  const remoteEntered=new Promise(resolve=>{enteredRemote=resolve}),localEntered=new Promise(resolve=>{enteredLocal=resolve});
  const remote=new Promise(resolve=>{releaseRemote=resolve}),local=new Promise(resolve=>{releaseLocal=resolve});
  let settled=false;
  const running=executeRestoreGroup(input,{store,stageRemote:async()=>{},applyRemote:()=>{enteredRemote();return remote},onApplied:async(_group,result)=>{assert.equal(result,receipt);enteredLocal();await local}}).then(result=>{settled=true;return result});
  await remoteEntered;
  assert.equal((await store.loadPending()).phase,'applying');assert.equal(settled,false);
  releaseRemote(receipt);await localEntered;
  assert.equal((await store.loadPending()).phase,'applying');assert.equal(settled,false);
  releaseLocal();assert.equal((await running).group.phase,'completed');assert.equal(await store.loadPending(),null);
});

test('legacy restore validation preserves coercible revision evidence and rejects malformed durable input without replacing it',async()=>{
  const input=await group();input.main.baseRevision='1';input.mutationSeq='1';
  assert.equal(assertRestoreGroup(input),input);assert.equal(input.main.baseRevision,'1');
  const {store,data,local}=fixture();await store.stage(input);
  assert.equal((await store.loadPending()).main.baseRevision,'1');
  const invalid={...input,phase:'verified'};data.set('restore:current',invalid);local.set('restore',JSON.stringify(invalid));
  await assert.rejects(store.loadPending(),/invalid_restore_group_record/);
  assert.deepEqual(data.get('restore:current'),invalid);assert.equal(local.get('restore'),JSON.stringify(invalid));
});
