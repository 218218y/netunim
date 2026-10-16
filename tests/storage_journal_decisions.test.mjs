import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as decisions from '../shared/storage-journal-authority.js';
import {declaration} from './bank_policy_ast_fixture.mjs';
const scope={owner:'A:orders',epoch:'E',seq:3};
const checkpoint={owner:scope.owner,epoch:scope.epoch,seq:0};
const base={owner:scope.owner,epoch:scope.epoch,revision:2,ackSeq:0};
const head={...checkpoint,seq:3};
const cursor={...base,ackSeq:3};

test('install retains epoch, pending-flight and owner rejection priority',()=>{
  const install=decisions.assertStorageJournalInstall;
  assert.throws(()=>install('A:orders',{...checkpoint,owner:'B:orders'},'B','E',true),/storage_checkpoint_race/);
  assert.throws(()=>install('A:orders',{...checkpoint,owner:'B:orders'},'E','E',true),/storage_restore_flight_pending/);
  assert.throws(()=>install('A:orders',{...checkpoint,owner:'B:orders'},'E','E',false),/storage_owner_mismatch/);
  install('A:orders',checkpoint,null,null,false);
});
test('initialization cannot grant a cursor or operation outside the new zero head',()=>{
  const initialize=(cp=checkpoint,b=base,entry=null)=>decisions.assertStorageJournalInitialization(scope.owner,cp,b,entry);
  initialize();initialize(checkpoint,base,{...checkpoint,seq:1});
  for(const cp of [{...checkpoint,owner:'B:orders'},{...checkpoint,seq:1}])assert.throws(()=>initialize(cp),/storage_initialization_invalid/);
  for(const b of [{...base,owner:'B:orders'},{...base,epoch:'B'},{...base,ackSeq:1},{...base,revision:-1}])assert.throws(()=>initialize(checkpoint,b),/storage_initialization_invalid/);
  for(const entry of [{...checkpoint,seq:0},{...head,owner:'B:orders'},{...head,epoch:'B'}])assert.throws(()=>initialize(checkpoint,base,entry),/storage_initialization_invalid/);
});
test('compaction only retires operations covered by both the checkpoint and durable ACK',()=>{
  const cp={...head,seq:2};
  assert.equal(decisions.storageJournalCompactionThrough(scope,cp,0,1),1);
  assert.equal(decisions.storageJournalCompactionThrough(scope,cp,0,0),0);
  assert.equal(decisions.storageJournalCompactionThrough(scope,cp,0,null),2);
  for(const bad of [{...cp,owner:'B:orders'},{...cp,epoch:'B'},{...cp,seq:0},{...cp,seq:4}]){
    assert.throws(()=>decisions.storageJournalCompactionThrough(scope,bad,1,0),/storage_compaction_range/);
  }
});
test('ACK checkpoint rejection retains the diagnostic sequence and does not authorize a stale head',()=>{
  decisions.assertStorageJournalAckCheckpoint(scope,head);
  for(const bad of [{...head,seq:2},{...head,owner:'B:orders'},{...head,epoch:'B'}]){
    assert.throws(()=>decisions.assertStorageJournalAckCheckpoint(scope,bad),error=>{
      assert.equal(error.message,'storage_checkpoint_stale');assert.equal(error.code,'storage_ack_checkpoint_stale');
      assert.equal(error.candidateSeq,bad.seq);assert.equal(error.observedSeq,3);return true;
    });
  }
});
test('cloud adoption requires a fully ACKed clean local head and a nonregressing cloud revision',()=>{
  const adopt=(cp=head,b=cursor,prior=cursor,conflict=false)=>decisions.assertStorageJournalAdoption(scope,cp,b,prior,conflict);
  adopt();adopt(head,{...cursor,revision:3});
  for(const prior of [null,{...cursor,ackSeq:2}])assert.throws(()=>adopt(head,cursor,prior),/storage_cloud_pending/);
  assert.throws(()=>adopt(head,cursor,cursor,true),/storage_cloud_pending/);
  assert.throws(()=>adopt({...head,seq:2}),/storage_checkpoint_stale/);
  for(const b of [{...cursor,owner:'B:orders'},{...cursor,epoch:'B'},{...cursor,ackSeq:2},{...cursor,revision:1}]){
    assert.throws(()=>adopt(head,b),/storage_cloud_base_mismatch/);
  }
});
test('cloud reset can install a new epoch only as a paired zero checkpoint and zero ACK',()=>{
  decisions.assertStorageJournalCloudReset(scope.owner,{...checkpoint,epoch:'NEW'},{...base,epoch:'NEW'});
  for(const [cp,b] of [[{...checkpoint,seq:1},base],[checkpoint,{...base,ackSeq:1}],
    [checkpoint,{...base,epoch:'B'}],[{...checkpoint,owner:'B:orders'},base],[checkpoint,{...base,owner:'B:orders'}]]){
    assert.throws(()=>decisions.assertStorageJournalCloudReset(scope.owner,cp,b),/storage_cloud_reset_invalid/);
  }
});

test('actual decision mutations expose six distinct authority violations that the original guards reject',async()=>{
  const original=fs.readFileSync('shared/storage-journal-authority.js','utf8');
  const cases=[
    ['assertStorageJournalInstall','observedEpoch!==expectedEpoch',fn=>fn(scope.owner,checkpoint,'B','E',false)],
    ['assertStorageJournalInitialization','base.ackSeq!==0',fn=>fn(scope.owner,checkpoint,{...base,ackSeq:1},null)],
    ['storageJournalCompactionThrough','checkpoint.seq>scope.seq',fn=>fn(scope,{...head,seq:4},0,null)],
    ['assertStorageJournalAckCheckpoint','checkpoint.seq!==scope.seq',fn=>fn(scope,{...head,seq:2})],
    ['assertStorageJournalAdoption','base.revision<prior.revision',fn=>fn(scope,head,{...cursor,revision:1},cursor,false)],
    ['assertStorageJournalCloudReset','base.ackSeq!==0',fn=>fn(scope.owner,checkpoint,{...base,ackSeq:1})],
  ];
  for(const [name,condition,invoke] of cases){
    assert.throws(()=>invoke(decisions[name]),name);
    const node=declaration(original,name),body=original.slice(node.start,node.end);
    assert.ok(body.includes(condition));
    let changed=original.slice(0,node.start)+body.replace(condition,'false')+original.slice(node.end);
    changed=changed.replaceAll(/(['"])\.\/(.*?)\1/g,(_,quote,file)=>JSON.stringify(new URL('../shared/'+file,import.meta.url).href));
    const mutant=await import('data:text/javascript;base64,'+Buffer.from(changed).toString('base64'));
    assert.doesNotThrow(()=>invoke(mutant[name]),name);
  }
});

test('each actual IDB transaction invokes its checked decision before its first durable write',()=>{
  const source=fs.readFileSync('shared/storage-journal-idb.js','utf8');
  for(const [method,helper] of [['install','assertStorageJournalInstall'],['initializeCloudHead','assertStorageJournalInitialization'],
    ['compact','storageJournalCompactionThrough'],['acknowledge','assertStorageJournalAckCheckpoint'],
    ['adoptCloudHead','assertStorageJournalAdoption'],['resetCloudHead','assertStorageJournalCloudReset']]){
    const node=declaration(source,method),body=source.slice(node.start,node.end);
    assert.ok(body.indexOf(helper+'(')>=0,method);
    assert.ok(body.indexOf(helper+'(')<body.indexOf('.put('),method);
  }
});
