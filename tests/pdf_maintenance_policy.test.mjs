import test from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceFixture,plain,workRow} from './pdf_maintenance_fixture.mjs';
test('720 original/current maintenance scenarios retain limits, extraction/retry/cancellation, journals, checkpoints and logs',async()=>{
 let cases=0;
 for(const force of [false,true])for(const maxChanged of [0,1,2,Infinity])for(const maxMs of [0,1])for(const outcome of ['form','noform','error','password','abort'])for(const retry of ['none','same','changed'])for(const state of ['due','not-due','failed']){
  const metadata=state==='not-due'?{lastResult:{pending:0},lastSuccessfulAt:'2026-10-15T11:59:00Z'}:state==='failed'?{lastFailureAt:'2026-10-15T11:59:00Z',lastFailure:'previous'}:{};
  const row=workRow(1),entries=retry==='none'?[]:[[row.fullPath.toLowerCase(),{...row,fingerprint:retry==='same'?row.fingerprint:'different',failed:true,retryCount:2}]];
  const options={outcome,metadata,entries,extractMs:2},old=maintenanceFixture('baseline',options),current=maintenanceFixture('current',options);
  const args={force,maxChanged,maxMs,reason:'manual'};
  assert.deepEqual(plain(await current.owner.refresh(args)),plain(await old.owner.refresh(args)),JSON.stringify({force,maxChanged,maxMs,outcome,retry,state}));
  assert.deepEqual(current.observation(),old.observation());assert.equal(current.timers.size,0);await current.owner.dispose();cases++;
 }
 assert.equal(cases,720);
});
test('stopped snapshot and inventory/journal failures preserve single-command results and failure metadata',async()=>{
 for(const mode of ['stopped','inventory','journal','compact']){
  const fault=()=>{throw Object.assign(new Error('synthetic disk failure'),{code:'EIO'})};
  const options=mode==='stopped'?{stopping:true}:mode==='inventory'?{rebuild:fault}:mode==='compact'?{compact:fault}:{append:fault};
  const old=maintenanceFixture('baseline',options),current=maintenanceFixture('current',options);
  async function observe(f){try{return{result:plain(await f.owner.refresh({force:true}))}}catch(error){return{error:{code:error.code,message:error.message}}}}
  assert.deepEqual(await observe(current),await observe(old));assert.deepEqual(current.observation(),old.observation());await current.owner.dispose();
 }
});
