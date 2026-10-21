import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoragePersistence} from './kupa_persistence_ports.mjs';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';

const noop=()=>{},tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
test('Kupa Main rejects invariants before journal submission and marks the optimistic draft',async()=>{
  const model={state:{}},normalization=createStateNormalization({model});model.state=normalization.normalizeState({notes:[{id:'N',content:'retained'}]});
  model.state.notes.push({...model.state.notes[0]});const session={localGeneration:0};let submitted=false;
  const api=createStoragePersistence({...normalization,model,session,tab:{primaryTab:true},storageV2Primary:()=>true,
    persistImmediateBrowserSnapshot:()=>{submitted=true;return true},setSaveStatus:noop,setCloudHeaderStatus:noop});
  assert.equal(await api.saveState('invalid'),false);
  assert.equal(submitted,false);assert.equal(session.localGeneration,1);assert.equal(api.runtime.isPending(),false);
  assert.ok(session.localUndurableGenerations.has('failed:proposal:1'));
});
test('Kupa Main drain covers accepted fast saves before their deferred cloud work starts',async t=>{
  const model={state:{}},normalization=createStateNormalization({model});model.state=normalization.normalizeState({notes:[{id:'N',content:'retained'}]});
  const session={connectionMode:'supabase',backendReady:true,localGeneration:0,dbRevision:1},jobs=[],entered=gate(),release=gate(),writes=[];
  t.mock.method(globalThis,'setTimeout',run=>{jobs.push(run);return jobs.length});
  const api=createStoragePersistence({...normalization,model,session,tab:{primaryTab:true},files:{},checksSession:{},
    storageV2Primary:()=>true,persistImmediateBrowserSnapshot:()=>true,storageV2CommitPromise:()=>Promise.resolve(true),
    refreshStorageV2CloudState:async()=>({base:{}}),setSaveStatus:noop,setCloudHeaderStatus:noop,
    persistSupabaseState:async(_snapshot,message)=>{writes.push(message);entered.resolve();await release.promise;return true}});
  const options={domains:['notes'],operations:[{type:'put',collection:'notes',id:'N',mode:'replace',record:{id:'N',content:'retained'}}]};
  const first=api.saveState('first',options),second=api.saveState('second',options);
  assert.equal(jobs.length,2);assert.equal(api.runtime.isPending(),true);assert.equal(Object.hasOwn(session,'saveQueue'),false);
  let drained=false;const drain=api.runtime.drain().then(()=>{drained=true});await tick();assert.equal(drained,false);
  jobs[0]();await entered.promise;jobs[1]();await tick();assert.equal(drained,false);
  api.runtime.dispose();assert.equal(await api.saveState('closed',options),false);
  release.resolve();assert.deepEqual(await Promise.all([first,second]),[true,true]);await drain;
  assert.deepEqual(writes,['first','second']);assert.equal(api.runtime.isPending(),false);
  assert.equal(Object.hasOwn(session,'cloudSavePromise'),false);
  assert.equal(model.state.notes[0].content,'retained');
});
