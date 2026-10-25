import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2Runtime,storageRecoveryFailure} from '../shared/storage-v2-runtime.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({compactEvery=2}={}){
  let owner='A';const tasks=[],journals=[],compacted=[];
  const runtime=createStorageV2Runtime({app:'orders',owner:()=>owner,primary:()=>true,mode:()=> 'primary',validate:()=>{},compactEvery,compactAfterMs:Infinity,
    scheduleIdle:callback=>tasks.push(callback),createJournal:({owner})=>{
      const journal={owner,ready:true,epoch:'epoch-'+journals.length,seq:0,error:null,
        open:async()=>({state:{notes:[]},epoch:journal.epoch,seq:journal.seq,appMetadata:{storageRole:'primary'}}),
        append:()=>({seq:++journal.seq,emergencyDurable:true,committed:journal.commit||Promise.resolve(true)}),
        compact:async()=>{compacted.push(owner);return journal.seq},settled:async()=>{},
      };journals.push(journal);return journal;
    }});
  const persist=()=>runtime.persist({notes:[]},{operations:[{type:'set',field:'settings',value:{}}]});
  return {runtime,tasks,journals,compacted,persist,owner:value=>{owner=value}};
}

for(const message of ['storage_invalid_collection_record','storage_journal_metadata_invalid','storage_journal_invalid','storage_journal_payload_invalid']){
  test(message+' permanently blocks recovery without reopening or granting authority',async()=>{
    let calls=0;
    const runtime=createStorageV2Runtime({app:'orders',owner:()=> 'A',primary:()=>true,mode:()=> 'primary',validate:()=>{},
      createJournal:()=>({ready:false,open:async()=>{calls++;throw new Error(message)}})});
    assert.equal(storageRecoveryFailure(new Error(message)),'fatal');
    assert.equal(await runtime.recover(),null);assert.equal(await runtime.recover(),null);
    assert.equal(calls,1);assert.equal(runtime.primaryReady,false);assert.equal(runtime.cloudScope,null);
    assert.equal(runtime.persist({},{}).handled,false);
  });
}
test('temporary IDB, writer and command preconditions remain retryable',()=>{
  for(const message of ['storage_writer_fenced','storage_epoch_changed','storage_secondary_tab','storage_cloud_scope_changed','storage_cloud_recovery_stale','storage_boundary_in_progress','storage_ack_mismatch','storage_future_error'])assert.equal(storageRecoveryFailure(new Error(message)),'retryable');
  for(const name of ['AbortError','QuotaExceededError','InvalidStateError','UnknownError'])assert.equal(storageRecoveryFailure(Object.assign(new Error('temporary'),{name})),'retryable');
});

for(const phase of ['queued','commit','epoch'])test('compaction cannot cross its '+phase+' boundary',async()=>{
  const f=fixture({compactEvery:1});await f.runtime.recover();const a=f.journals[0],hold=deferred();a.commit=hold.promise;f.persist();
  const old=phase==='queued'?null:f.tasks.shift()();await tick();
  if(phase==='epoch'){a.epoch='replacement';hold.resolve(true);await old;assert.deepEqual(f.compacted,[]);return}
  f.owner('B');await f.runtime.recover();f.persist();
  if(phase==='queued')await f.tasks.shift()();
  hold.resolve(true);if(old)await old;
  assert.deepEqual(f.compacted,[],'old task must not compact either journal');
  assert.equal(f.tasks.length,1,'old task must not clear the new scheduled token');
  await f.tasks.shift()();assert.deepEqual(f.compacted,['B:orders']);
});

for(const method of ['compact','replaceCurrentState','replaceLocalAuthoritativeState','adoptCloudHead','replaceAuthoritativeState','resetCloudHead','replaceLocalWithPending'])test(method+' completion cannot reset another owner maintenance',async()=>{
  const f=fixture();if(method==='replaceLocalAuthoritativeState')f.owner('local');
  await f.runtime.recover();const a=f.journals[0],hold=deferred();a[method]=()=>hold.promise;
  const args=method==='compact'?[]:['adoptCloudHead','resetCloudHead'].includes(method)?[1,{},{},{}]:[{},{}];
  const pending=f.runtime[method](...args);await tick();
  f.owner('B');await f.runtime.recover();f.persist();
  hold.resolve(['compact','replaceCurrentState'].includes(method)?0:{seq:0,epoch:a.epoch});await pending;
  f.persist();assert.equal(f.tasks.length,1,'B still has two uncheckpointed writes');
  await f.tasks.shift()();assert.deepEqual(f.compacted,['B:orders']);
});

test('writes admitted while a checkpoint waits still count toward the next checkpoint',async()=>{
  const f=fixture();await f.runtime.recover();const active=f.journals[0],hold=deferred();active.replaceCurrentState=()=>hold.promise;
  const pending=f.runtime.replaceCurrentState({});await tick();f.persist();hold.resolve(0);await pending;
  f.persist();assert.equal(f.tasks.length,1);
});

for(const failure of [false,true])test('old recovery '+(failure?'failure':'success')+' cannot change a replacement journal authority',async()=>{
  const f=fixture();await f.runtime.recover();const a=f.journals[0],hold=deferred();a.open=()=>hold.promise;
  const pending=f.runtime.recover();await tick();f.owner('B');await f.runtime.recover();f.owner('A');await f.runtime.recover();
  const before={...f.runtime.diagnostics};
  if(failure)hold.reject(new Error('storage_journal_metadata_invalid'));else hold.resolve({seq:99,appMetadata:{storageRole:'primary'}});
  assert.equal(await pending,null);assert.equal(f.runtime.primaryReady,true);assert.deepEqual(f.runtime.diagnostics,before);
});

test('flush cannot confirm another owner after the journal settles',async()=>{
  const f=fixture();await f.runtime.recover();const hold=deferred();f.journals[0].settled=()=>hold.promise;
  const pending=f.runtime.flush();await tick();f.owner('B');await f.runtime.recover();hold.resolve();assert.equal(await pending,false);
});
