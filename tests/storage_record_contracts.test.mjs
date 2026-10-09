import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStorageJournal} from '../shared/storage-journal.js';
import {readStorageRecord,sealStorageRecord} from '../shared/storage-journal-model.js';
import {createStorageCheckpoint} from '../shared/storage-records.js';
import {assertStorageCloudAck} from '../shared/storage-cloud-ack.js';
import {storageWriterScenario} from './storage-record-fixture.mjs';
import {emergencyStore} from './storage-v2-fixture.mjs';

const golden=JSON.parse(readFileSync(new URL('./fixtures/storage-v2-writer-records.json',import.meta.url),'utf8'));

test('production writers preserve pre-refactor sealed bytes/checksums through pending, ACK and rebase',async()=>{
  const {snapshots}=await storageWriterScenario(createStorageJournal);
  assert.equal(JSON.stringify(snapshots),JSON.stringify(golden.snapshots));
  const pending=snapshots.newerPending,ack=snapshots.acknowledged;
  assert.equal(readStorageRecord(ack.bases).ackSeq,2);
  assert.equal(ack.metadata.seq,3);
  assert.equal(ack.journal.length,pending.journal.length,'ACK must not compact the journal');
  assert.equal(readStorageRecord(pending.flights).snapshot.notes[0].text,'sent');
  assert.equal(readStorageRecord(ack.checkpoints).state.notes[0].text,'newer pending');
  assert.deepEqual(snapshots.compactedAcknowledged.journal.map(row=>row.data.seq),[3]);
});

test('unchanged historical readers recover the pre-refactor checkpoint and journal without changing IDs',async()=>{
  const {schema,validate}=await storageWriterScenario(createStorageJournal);
  // A fresh runtime reads baseline bytes, not records rebuilt by the new writer.
  for(const [name,stored] of Object.entries(golden.snapshots)){
    const db={load:async()=>structuredClone(stored),claim:async()=>{}};
    const journal=createStorageJournal({owner:'writer-contract',schema,validate,db,emergency:emergencyStore()});
    const recovered=await journal.recover();
    const expected=name==='initialized'?[{id:'N',text:'original'}]:
      name==='rebased'?[{id:'N',text:'newer pending'},{id:'M',text:'inserted'},{id:'R',text:'other device'}]:
      ['newerPending','acknowledged','compactedAcknowledged'].includes(name)?[{id:'N',text:'newer pending'},{id:'M',text:'inserted'}]:
      [{id:'N',text:'sent'},{id:'M',text:'inserted'}];
    assert.deepEqual(recovered.state.notes,expected,name);
  }
});

test('unchecked writer inputs still fail existing JSON sealing rather than receive sanitizing defaults',()=>{
  for(const state of [{notes:[],callback:()=>{}},{notes:[],date:new Date()},
    {notes:[],map:new Map()}, {notes:[],missing:undefined},{notes:[],counter:Infinity}]){
    const value=createStorageCheckpoint({owner:'account',epoch:'epoch',seq:0,state,appMetadata:{},savedAt:'stamp'});
    assert.throws(()=>sealStorageRecord(value),/^Error: storage_non_json_value$/);
  }
});

const scope={owner:'account:kupa',epoch:'epoch-a'},flight={baseRevision:7,endSeq:3};
const ack={...scope,revision:8,ackSeq:3};
for(const [label,patch] of [
  ['owner',{owner:'account:orders'}],['epoch',{epoch:'epoch-b'}],
  ['regressed revision',{revision:6}],['string revision',{revision:'8'}],
  ['fractional revision',{revision:8.5}],['unsafe revision',{revision:Number.MAX_SAFE_INTEGER+1}],
  ['nonfinite revision',{revision:Infinity}],['NaN revision',{revision:NaN}],
  ['short ACK',{ackSeq:2}],['ACK includes newer pending',{ackSeq:4}],['string ACK',{ackSeq:'3'}],
])test(`durable ACK rejects ${label} and cannot change its evidence`,()=>{
  const input=Object.freeze({...ack,...patch}),immutableFlight=Object.freeze({...flight}),immutableScope=Object.freeze({...scope});
  assert.throws(()=>assertStorageCloudAck(input,immutableFlight,immutableScope),/^Error: storage_ack_revision$/);
  assert.deepEqual(input,{...ack,...patch});
});

test('idempotent no-op and advancing revisions ACK exactly the captured flight range',()=>{
  for(const revision of [flight.baseRevision,8,Number.MAX_SAFE_INTEGER]){
    assert.doesNotThrow(()=>assertStorageCloudAck(Object.freeze({...ack,revision}),Object.freeze(flight),Object.freeze(scope)));
  }
});
