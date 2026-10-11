import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';
import {readStorageRecord} from '../shared/storage-journal-model.js';

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
test('a queued old-epoch control cannot attach to the newly committed reset epoch',async()=>{
  const db=memoryDb(),entered=deferred(),release=deferred();
  const state={notes:[{id:'kept',content:'original'}]},runtime=createStorageV2Runtime({app:'orders',owner:()=> 'control-owner',primary:()=>true,mode:()=> 'primary',validate:()=>{},createJournal:options=>createStorageJournal({...options,db,emergency:emergencyStore()})});
  await runtime.initializeCloudHead(10,state,{sourceOwner:'control-owner',intent:'cloud-authoritative'});
  const oldScope=runtime.cloudScope;
  db.resetCloudHead=async(owner,epoch,writer,checkpoint,base)=>{
    entered.resolve();await release.promise;
    await db.resetState(owner,epoch,writer,checkpoint);
    await db.setBase(owner,readStorageRecord(checkpoint).epoch,writer,base);
  };
  const resetting=runtime.resetCloudHead(3,state,state,{appMetadata:{storageRole:'primary'}});await entered.promise;
  const control=runtime.setCloudControl({retry:{attempts:1,lastErrorCode:'old-error'}},{expectedScope:oldScope});
  release.resolve();await resetting;
  await assert.rejects(control,{code:'storage_cloud_scope_changed'});
  const head=await runtime.cloudState(),recovered=await runtime.recover();
  assert.ok(recovered,JSON.stringify(runtime.diagnostics));
  assert.notEqual(head.base.epoch,oldScope.epoch);assert.equal(head.control,null);assert.equal(head.base.revision,3);
  assert.deepEqual(recovered.state,state);assert.equal(head.pending,false);
});
test('a same-storage-identity control still requires live login authorization',async()=>{
  const db=memoryDb(),runtime=createStorageV2Runtime({app:'orders',owner:()=> 'control-owner',primary:()=>true,mode:()=> 'primary',validate:()=>{},createJournal:options=>createStorageJournal({...options,db,emergency:emergencyStore()})});
  await runtime.initializeCloudHead(10,{notes:[]},{sourceOwner:'control-owner',intent:'cloud-authoritative'});
  const before=await db.load();
  await assert.rejects(runtime.setCloudControl({retry:{attempts:1}},{expectedScope:runtime.cloudScope,isCurrent:()=>false}),{code:'storage_cloud_scope_changed'});
  assert.deepEqual(await db.load(),before);
});
