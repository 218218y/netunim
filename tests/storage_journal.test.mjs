import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStoredOperation,replayStorageJournal,sealStorageRecord,readStorageRecord,validateStoredOperation} from '../shared/storage-journal-model.js';
import {createDomainsNotesController} from '../netunim-kupa/site/assets/js/domains/notes/controller.js';
import {STORAGE_SCHEMAS} from '../shared/storage-v2-schema.js';

const schema={collections:['notes'],fields:['setting']};
const checkpoint=()=>sealStorageRecord({version:2,owner:'a',epoch:'e',seq:0,state:{notes:[{id:'n',text:'old'}],setting:1}});
const operation=(seq,changes)=>({version:2,owner:'a',epoch:'e',seq,generation:seq,operationId:'op'+seq,at:'2026-09-22',changes});
const put=text=>({type:'put',collection:'notes',mode:'replace',id:'n',record:{id:'n',text}});

test('typed replay is deterministic, detached, ordered and explicitly deletes',()=>{
  const base=checkpoint(),first=sealStorageRecord(operation(1,[put('new')])),second=sealStorageRecord(operation(2,[{type:'delete',collection:'notes',id:'n'}]));
  assert.deepEqual(replayStorageJournal(base,[second,first,first],schema).state,{notes:[],setting:1});
  assert.deepEqual(replayStorageJournal(base,[first],schema),replayStorageJournal(base,[first],schema));
  assert.equal(readStorageRecord(base).state.notes[0].text,'old');
});
test('corruption, gaps, conflicting sequence, foreign owner/epoch and duplicate operation IDs fail closed',()=>{
  const base=checkpoint(),one=operation(1,[put('new')]);
  const corrupt=sealStorageRecord(one);corrupt.data.changes[0].record.text='corrupt';assert.throws(()=>readStorageRecord(corrupt));
  assert.throws(()=>replayStorageJournal(base,[sealStorageRecord({...one,seq:2})],schema));
  for(const modified of [{owner:'b'},{epoch:'other'}])assert.throws(()=>replayStorageJournal(base,[sealStorageRecord({...one,...modified})],schema));
  assert.throws(()=>replayStorageJournal(base,[sealStorageRecord(one),sealStorageRecord({...one,changes:[put('different')]})],schema));
  assert.throws(()=>replayStorageJournal(base,[sealStorageRecord(one),sealStorageRecord({...one,seq:2})],schema));
});
test('unknown operations and implicit deletes are never accepted',()=>{
  for(const change of [{...put('x'),mode:'upsert'},{type:'replace-collection',collection:'notes',id:'n',records:[]},{type:'set',field:'notes',value:[]},{type:'put',collection:'__proto__',id:'x',record:{id:'x'}}])assert.throws(()=>validateStoredOperation(operation(1,[change]),schema));
  assert.throws(()=>applyStoredOperation({notes:[]},operation(1,[put('x')]),schema));
  assert.throws(()=>applyStoredOperation({notes:[]},operation(1,[{type:'delete',collection:'notes',id:'n'}]),schema));
  assert.throws(()=>sealStorageRecord({value:NaN}));assert.throws(()=>sealStorageRecord({value:undefined}));
});
test('Main V2 refuses new check operations while old checkpoints remain replayable until projection migration',()=>{
  for(const app of ['orders','kupa']){
    const mainSchema=STORAGE_SCHEMAS[app],check={type:'put',collection:'checks',mode:'insert',id:'C1',index:0,record:{id:'C1'}};
    assert.equal(mainSchema.collections.includes('checks'),false);
    assert.throws(()=>validateStoredOperation(operation(1,[check]),mainSchema),/storage_invalid_collection/);
    const legacy=sealStorageRecord({version:2,owner:'a',epoch:'e',seq:0,state:{checks:[]},appMetadata:{storageRole:'primary'}}),oldEntry=sealStorageRecord(operation(1,[check]));
    assert.deepEqual(replayStorageJournal(legacy,[oldEntry],mainSchema).state.checks,[{id:'C1'}]);
    const migrated=sealStorageRecord({version:2,owner:'a',epoch:'e',seq:1,state:{},appMetadata:{storageRole:'primary',mainProjectionVersion:2}});
    assert.throws(()=>replayStorageJournal(migrated,[oldEntry],mainSchema),/storage_invalid_collection/);
  }
});
test('full-state replacement requires an explicit durable import or cloud normalization boundary',()=>{
  const replacement={type:'replace-state',state:{notes:[{id:'imported'}],setting:2}};
  assert.throws(()=>validateStoredOperation(operation(1,[replacement]),schema),/invalid_local_import/);
  const imported={...operation(1,[replacement]),mutationType:'import',appMetadata:{boundaryId:'import-1'}};
  assert.deepEqual(replayStorageJournal(checkpoint(),[sealStorageRecord(imported)],schema).state,replacement.state);
  const normalized={...imported,mutationType:'cloud-normalization'};
  assert.deepEqual(replayStorageJournal(checkpoint(),[sealStorageRecord(normalized)],schema).state,replacement.state);
  const bootstrap={...operation(1,[replacement]),mutationType:'bootstrap',appMetadata:{storageRole:'primary',migrationIntent:'upload-local',sourceOwner:'local'}};
  assert.deepEqual(replayStorageJournal(checkpoint(),[sealStorageRecord(bootstrap)],schema).state,replacement.state);
  assert.throws(()=>validateStoredOperation({...bootstrap,seq:2},schema),/invalid_local_import/);
  assert.throws(()=>validateStoredOperation({...normalized,appMetadata:{}},schema),/invalid_local_import/);
});
test('inserts preserve user ordering, scalar updates replay and checkpoint duplicates are harmless',()=>{
  const first=operation(1,[{type:'put',collection:'notes',mode:'insert',id:'first',index:0,record:{id:'first',text:'first'}},{type:'set',field:'setting',value:2}]);
  const result=replayStorageJournal(checkpoint(),[sealStorageRecord(first)],schema);assert.deepEqual(result.state.notes.map(row=>row.id),['first','n']);assert.equal(result.state.setting,2);
  const compact=sealStorageRecord({version:2,owner:'a',epoch:'e',seq:1,state:result.state});assert.deepEqual(replayStorageJournal(compact,[sealStorageRecord(first)],schema).state,result.state);
});
test('Kupa note save describes every edited note in one debounce batch',()=>{
  const model={state:{notes:[{id:'a',content:'old'},{id:'b',content:'old'}]}},saved=[];
  const controller=createDomainsNotesController({model,ui:{notesTab:'notes'},saveState:(message,options)=>saved.push(structuredClone(options)),confirmDialog:async()=>true});
  const field=value=>({value,style:{},scrollHeight:132,closest:()=>null});
  controller.updateStickyNote('a',field('first'));controller.updateStickyNote('b',field('second'));controller.flushNoteSave();
  assert.equal(saved.length,1);assert.deepEqual(saved[0].operations.map(operation=>[operation.id,operation.record.content]),[['a','first'],['b','second']]);
  controller.updateStickyNote('b',field('third'));controller.flushNoteSave();assert.deepEqual(saved[1].operations.map(operation=>operation.id),['b']);
});
