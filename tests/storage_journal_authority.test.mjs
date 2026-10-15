import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {captureStorageJournalOperation as capture} from '../shared/storage-journal-authority.js';
import {sealStorageJsonRecord as seal} from '../shared/storage-json-codec.js';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const operation=(owner='A:orders')=>({version:2,owner,epoch:'E',seq:1,generation:0,operationId:'OP',at:'T',changes:[{type:'put',collection:'notes',id:'N',mode:'insert',index:0,record:{id:'N',text:'accepted'}}]});

for(const domain of ['orders','kupa','shared-checks'])test(domain+' IDB authority validates its business operation schema and captures the payload',()=>{
  const owner='A:'+domain,op=operation(owner);
  if(domain==='shared-checks')op.changes[0].collection='checks';
  const input=seal(op),accepted=capture(input,owner,'E');
  input.data.changes[0].record.text='mutated';input.data.seq=999;
  assert.equal(accepted.data.seq,1);assert.equal(accepted.data.changes[0].record.text,'accepted');
  const foreign=operation(owner);foreign.changes[0].collection=domain==='shared-checks'?'notes':'checks';
  assert.throws(()=>capture(seal(foreign),owner,'E'),/storage_invalid_collection/);
});

for(const patch of [{seq:'1'},{generation:true},{operationId:[]},{changes:[]},{changes:[{type:'set',field:'notes',value:[]}]},{changes:[{type:'replace-state',state:{notes:[]}}]}])test('checksum-valid malformed journal command fails closed: '+JSON.stringify(patch),()=>{
  assert.throws(()=>capture(seal({...operation(),...patch}),'A:orders','E'));
});

test('journal scope cannot be inferred from the untrusted payload',()=>{
  assert.throws(()=>capture(seal(operation('B:orders')),'A:orders','E'),/owner_mismatch/);
  assert.throws(()=>capture(seal(operation()),'A:orders','other'),/owner_mismatch/);
  assert.throws(()=>capture(seal(operation('unscoped')),'unscoped','E'),/owner_schema_required/);
});

for(const method of ['replaceCurrentState','replaceLocalAuthoritativeState','setCloudBase'])test(method+' captures business input before yielding to its queue',async()=>{
  const db=memoryDb(),journal=createStorageJournal({owner:'A:kupa',schema:{collections:['notes']},db,emergency:emergencyStore(),validate:()=>{}});
  await journal.install({notes:[]});
  const state={notes:[{id:'N',text:'accepted'}]};
  const writing=method==='setCloudBase'?journal.setCloudBase(1,state,{ackSeq:0}):journal[method](state,{boundaryId:'B',expectedSeq:0});
  state.notes[0].text='late mutation';state.notes.push({id:'other'});await writing;
  const stored=await db.load(),accepted=method==='setCloudBase'?stored.bases.data.state:stored.checkpoints.data.state;
  assert.deepEqual(accepted.notes,[{id:'N',text:'accepted'}]);
});

test('implementation mutation removing the decoder admits a business-schema violation',async()=>{
  let source=fs.readFileSync('shared/storage-journal-authority.js','utf8');
  source=source.replaceAll(/(['"])\.\/(.*?)\1/g,(_,quote,file)=>JSON.stringify(new URL('../shared/'+file,import.meta.url).href));
  const checked='readStorageOperation(structuredClone(record),schemaForOwner(owner))';
  assert.ok(source.includes(checked));source=source.replace(checked,'structuredClone(record).data');
  const {captureStorageJournalOperation:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const input=seal({...operation(),changes:[{type:'set',field:'checks',value:[]}]});
  assert.throws(()=>capture(input,'A:orders','E'));
  assert.equal(unsafe(input,'A:orders','E').data.changes[0].field,'checks');
});
