import test from 'node:test';
import assert from 'node:assert/strict';
import {sealStorageRecord,replayStorageJournal} from '../shared/storage-journal-model.js';
import {readStorageCheckpoint} from '../shared/storage-checkpoint.js';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const schema={collections:['notes'],fields:['setting']};
const checkpoint={version:2,owner:'account:kupa',epoch:'epoch',seq:0,state:{notes:[{id:'N',text:'retained'}],setting:1},appMetadata:{storageRole:'primary'},savedAt:'stamp'};

for(const [label,state] of [['array',[]],['string','state'],['number',1],['boolean',true]]){
  test(`recovery rejects a checksum-valid ${label} checkpoint state`,()=>{
    const sealed=sealStorageRecord({...checkpoint,state}),before=structuredClone(sealed);
    assert.throws(()=>replayStorageJournal(sealed,[],schema),/^Error: storage_invalid_checkpoint$/);
    assert.deepEqual(sealed,before,'a rejected checkpoint remains available for recovery/diagnostics');
  });
}

for(const [label,patch] of [
  ['old version',{version:1}],['missing version',{version:undefined}],
  ['empty owner',{owner:''}],['numeric owner',{owner:1}],['oversized owner',{owner:'x'.repeat(513)}],
  ['empty epoch',{epoch:''}],['numeric epoch',{epoch:1}],['oversized epoch',{epoch:'x'.repeat(513)}],
  ['string sequence',{seq:'0'}],['negative sequence',{seq:-1}],
  ['fractional sequence',{seq:0.5}],['unsafe sequence',{seq:Number.MAX_SAFE_INTEGER+1}],
  ['missing state',{state:undefined}],['null state',{state:null}],
])test(`checkpoint decoder rejects ${label} without coercion`,()=>{
  const data={...checkpoint,...patch};for(const key of Object.keys(data))if(data[key]===undefined)delete data[key];
  assert.throws(()=>readStorageCheckpoint(sealStorageRecord(data)),/^Error: storage_invalid_checkpoint$/);
});

test('checkpoint decoding retains historical missing/null metadata and missing timestamp without rewriting',()=>{
  for(const appMetadata of [undefined,null,{}]){
    const historical={...checkpoint};delete historical.savedAt;
    if(appMetadata===undefined)delete historical.appMetadata;else historical.appMetadata=appMetadata;
    const sealed=sealStorageRecord(historical),decoded=readStorageCheckpoint(sealed);
    assert.deepEqual(decoded,historical);assert.equal(Object.hasOwn(decoded,'savedAt'),false);
    assert.equal(Object.hasOwn(decoded,'appMetadata'),appMetadata!==undefined);
    assert.deepEqual(replayStorageJournal(sealed,[],schema).state,checkpoint.state);
    decoded.state.notes[0].text='detached';assert.equal(sealed.data.state.notes[0].text,'retained');
  }
});

test('historical checkpoint replay, append, compaction and fresh recovery retain note identity/content',async()=>{
  const historical={...checkpoint};delete historical.appMetadata;delete historical.savedAt;
  const db=memoryDb();await db.install(checkpoint.owner,sealStorageRecord(historical),'old-writer');
  const make=()=>createStorageJournal({owner:checkpoint.owner,schema,db,emergency:emergencyStore(),validate:state=>assert.equal(state.notes[0].id,'N')});
  let journal=make();await journal.open();
  await journal.append([{type:'put',collection:'notes',mode:'replace',id:'N',record:{id:'N',text:'after restart'}}]).committed;
  await journal.compact();journal=make();const recovered=await journal.open();
  assert.equal(recovered.seq,1);assert.deepEqual(recovered.state.notes,[{id:'N',text:'after restart'}]);
});

for(const [label,appMetadata] of [['array',[]],['string','primary'],['number',1],['boolean',true]]){
  test(`recovery rejects checksum-valid ${label} checkpoint metadata`,()=>{
    const sealed=sealStorageRecord({...checkpoint,appMetadata});
    assert.throws(()=>replayStorageJournal(sealed,[],schema),/^Error: storage_invalid_checkpoint$/);
  });
}
