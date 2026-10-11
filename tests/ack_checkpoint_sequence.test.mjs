import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';
import {createStorageBrowser as ordersBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {createStorageBrowser as kupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {INITIAL_STATE as ordersState} from '../netunim-orders/site/assets/js/state/constants.js';
import {INITIAL_STATE as kupaState} from '../netunim-kupa/site/assets/js/state/constants.js';

const clone=structuredClone;
const cloud=value=>{const next=clone(value);delete next.checks;return next};
async function fixture(app){
  const db=memoryDb(),emergency=emergencyStore(),model={state:clone(app==='orders'?ordersState:kupaState)},session={localGeneration:0,cloudRevision:5,dbRevision:5},files={};
  const runtime=createStorageV2Runtime({app,owner:()=> 'ack-account',primary:()=>true,mode:()=> 'primary',validate:value=>assert.ok(Array.isArray(value.notes)),createJournal:options=>createStorageJournal({...options,db,emergency})});
  await runtime.initializeCloudHead(5,model.state,{sourceOwner:'ack-account',intent:'cloud-authoritative',cloudState:cloud(model.state)});
  assert.ok(await runtime.recover());
  const browser=(app==='orders'?ordersBrowser:kupaBrowser)({storageV2:runtime,model,session,files,normalizeState:clone,prepareCloudState:cloud,prepareKupaCloudState:cloud});
  await browser.refreshStorageV2CloudState();
  async function edit(content){
    model.state.notes=[{id:'same-note',content,createdAt:'2026-10-11',updatedAt:'2026-10-11'}];session.localGeneration++;
    const options={operations:[{type:'put',collection:'notes',mode:session.localGeneration===1?'insert':'replace',index:0,id:'same-note',record:clone(model.state.notes[0])}],generation:session.localGeneration};
    if(app==='orders')browser.localSnapshot(model.state,options);else browser.persistImmediateBrowserSnapshot(model.state,5,options);
    await files.storageV2CommitPromise;
  }
  return {db,runtime,browser,model,edit};
}

for(const app of ['orders','kupa'])test(`${app}: ACK candidate sequence remains bound after the browser cache advances`,async()=>{
  const f=await fixture(app);await f.edit('flight-A');
  const flight=await f.browser.materializeStorageV2CloudFlight(),head=await f.browser.refreshStorageV2CloudState(),candidate=clone(f.model.state);
  assert.equal(head.seq,1);
  await f.edit('late-B');
  const before=await f.db.load();
  await assert.rejects(f.browser.acknowledgeStorageV2CloudFlight(flight.operationId,6,flight.snapshot,{currentState:candidate,expectedSeq:head.seq}),error=>{
    assert.equal(error.code,'storage_ack_checkpoint_stale');assert.equal(error.candidateSeq,1);assert.equal(error.observedSeq,2);return true;
  });
  assert.deepEqual(await f.db.load(),before,'a rejected checkpoint must leave all raw records unchanged');
  assert.equal((await f.runtime.recover()).state.notes[0].content,'late-B');
  const retained=await f.browser.refreshStorageV2CloudState();assert.deepEqual(retained.flight,flight);assert.equal(retained.pending,true);assert.equal(retained.base.ackSeq,0);
  await f.browser.acknowledgeStorageV2CloudFlight(flight.operationId,6,flight.snapshot,{currentState:clone(f.model.state),expectedSeq:retained.seq});
  const recovered=await f.runtime.recover();assert.equal(recovered.state.notes[0].id,'same-note');assert.equal(recovered.state.notes[0].content,'late-B');
  const acknowledged=await f.browser.refreshStorageV2CloudState();assert.equal(acknowledged.base.ackSeq,1);assert.equal(acknowledged.seq,2);assert.equal(acknowledged.pending,true);assert.equal(acknowledged.flight,null);
});

for(const app of ['orders','kupa'])test(`${app}: a checkpoint ACK requires an explicit valid sequence and preserves the cursor-only contract`,async()=>{
  const f=await fixture(app);await f.edit('flight-A');const flight=await f.browser.materializeStorageV2CloudFlight(),before=await f.db.load();
  for(const expectedSeq of [undefined,null,-1,1.5,NaN,Infinity,'1',Number.MAX_SAFE_INTEGER+1]){
    await assert.rejects(f.runtime.acknowledgeFlight(flight.operationId,6,flight.snapshot,{currentState:clone(f.model.state),expectedSeq}),{message:'storage_ack_checkpoint_required',code:'storage_ack_checkpoint_required'});
    assert.deepEqual(await f.db.load(),before);
  }
  // Detached owner-transfer consumers ACK only the flight cursor, without a
  // reconciled checkpoint; they must not acquire a fake candidate sequence.
  await f.runtime.acknowledgeFlight(flight.operationId,5,flight.snapshot);
  assert.equal((await f.runtime.recover()).state.notes[0].content,'flight-A');
  const head=await f.browser.refreshStorageV2CloudState();assert.equal(head.base.revision,5);assert.equal(head.base.ackSeq,1);assert.equal(head.pending,false);
});
