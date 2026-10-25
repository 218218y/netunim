import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

test('a missing recovery checkpoint cannot be promoted by cached readiness',async()=>{
  const db=memoryDb(),journal=createStorageJournal({owner:'A:orders',schema:{collections:['notes']},validate:()=>{},db,emergency:emergencyStore()});
  await journal.install({notes:[]});
  const read=db.load,before=await read();
  db.load=async()=>({...await read(),checkpoints:null});
  assert.equal(await journal.recover(),null);
  await assert.rejects(journal.compact(),/storage_checkpoint_missing/);
  assert.deepEqual(await read(),before);
});

test('local replacement cannot derive deletion authority from malformed collection identities',async()=>{
  for(const row of [null,{},[],{id:1},{id:''}]){
    const db=memoryDb(),journal=createStorageJournal({owner:'A:orders',schema:{collections:['notes']},validate:()=>{},db,emergency:emergencyStore()});
    await journal.initializeCloudHead(1,{notes:[row]});
    const before=await db.load();
    await assert.rejects(journal.replaceLocalWithPending({notes:[]},{boundaryId:'B',expectedSeq:0,expectedBaseRevision:1}),/storage_boundary_collection_invalid/);
    assert.deepEqual(await db.load(),before);
  }
});
