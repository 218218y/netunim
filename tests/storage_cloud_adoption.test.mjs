import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {createStorageBrowser as createKupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {createStorageBrowser as createOrdersBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {INITIAL_STATE as KUPA_INITIAL_STATE} from '../netunim-kupa/site/assets/js/state/constants.js';
import {INITIAL_STATE as ORDERS_INITIAL_STATE} from '../netunim-orders/site/assets/js/state/constants.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const clone=structuredClone,initial={notes:[{id:'N',content:'local'}]},remote={notes:[{id:'N',content:'remote'}]};
async function fixture(){const db=memoryDb(),journal=createStorageJournal({owner:'adoption:kupa',schema:{collections:['notes'],fields:[]},validate:state=>assert.ok(Array.isArray(state.notes)),db,emergency:emergencyStore()});await journal.initializeCloudHead(10,initial);return {db,journal}}

test('cloud reads cannot retire a durable conflict control',async()=>{
  const {journal,db}=await fixture();await journal.setCloudControl({conflict:{kind:'entity-conflict'}});const before=await db.load();
  await assert.rejects(journal.adoptCloudHead(11,remote,remote),/storage_cloud_pending/);assert.deepEqual(await db.load(),before);
});

test('cloud adoption requires the sequence and base revision observed for the remote read',async()=>{
  for(const expectedHead of [{seq:1,baseRevision:10},{seq:0,baseRevision:9}]){
    const {journal,db}=await fixture(),before=await db.load();
    await assert.rejects(journal.adoptCloudHead(11,remote,remote,{expectedHead}),/storage_cloud_adoption_stale/);assert.deepEqual(await db.load(),before);
  }
});

for(const race of ['edit','control','checkpoint','base'])test(`a ${race} race during cloud adoption preserves the changed durable head`,async()=>{
  const {db,journal}=await fixture(),adopt=db.adoptCloudHead;
  db.adoptCloudHead=async(...args)=>{
    if(race==='edit')await journal.append([{type:'put',collection:'notes',id:'N',mode:'replace',record:{id:'N',content:'later edit'}}]).committed;
    if(race==='control')await journal.setCloudControl({conflict:{kind:'entity-conflict'}});
    if(race==='checkpoint')await journal.replaceCurrentState({notes:[{id:'N',content:'new checkpoint'}]});
    if(race==='base')await journal.setCloudBase(12,initial,{ackSeq:0});
    return adopt(...args);
  };
  await assert.rejects(journal.adoptCloudHead(11,remote,remote),/storage_cloud_adoption_stale/);
  const recovered=await journal.recover(),cloud=await journal.cloudState();
  assert.notEqual(recovered.state.notes[0].content,'remote');
  if(race==='edit'){assert.equal(recovered.state.notes[0].content,'later edit');assert.equal(cloud.pending,true)}
  if(race==='control')assert.equal(cloud.control.conflict.kind,'entity-conflict');
  if(race==='checkpoint')assert.equal(recovered.state.notes[0].content,'new checkpoint');
  if(race==='base')assert.equal(cloud.base.revision,12);
});

test('a clean Shared-style network retry control can retire after a successful read',async()=>{
  const {journal}=await fixture();await journal.setCloudControl({retry:{attempts:1,lastErrorCode:'network'}});
  await journal.adoptCloudHead(11,remote,remote);
  assert.equal((await journal.cloudState()).control,null);assert.deepEqual((await journal.recover()).state,remote);
});

test('Storage V2 captures the cloud adoption checkpoint before waiting for an older commit',async()=>{
  let release,captured;const committed=new Promise(resolve=>{release=resolve});
  const journal={ready:true,open:async()=>({state:clone(initial),seq:0,appMetadata:{storageRole:'primary'},stored:{checkpoints:{data:{seq:0}}}}),
    append:()=>({seq:1,emergencyDurable:true,committed}),adoptCloudHead:async(_revision,base,state)=>{captured={base:clone(base),state:clone(state)};return {seq:1,revision:11}}};
  const runtime=createStorageV2Runtime({app:'kupa',owner:()=> 'account-A',primary:()=>true,mode:()=> 'primary',validate:()=>{},createJournal:()=>journal});
  await runtime.recover();runtime.persist(initial,{operations:[{type:'set',field:'setting',value:true}]});
  const candidate=clone(remote),base=clone(remote),adoption=runtime.adoptCloudHead(11,base,candidate);
  candidate.notes[0].content='later edit';base.notes[0].content='later edit';release();await adoption;
  assert.deepEqual(captured,{base:remote,state:remote});
});

test('browser adoption ports expose a later durable edit rather than only the older commit receipt',async()=>{
  for(const app of ['kupa','orders']){
    const state=clone(app==='kupa'?KUPA_INITIAL_STATE:ORDERS_INITIAL_STATE),project=value=>{const next=clone(value);delete next.checks;return next};
    const storageV2={primaryReady:true,adoptCloudHead:async()=>({seq:0,revision:11}),cloudState:async()=>({seq:1,base:{revision:11,state:project(state)},pending:true,control:null})};
    const options={model:{state},session:{},files:{},storageV2,prepareKupaCloudState:project,prepareCloudState:project};
    const browser=(app==='kupa'?createKupaBrowser:createOrdersBrowser)(options);
    const current=await browser.adoptStorageV2CloudHead(11,state,{expectedHead:{seq:0,baseRevision:10}});
    assert.equal(current.seq,1,app);assert.equal(current.pending,true,app);assert.equal(current.revision,11,app);
  }
});
