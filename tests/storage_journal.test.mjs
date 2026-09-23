import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStoredOperation,replayStorageJournal,sealStorageRecord,readStorageRecord,validateStoredOperation} from '../shared/storage-journal-model.js';
import {createStorageShadow} from '../shared/storage-shadow.js';
import {createDomainsNotesController} from '../netunim-kupa/site/assets/js/domains/notes/controller.js';

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
test('shadow never runs while disabled, captures canonical rows, coalesces boundaries and reports parity failure',async()=>{
  let enabled=false,current={notes:[{id:'n',text:'old',normalized:true}]},stored=null,ready=false,writes=0;
  const shadow=createStorageShadow({app:'orders',owner:()=> 'a',primary:()=>true,enabled:()=>enabled,validate:()=>{},schedule:()=>{},createJournal:()=>({get ready(){return ready},open:async()=>null,install:async state=>{stored=structuredClone(state);ready=true},append:changes=>{writes++;applyStoredOperation(stored,operation(writes,changes),schema);return {committed:Promise.resolve(true)}},recover:async()=>({state:stored}),compact:async()=>{}})});
  assert.equal(shadow.observe(current),false);enabled=true;shadow.observe(current,{storageBoundary:'initial-v1-checkpoint'});await shadow.flush();
  current={notes:[{id:'n',text:'new',normalized:true}]};shadow.observe(current,{operations:[put('raw')]});await shadow.flush();assert.equal(stored.notes[0].text,'new');assert.equal(shadow.diagnostics.parityChecks,1);
  shadow.observe({notes:[{id:'n',text:'not described'}],setting:99},{operations:[put('ignored')]});assert.equal(await shadow.flush(),false);assert.equal(shadow.diagnostics.mismatches,1);
  shadow.observe(current,{storageBoundary:'parity-recovery-checkpoint'});assert.equal(await shadow.flush(),true);assert.equal(shadow.diagnostics.checkpoints,2);
});
test('shadow records startup differences before replacing its checkpoint with V1 authority',async()=>{
  let installed=null;
  const shadow=createStorageShadow({app:'orders',owner:()=> 'a',primary:()=>true,enabled:()=>true,validate:()=>{},schedule:()=>{},createJournal:()=>({ready:true,open:async()=>({state:{notes:[]}}),install:async state=>{installed=state}})});
  const current={notes:[{id:'n',content:'V1 offline edit'}]};shadow.observe(current,{storageBoundary:'startup-v1-authority'});await shadow.flush();
  assert.equal(shadow.diagnostics.startupChecks,1);assert.equal(shadow.diagnostics.startupDifferences,1);assert.deepEqual(installed,current);
});
test('Kupa note save describes every edited note in one debounce batch',()=>{
  const model={state:{notes:[{id:'a',content:'old'},{id:'b',content:'old'}]}},saved=[];
  const controller=createDomainsNotesController({model,ui:{notesTab:'notes'},saveState:(message,options)=>saved.push(structuredClone(options)),confirmDialog:async()=>true});
  const field=value=>({value,style:{},scrollHeight:132,closest:()=>null});
  controller.updateStickyNote('a',field('first'));controller.updateStickyNote('b',field('second'));controller.flushNoteSave();
  assert.equal(saved.length,1);assert.deepEqual(saved[0].operations.map(operation=>[operation.id,operation.record.content]),[['a','first'],['b','second']]);
  controller.updateStickyNote('b',field('third'));controller.flushNoteSave();assert.deepEqual(saved[1].operations.map(operation=>operation.id),['b']);
});
