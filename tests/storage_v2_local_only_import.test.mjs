import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {createSharedChecksStorageV2} from '../shared/shared-checks-storage-v2.js';
import {createStorageV2Boundary} from '../shared/storage-v2-boundary.js';
import {applyStorageV2LocalImport} from '../shared/storage-v2-local-import.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const clone=structuredClone;
test('Main local birth is restartable without a cloud cursor and refuses a divergent shadow',async()=>{
  const db=memoryDb(),emergency=emergencyStore(),source={notes:[{id:'N',content:'local'}]};
  const make=mode=>createStorageV2Runtime({app:'orders',owner:()=> 'local',primary:()=>true,mode:()=>mode,
    validate:value=>assert.ok(Array.isArray(value.notes)),prepareCheckpoint:value=>value,
    createJournal:options=>createStorageJournal({...options,db,emergency})});
  const first=make('preparing');
  assert.deepEqual((await first.initializeLocal(source)).state,source);
  assert.equal((await first.cloudState()).base,null);
  const restarted=make('primary');
  assert.deepEqual((await restarted.recover()).state,source);
  await assert.rejects(restarted.initializeLocal({notes:[]}),/storage_local_birth_parity_mismatch/);
  assert.deepEqual((await restarted.recover()).state,source);

  const shadowDb=memoryDb();
  const shadow=createStorageJournal({owner:'local:orders',schema:{collections:['notes'],fields:[]},validate:value=>assert.ok(Array.isArray(value.notes)),db:shadowDb,emergency:emergencyStore()});
  await shadow.install({notes:[{id:'other'}]});
  const candidate=createStorageV2Runtime({app:'orders',owner:()=> 'local',primary:()=>true,mode:()=> 'preparing',
    validate:value=>assert.ok(Array.isArray(value.notes)),prepareCheckpoint:value=>value,
    createJournal:options=>createStorageJournal({...options,db:shadowDb,emergency:emergencyStore()})});
  await assert.rejects(candidate.initializeLocal(source),/storage_local_birth_parity_mismatch/);
  assert.deepEqual((await shadow.recover()).state,{notes:[{id:'other'}]});
});
function boundaryDb(){
  let record=null,failAfterShared=true;
  return {
    async readBoundary(){return clone(record)},
    async beginBoundary(_owner,next){if(record&&record.phase!=='complete')throw Error('storage_boundary_pending');record=clone(next)},
    async advanceBoundary(_owner,id,from,to){
      if(record?.id!==id||record.phase!==from)throw Error('storage_boundary_changed');
      if(failAfterShared&&from==='prepared'){failAfterShared=false;throw Error('simulated-crash-after-shared')}
      record={...record,phase:to};return clone(record);
    },
    async completeBoundary(_owner,id){if(record?.id!==id||record.phase!=='main-applied')throw Error('storage_boundary_changed');record={...record,phase:'complete'}},
    get record(){return clone(record)},
  };
}
function fixture(){
  const mainDb=memoryDb(),sharedDb=memoryDb(),intentDb=boundaryDb(),emergency=emergencyStore();
  const mainState={notes:[{id:'old',content:'before'}]},sharedState={checks:[{id:'old-check',amount:10}],bankEvents:[]};
  const make=()=>{
    const main=createStorageJournal({owner:'local:orders',schema:{collections:['notes'],fields:[]},validate:value=>{if(!Array.isArray(value?.notes))throw Error('invalid-main')},db:mainDb,emergency});
    const shared=createSharedChecksStorageV2({owner:()=> 'local',primary:()=>true,db:sharedDb,emergency});
    const boundary=createStorageV2Boundary({owner:()=> 'local',primary:()=>true,main,shared,db:intentDb});
    return {main,shared,boundary};
  };
  return {make,intentDb,mainDb,sharedDb,mainState,sharedState};
}

test('local-only import replaces both V2 journals without a cloud head and resumes after the Shared commit',async()=>{
  const f=fixture(),first=f.make();
  await first.main.install(f.mainState,{expectedEpoch:null,appMetadata:{storageRole:'primary'}});
  await first.shared.open({migrationState:f.sharedState,migrationIntent:'local-birth',sourceOwner:'local'});
  await first.main.append([{type:'put',collection:'notes',id:'old',mode:'replace',index:0,record:f.mainState.notes[0]}]).committed;
  await first.shared.append([{type:'put',collection:'checks',id:'old-check',mode:'replace',index:0}],f.sharedState).committed;
  assert.equal((await f.mainDb.load('local:orders')).journal.length,1);
  assert.equal((await f.sharedDb.load('local')).journal.length,1);
  const importedMain={notes:[{id:'new',content:'file'}]},importedShared={checks:[{id:'new-check',amount:25}],bankEvents:[]};
  const action={boundary:first.boundary,mode:'local-only',mainCloud:null,sharedCloud:null,
    mainLocal:await first.main.recover(),sharedLocal:await first.shared.recover(),
    mainState:importedMain,sharedState:importedShared,id:'local-import-1'};
  await assert.rejects(applyStorageV2LocalImport(action),/simulated-crash-after-shared/);
  assert.equal(f.intentDb.record.phase,'prepared');
  assert.deepEqual((await first.shared.recover()).state,importedShared);
  assert.deepEqual((await first.main.recover()).state,f.mainState);

  const restarted=f.make();await restarted.main.open();await restarted.shared.open();
  assert.equal((await restarted.boundary.resume()).phase,'complete');
  assert.deepEqual((await restarted.main.recover()).state,importedMain);
  assert.deepEqual((await restarted.shared.recover()).state,importedShared);
  assert.equal((await restarted.main.cloudState()).base,null);
  assert.equal((await restarted.shared.cloudState()).base,null);
  assert.deepEqual((await f.mainDb.load('local:orders')).journal,[]);
  assert.deepEqual((await f.sharedDb.load('local')).journal,[]);
  assert.equal((await restarted.boundary.run({id:'local-import-1',kind:'import',
    main:{kind:'replace-local-authoritative',state:importedMain,expectedSeq:1},
    shared:{kind:'replace-local-authoritative',state:importedShared,expectedSeq:1}})).phase,'complete');
});

test('local-only import refuses an owner that has acquired a cloud cursor',async()=>{
  const f=fixture(),runtime=f.make();
  await runtime.main.install(f.mainState,{expectedEpoch:null,appMetadata:{storageRole:'primary'}});
  await runtime.shared.open({migrationState:f.sharedState,migrationIntent:'local-birth',sourceOwner:'local'});
  await runtime.main.captureCloudCursor(0);
  const action={boundary:runtime.boundary,mode:'local-only',mainLocal:await runtime.main.recover(),sharedLocal:await runtime.shared.recover(),mainState:{notes:[]},sharedState:{checks:[],bankEvents:[]},id:'unsafe-local-import'};
  await assert.rejects(applyStorageV2LocalImport(action),/storage_boundary_local_cloud_head_exists/);
  assert.equal(f.intentDb.record,null);
  assert.deepEqual((await runtime.main.recover()).state,f.mainState);
});
