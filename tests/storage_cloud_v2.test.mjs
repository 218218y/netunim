import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {readStorageRecord} from '../shared/storage-journal-model.js';
import {createStorageBrowser as createOrdersStorageBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {INITIAL_STATE as ORDERS_INITIAL_STATE,STORAGE_KEY as ORDERS_STORAGE_KEY} from '../netunim-orders/site/assets/js/state/constants.js';
import {createStorageBrowser as createKupaStorageBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {createStoragePending as createKupaStoragePending} from '../netunim-kupa/site/assets/js/storage/pending.js';
import {createOutboxRecord} from '../shared/cloud-sync.js';
import {INITIAL_STATE as KUPA_INITIAL_STATE,BROWSER_STATE_KEY as KUPA_STORAGE_KEY} from '../netunim-kupa/site/assets/js/state/constants.js';

const clone=structuredClone;
test('Storage V2 captures ACK and rebase checkpoints before waiting for an older journal commit',async()=>{
  for(const method of ['acknowledgeFlight','rejectFlight']){
    let releaseCommit,captured=null;const committed=new Promise(resolve=>{releaseCommit=resolve});
    const initial={notes:[{id:'N',text:'base'}]},record=async(_id,_revision,_state,options)=>{captured=clone(options.checkpointState);return true},active={ready:true,
      open:async()=>({state:clone(initial),seq:0,appMetadata:{storageRole:'primary',snapshotSeq:0},stored:{checkpoints:{data:{seq:0}}}}),
      append:()=>({seq:1,operationId:'edit-1',emergencyDurable:true,committed}),
      acknowledge:record,rejectAndRebase:record};
    const runtime=createStorageV2Runtime({app:'orders',owner:()=> 'account-A',primary:()=>true,validate:value=>assert.ok(Array.isArray(value.notes)),mode:()=> 'primary',createJournal:()=>active});
    await runtime.recover(initial);
    runtime.persist({notes:[{id:'N',text:'queued'}]},{operations:[{type:'set',field:'unused',value:true}]});
    const mutable={notes:[{id:'N',text:'before-await'}]},commit=runtime[method]('flight',11,initial,{currentState:mutable,expectedSeq:1});
    mutable.notes[0].text='later-edit';releaseCommit();await commit;
    assert.equal(captured.notes[0].text,'before-await',method);
  }
});
function emergencyStore(){const rows=new Map();return {get length(){return rows.size},key(index){return [...rows.keys()][index]??null},getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)}}
function memoryDb(){
  let checkpoints=null,metadata=null,journal=[],bases=null,flights=null,controls=null;
  const load=async()=>clone({checkpoints,metadata,journal,bases,flights,controls});
  return {
    load,
    async install(_owner,checkpoint,writer){const data=readStorageRecord(checkpoint);checkpoints=clone(checkpoint);metadata={epoch:data.epoch,seq:data.seq,writer};journal=[];bases=null;flights=null;controls=null},
    async claim(_owner,epoch,writer){assert.equal(metadata.epoch,epoch);metadata={...metadata,writer}},
    async append(_owner,epoch,writer,record){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);const data=readStorageRecord(record);assert.equal(data.seq,metadata.seq+1);journal.push(clone(record));metadata={...metadata,seq:data.seq}},
    async appendBoundary(_owner,epoch,writer,record,{expectedSeq,expectedBaseRevision}){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);if(metadata.seq!==expectedSeq||!bases||readStorageRecord(bases).ackSeq!==expectedSeq||readStorageRecord(bases).revision!==expectedBaseRevision||flights||controls)throw new Error('storage_boundary_cloud_changed');const data=readStorageRecord(record);assert.equal(data.seq,expectedSeq+1);journal.push(clone(record));metadata={...metadata,seq:data.seq}},
    async compact(_owner,epoch,writer,checkpoint){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);checkpoints=clone(checkpoint);const seq=readStorageRecord(checkpoint).seq,ack=bases?readStorageRecord(bases).ackSeq:seq;journal=journal.filter(row=>row.data.seq>Math.min(seq,ack))},
    async replaceCheckpoint(_owner,epoch,writer,checkpoint){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(readStorageRecord(checkpoint).seq,metadata.seq);checkpoints=clone(checkpoint)},
    async setBase(_owner,epoch,writer,base){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(flights,null);bases=clone(base)},
    async beginFlight(_owner,epoch,writer,flight){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);if(flights)return clone(flights);flights=clone(flight);return clone(flight)},
    async acknowledge(_owner,epoch,writer,operationId,base,{checkpoint=null,control=null}={}){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(readStorageRecord(flights).operationId,operationId);bases=clone(base);if(checkpoint)checkpoints=clone(checkpoint);flights=null;controls=control&&clone(control);return true},
    async rejectFlight(_owner,epoch,writer,operationId,base,{checkpoint,expectedSeq,control=null}={}){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(readStorageRecord(flights).operationId,operationId);assert.equal(expectedSeq,metadata.seq);assert.equal(readStorageRecord(checkpoint).seq,metadata.seq);checkpoints=clone(checkpoint);bases=clone(base);flights=null;controls=control&&clone(control);return true},
    async setControl(_owner,epoch,writer,control){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);controls=clone(control);return true},
    async clearControl(){controls=null;return true},
    async adoptCloudHead(_owner,epoch,writer,checkpoint,base){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(flights,null);assert.equal(readStorageRecord(bases).ackSeq,metadata.seq);checkpoints=clone(checkpoint);bases=clone(base);controls=null;return true},
    async resetState(_owner,epoch,writer,checkpoint){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);const cp=readStorageRecord(checkpoint);assert.equal(cp.seq,0);checkpoints=clone(checkpoint);metadata={epoch:cp.epoch,seq:0,writer};journal=[];bases=null;flights=null;controls=null;return true},
    async resetCloudHead(_owner,epoch,writer,checkpoint,base){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);const cp=readStorageRecord(checkpoint),nextBase=readStorageRecord(base);assert.equal(cp.epoch,nextBase.epoch);assert.equal(cp.seq,0);assert.equal(nextBase.ackSeq,0);checkpoints=clone(checkpoint);metadata={epoch:cp.epoch,seq:0,writer};journal=[];bases=clone(base);flights=null;controls=null;return true},
  }
}

const schema={collections:['notes'],fields:[]};
const put=(id,text)=>({type:'put',collection:'notes',mode:'replace',id,record:{id,text}});

test('local V2 import keeps cloud revision, survives restart, and sends deleted IDs in one flight',async()=>{
  const db=memoryDb(),emergency=emergencyStore(),owner='orders:local-import',validate=value=>assert.ok(Array.isArray(value.notes));
  const first=createStorageJournal({owner,schema,validate,db,emergency});
  await first.install({notes:[{id:'old',text:'old'},{id:'keep',text:'before'}]},{expectedEpoch:null,appMetadata:{storageRole:'primary'}});
  await first.captureCloudCursor(7);
  await first.replaceLocalWithPending({notes:[{id:'keep',text:'after'},{id:'new',text:'new'}]},{boundaryId:'import-1',expectedSeq:0,expectedBaseRevision:7});
  const restarted=createStorageJournal({owner,schema,validate,db,emergency});
  const recovered=await restarted.open(),cloud=await restarted.cloudState();
  assert.deepEqual(recovered.state.notes.map(row=>row.id),['keep','new']);assert.equal(recovered.appMetadata.boundaryId,'import-1');
  assert.equal(cloud.base.revision,7);assert.equal(cloud.base.ackSeq,0);assert.equal(cloud.pending,true);
  assert.deepEqual(cloud.pendingDeleteIntents,{notes:['old']});
  const flight=await restarted.materializeFlight({operationId:'import-flight',baseRevision:7});
  assert.deepEqual(flight.snapshot.notes,recovered.state.notes);assert.deepEqual(flight.deleteIntents,{notes:['old']});
});

test('local V2 import refuses stale cloud head without changing local state',async()=>{
  const db=memoryDb(),journal=createStorageJournal({owner:'kupa:stale-import',schema,validate:value=>assert.ok(Array.isArray(value.notes)),db,emergency:emergencyStore()});
  await journal.install({notes:[{id:'A'}]},{expectedEpoch:null});await journal.captureCloudCursor(4);
  await assert.rejects(journal.replaceLocalWithPending({notes:[]},{boundaryId:'import-stale',expectedSeq:0,expectedBaseRevision:3}),/cloud_changed/);
  assert.deepEqual((await journal.recover()).state.notes,[{id:'A'}]);assert.equal((await journal.cloudState()).pending,false);
});

test('Storage V2 cloud cursor preserves later journal across ACK, supports confirmed reject/rebase, and adopts clean heads atomically',async()=>{
  let ids=0;const journal=createStorageJournal({owner:'orders:test',schema,validate:state=>assert.ok(Array.isArray(state.notes)),db:memoryDb(),emergency:emergencyStore(),operationId:()=>`id-${++ids}`,now:()=>`2026-09-22T00:00:0${ids}Z`});
  await journal.install({notes:[{id:'A',text:'base'}]},{expectedEpoch:null,appMetadata:{storageRole:'primary'}});
  await journal.captureCloudCursor(10);
  const first=journal.append([put('A','sent')],{generation:1,surface:'orders',mutationType:'edit'});await first.committed;
  const flight1=await journal.materializeFlight({operationId:'flight-1',baseRevision:10});assert.equal(flight1.endSeq,1);assert.equal(flight1.snapshot.notes[0].text,'sent');
  const second=journal.append([put('A','later')],{generation:2,surface:'orders',mutationType:'edit',deleteIntents:{notes:['B']}});await second.committed;
  let cloud=await journal.cloudState();assert.equal(cloud.afterFlightPending,true);assert.deepEqual(cloud.afterFlightDeleteIntents,{notes:['B']});
  await journal.acknowledge('flight-1',11,{notes:[{id:'A',text:'sent'}]},{checkpointState:{notes:[{id:'A',text:'later'}]},appMetadata:{revision:11}});
  assert.equal((await journal.recover()).state.notes[0].text,'later');cloud=await journal.cloudState();assert.equal(cloud.base.ackSeq,1);assert.equal(cloud.pending,true);assert.deepEqual(cloud.pendingDeleteIntents,{notes:['B']});

  const flight2=await journal.materializeFlight({operationId:'flight-2',baseRevision:11});assert.equal(flight2.startSeq,2);assert.equal(flight2.endSeq,2);
  await journal.rejectAndRebase('flight-2',12,{notes:[{id:'A',text:'remote'}]},{checkpointState:{notes:[{id:'A',text:'later'}]},expectedSeq:2,control:{conflict:{kind:'entity-conflict'}}});cloud=await journal.cloudState();assert.equal(cloud.flight,null);assert.equal(cloud.base.revision,12);assert.equal(cloud.base.ackSeq,1);assert.equal(cloud.control.conflict.kind,'entity-conflict');
  await journal.clearCloudControl();const flight3=await journal.materializeFlight({operationId:'flight-3',baseRevision:12,snapshot:{notes:[{id:'A',text:'merged'}]}});assert.equal(flight3.endSeq,2);
  await journal.acknowledge('flight-3',13,{notes:[{id:'A',text:'merged'}]},{checkpointState:{notes:[{id:'A',text:'merged'}]}});cloud=await journal.cloudState();assert.equal(cloud.pending,false);assert.equal(cloud.base.ackSeq,2);
  await journal.adoptCloudHead(14,{notes:[{id:'A',text:'remote-head'}]},{notes:[{id:'A',text:'remote-head'}]});cloud=await journal.cloudState();assert.equal(cloud.base.revision,14);assert.equal((await journal.recover()).state.notes[0].text,'remote-head');
});


test('Storage V2 explicit cloud reset atomically drops obsolete flight/journal and starts a clean epoch',async()=>{
  let ids=100;const journal=createStorageJournal({owner:'kupa:reset',schema,validate:state=>assert.ok(Array.isArray(state.notes)),db:memoryDb(),emergency:emergencyStore(),operationId:()=>`reset-${++ids}`});
  await journal.install({notes:[{id:'A',text:'base'}]},{expectedEpoch:null});await journal.captureCloudCursor(20);
  const write=journal.append([put('A','local')],{generation:1,surface:'kupa',mutationType:'edit'});await write.committed;const flight=await journal.materializeFlight({operationId:'flight-reset',baseRevision:20});assert.ok(flight);
  await journal.setCloudControl({retry:{attempts:2}});const beforeEpoch=journal.epoch;
  await journal.resetCloudHead(25,{notes:[{id:'A',text:'remote'}]},{notes:[{id:'A',text:'remote'}]});
  const cloud=await journal.cloudState(),recovered=await journal.recover();assert.notEqual(journal.epoch,beforeEpoch);assert.equal(cloud.seq,0);assert.equal(cloud.base.revision,25);assert.equal(cloud.base.ackSeq,0);assert.equal(cloud.flight,null);assert.equal(cloud.control,null);assert.equal(cloud.pending,false);assert.equal(recovered.state.notes[0].text,'remote');
});

test('Storage V2 explicit authoritative replacement can intentionally supersede an unresolved flight',async()=>{
  let ids=200;const journal=createStorageJournal({owner:'orders:authoritative',schema,validate:state=>assert.ok(Array.isArray(state.notes)),db:memoryDb(),emergency:emergencyStore(),operationId:()=>`authoritative-${++ids}`});
  await journal.install({notes:[{id:'A',text:'base'}]},{expectedEpoch:null});await journal.captureCloudCursor(30);
  const write=journal.append([put('A','pending')],{generation:1,surface:'orders',mutationType:'edit'});await write.committed;assert.ok(await journal.materializeFlight({operationId:'old-flight',baseRevision:30}));await journal.setCloudControl({retry:{attempts:3}});
  const oldEpoch=journal.epoch;await journal.replaceAuthoritativeState({notes:[{id:'A',text:'restored'}]},{appMetadata:{storageRole:'primary',revision:0}});
  const recovered=await journal.recover(),cloud=await journal.cloudState();assert.notEqual(journal.epoch,oldEpoch);assert.equal(recovered.seq,0);assert.equal(recovered.state.notes[0].text,'restored');assert.equal(cloud.base,null);assert.equal(cloud.flight,null);assert.equal(cloud.control,null);assert.equal(cloud.pending,false);
});




test('Storage V2 routes edits that arrive during an epoch reset into the new epoch without losing the new cloud cursor',async()=>{
  let ids=300,releaseReset,startReset;const db=memoryDb(),originalReset=db.resetCloudHead.bind(db),started=new Promise(resolve=>{startReset=resolve}),released=new Promise(resolve=>{releaseReset=resolve});
  db.resetCloudHead=async(...args)=>{startReset();await released;return originalReset(...args)};
  const journal=createStorageJournal({owner:'orders:transition',schema,validate:state=>assert.ok(Array.isArray(state.notes)),db,emergency:emergencyStore(),operationId:()=>`transition-${++ids}`});
  await journal.install({notes:[{id:'A',text:'base'}]},{expectedEpoch:null});await journal.captureCloudCursor(40);const oldEpoch=journal.epoch;
  const reset=journal.resetCloudHead(41,{notes:[{id:'A',text:'remote'}]},{notes:[{id:'A',text:'remote'}]});await started;
  const during=journal.append([put('A','edited-during-reset')],{generation:1,surface:'orders',mutationType:'edit',appMetadata:{snapshotSeq:2,revision:41}});assert.equal(during.transitioning,true);assert.equal(during.emergencyDurable,true);assert.equal(during.seq,1);
  await assert.rejects(journal.install({notes:[{id:'A',text:'overlap'}]}),/storage_epoch_transition/);
  releaseReset();const resetResult=await reset;await during.committed;
  const recovered=await journal.recover(),cloud=await journal.cloudState();assert.notEqual(journal.epoch,oldEpoch);assert.equal(resetResult.seq,1);assert.equal(resetResult.ackSeq,0);assert.equal(recovered.state.notes[0].text,'edited-during-reset');assert.equal(recovered.seq,1);assert.equal(recovered.appMetadata.snapshotSeq,2);assert.equal(cloud.base.revision,41);assert.equal(cloud.base.ackSeq,0);assert.equal(cloud.flight,null);assert.equal(cloud.pending,true);
});

test('Storage V2 restart after confirmed rebase cannot resend an old remote field',async()=>{
  const db=memoryDb(),emergency=emergencyStore(),owner='orders:rebase-crash',schema={collections:['notes'],fields:[]},validate=value=>assert.ok(Array.isArray(value.notes));
  const first=createStorageJournal({owner,schema,validate,db,emergency});
  const base={notes:[{id:'A',text:'a0'},{id:'B',text:'b0'}]},local={notes:[{id:'A',text:'a1'},{id:'B',text:'b0'}]},remote={notes:[{id:'A',text:'a0'},{id:'B',text:'b1'}]},merged={notes:[{id:'A',text:'a1'},{id:'B',text:'b1'}]};
  await first.install(base,{expectedEpoch:null});await first.captureCloudCursor(10);
  await first.append([put('A','a1')],{generation:1}).committed;
  const flight=await first.materializeFlight({operationId:'conflicted-flight',baseRevision:10});
  await assert.rejects(first.rejectAndRebase(flight.operationId,Number.NaN,remote,{checkpointState:merged,expectedSeq:1}),/revision_invalid/);
  await assert.rejects(first.rejectAndRebase(flight.operationId,11,remote,{checkpointState:merged,expectedSeq:0}),/checkpoint_stale/);
  assert.equal((await first.cloudState()).base.revision,10,'a stale reject must leave the old base and flight intact');
  await first.rejectAndRebase(flight.operationId,11,remote,{checkpointState:merged,expectedSeq:1});
  const restarted=createStorageJournal({owner,schema,validate,db,emergency});
  const recovered=await restarted.open();assert.deepEqual(recovered.state,merged);
  const retry=await restarted.materializeFlight({operationId:'replacement-flight',baseRevision:11});
  assert.equal(retry.baseRevision,11);assert.deepEqual(retry.snapshot,merged);
  assert.notDeepEqual(retry.snapshot,local,'the replacement must keep B from the remote revision');
});

test('Storage V2 recovers a transition edit from the old epoch when the reset fails',async()=>{
  let ids=400,releaseReset,startReset;const db=memoryDb(),emergency=emergencyStore(),started=new Promise(resolve=>{startReset=resolve}),released=new Promise(resolve=>{releaseReset=resolve});
  db.resetCloudHead=async()=>{startReset();await released;throw new Error('injected reset failure')};
  const options={owner:'orders:failed-transition',schema,validate:state=>assert.ok(Array.isArray(state.notes)),db,emergency,operationId:()=>`failed-transition-${++ids}`};
  const journal=createStorageJournal(options);await journal.install({notes:[{id:'A',text:'base'}]},{expectedEpoch:null});await journal.captureCloudCursor(40);
  const reset=journal.resetCloudHead(41,{notes:[{id:'A',text:'remote'}]},{notes:[{id:'A',text:'remote'}]});await started;
  const during=journal.append([put('A','first-edit')],{generation:1,surface:'orders',mutationType:'edit'});
  const later=journal.append([put('A','must-survive')],{generation:2,surface:'orders',mutationType:'edit'});
  assert.equal(during.emergencyDurable,true);assert.equal(during.transitionFallbackDurable,true);
  assert.equal(later.emergencyDurable,true);assert.equal(later.seq,2);
  releaseReset();await assert.rejects(reset,/injected reset failure/);await assert.rejects(during.committed);await assert.rejects(later.committed);
  assert.equal(journal.ready,false,'the failed writer stops accepting edits');
  const restarted=createStorageJournal(options);const recovered=await restarted.open();assert.equal(recovered.state.notes[0].text,'must-survive');assert.equal(recovered.seq,2);
  assert.equal(emergency.length,0,'the abandoned new-epoch emergency copy is retired after recovery');
});

test('Storage V2 recovers a transition edit from the new epoch after reset commits but before its journal append',async()=>{
  let ids=500,releaseAppend,startAppend;const db=memoryDb(),originalAppend=db.append.bind(db),emergency=emergencyStore(),started=new Promise(resolve=>{startAppend=resolve}),released=new Promise(resolve=>{releaseAppend=resolve});
  db.append=async(...args)=>{startAppend();await released;return originalAppend(...args)};
  const options={owner:'orders:committed-transition',schema,validate:state=>assert.ok(Array.isArray(state.notes)),db,emergency,operationId:()=>`committed-transition-${++ids}`};
  const journal=createStorageJournal(options);await journal.install({notes:[{id:'A',text:'base'}]},{expectedEpoch:null});await journal.captureCloudCursor(40);
  const reset=journal.resetCloudHead(41,{notes:[{id:'A',text:'remote'}]},{notes:[{id:'A',text:'remote'}]});
  const during=journal.append([put('A','must-survive')],{generation:1,surface:'orders',mutationType:'edit'});
  await reset;await started;db.append=originalAppend;const restarted=createStorageJournal(options),recovered=await restarted.open();
  assert.equal(recovered.state.notes[0].text,'must-survive');assert.equal(recovered.seq,1);
  releaseAppend();await assert.rejects(during.committed,'the previous writer is fenced after restart');
});



test('browser adapters skip the full V1 compatibility snapshot when a transition edit has V2 emergency durability',async()=>{
  const previous=globalThis.localStorage,storage=emergencyStore();globalThis.localStorage=storage;
  try{
    for(const kind of ['orders','kupa']){
      let afterLegacyCalls=0;const storageV2={persist:()=>({handled:true,emergencyDurable:true,transitioning:true,committed:Promise.resolve(true),seq:1}),afterLegacy:()=>{afterLegacyCalls++}};
      if(kind==='orders'){
        const state=clone(ORDERS_INITIAL_STATE),files={browserStateWritePromise:Promise.resolve(true)},session={localSnapshotSeq:0,cloudRevision:7,storageV2CloudPending:false};const browser=createOrdersStorageBrowser({storageV2,model:{state},files,session,prepareState:clone,prepareCloudState:clone,normalizeState:clone});
        assert.equal(browser.localSnapshot(state,{operations:[{type:'set',field:'__unused',value:true}]}),true);assert.equal(storage.getItem(ORDERS_STORAGE_KEY),null);
      }else{
        const state=clone(KUPA_INITIAL_STATE),files={},session={localSnapshotSeq:0,dbRevision:7,storageV2CloudPending:false};const browser=createKupaStorageBrowser({storageV2,model:{state},files,session,normalizeState:clone,prepareKupaCloudState:clone,idbPut:async()=>true,idbGet:async()=>null});
        assert.equal(browser.persistImmediateBrowserSnapshot(state,7,{operations:[{type:'set',field:'__unused',value:true}]}),true);assert.equal(storage.getItem(KUPA_STORAGE_KEY),null);
      }
      assert.equal(afterLegacyCalls,0);
      while(storage.length)storage.removeItem(storage.key(0));
    }
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});



test('Cloud V2 cutover waits for durable V1 outbox verification and drains an IndexedDB-only Kupa pending record',async()=>{
  const previous=globalThis.localStorage,storage=emergencyStore();globalThis.localStorage=storage;
  try{
    const session={cloudDocumentName:'main',dbRevision:10,localGeneration:1,localSnapshotSeq:0,storageV2CloudPending:false,cloudOutboxCached:null,cloudOutboxCommitPromise:Promise.resolve(),cloudDurabilityDegraded:false},durable=new Map(),deleted=[];
    const pendingRecord=createOutboxRecord({domain:'kupa',documentName:'main',generation:1,mutationSeq:1,baseRevision:10,baseState:{notes:[]},snapshot:{notes:[{id:'legacy-only'}]}});durable.set('cloud-pending-v3',pendingRecord);
    const pending=createKupaStoragePending({session,idbPut:async(_store,key,value)=>{durable.set(key,clone(value));return true},idbGet:async(_store,key)=>clone(durable.get(key)??null),idbDelete:async(_store,key)=>{deleted.push(key);durable.delete(key);return true}});
    assert.equal(pending.cloudPendingExistsSync(),false,'LocalStorage alone does not reveal the durable-only pending record');assert.equal(pending.cloudPendingHeadVerifiedCleanSync(),false,'unverified legacy head is never considered clean');
    let captures=0;const cloudBase={version:2,owner:'kupa:test',epoch:'epoch-1',revision:10,state:clone(KUPA_INITIAL_STATE),projection:'cloud',ackSeq:0},storageV2={primaryReady:true,cloudState:async()=>({seq:0,base:cloudBase,flight:null,control:null,pending:false}),flush:async()=>true,captureCloudCursor:async()=>{captures++;return cloudBase}};
    const browser=createKupaStorageBrowser({storageV2,legacyCloudPendingExists:()=>pending.cloudPendingExistsSync(),legacyCloudHeadVerifiedClean:()=>pending.cloudPendingHeadVerifiedCleanSync(),verifyLegacyCloudPending:()=>pending.getCloudPending(),model:{state:clone(KUPA_INITIAL_STATE)},session,files:{},normalizeState:clone,prepareKupaCloudState:clone,idbPut:async()=>true,idbGet:async()=>null});
    await browser.refreshStorageV2CloudState();assert.equal(browser.storageV2CloudOutboxActive(),false,'V2 is gated before durable legacy verification');assert.equal(await browser.initializeStorageV2CloudCursor(10),false);assert.equal(captures,0);assert.ok(await pending.getCloudPending(),'IndexedDB-only legacy pending is recovered instead of bypassed');assert.equal(browser.storageV2CloudOutboxActive(),false);
    assert.equal(await pending.clearCloudPending(1),true);assert.ok(deleted.includes('cloud-pending-v3'));assert.equal(pending.cloudPendingHeadVerifiedCleanSync(),true);assert.ok(await browser.initializeStorageV2CloudCursor(10));assert.equal(captures,1);assert.equal(browser.storageV2CloudOutboxActive(),true,'V2 activates only after durable V1 drain is verified clean');
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});

test('Kupa Cloud V2 refuses cutover when the durable V1 head cannot be verified',async()=>{
  const previous=globalThis.localStorage,storage=emergencyStore();globalThis.localStorage=storage;
  try{
    const session={cloudDocumentName:'main',dbRevision:10,localGeneration:1,localSnapshotSeq:0,storageV2CloudPending:false,cloudOutboxCached:null,cloudOutboxCommitPromise:Promise.resolve(),cloudDurabilityDegraded:false};
    const pending=createKupaStoragePending({session,idbPut:async()=>true,idbGet:async()=>{throw new Error('injected durable read failure')},idbDelete:async()=>true});
    let captures=0;const cloudBase={version:2,owner:'kupa:test',epoch:'epoch-1',revision:10,state:clone(KUPA_INITIAL_STATE),projection:'cloud',ackSeq:0},storageV2={primaryReady:true,cloudState:async()=>({seq:0,base:cloudBase,flight:null,control:null,pending:false}),flush:async()=>true,captureCloudCursor:async()=>{captures++;return cloudBase}};
    const browser=createKupaStorageBrowser({storageV2,legacyCloudPendingExists:()=>pending.cloudPendingExistsSync(),legacyCloudHeadVerifiedClean:()=>pending.cloudPendingHeadVerifiedCleanSync(),verifyLegacyCloudPending:()=>pending.getCloudPending(),model:{state:clone(KUPA_INITIAL_STATE)},session,files:{},normalizeState:clone,prepareKupaCloudState:clone,idbPut:async()=>true,idbGet:async()=>null});
    await browser.refreshStorageV2CloudState();assert.equal(pending.cloudPendingHeadVerifiedCleanSync(),false);assert.equal(browser.storageV2CloudOutboxActive(),false);assert.equal(await browser.initializeStorageV2CloudCursor(10),false);assert.equal(captures,0,'cursor is not captured after a failed durable legacy-head read');
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});

test('Orders Cloud V2 refuses cutover when the durable V1 head cannot be verified',async()=>{
  const previousStorage=globalThis.localStorage,previousIndexedDb=globalThis.indexedDB,storage=emergencyStore();globalThis.localStorage=storage;delete globalThis.indexedDB;
  try{
    let captures=0;const state=clone(ORDERS_INITIAL_STATE),session={localSnapshotSeq:0,localGeneration:1,cloudRevision:10,lastCloudState:clone(state),storageV2CloudPending:false,ordersOutboxCached:null,ordersOutboxCommitPromise:Promise.resolve()},base={version:2,owner:'orders:test',epoch:'epoch-1',revision:10,state:clone(state),projection:'cloud',ackSeq:0},storageV2={primaryReady:true,cloudState:async()=>({seq:0,base,flight:null,control:null,pending:false}),flush:async()=>true,captureCloudCursor:async()=>{captures++;return base}};
    const browser=createOrdersStorageBrowser({storageV2,model:{state},files:{},session,prepareState:clone,prepareCloudState:clone,normalizeState:clone});await browser.refreshStorageV2CloudState();assert.equal(browser.storageV2CloudOutboxActive(),false,'an unverified legacy head cannot activate V2');assert.equal(await browser.initializeStorageV2CloudCursor(10),false);assert.equal(captures,0,'cursor is not captured after a failed durable legacy-head read');assert.equal(browser.storageV2CloudOutboxActive(),false);
  }finally{if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;if(previousIndexedDb===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previousIndexedDb}
});

test('cloud reset keeps the newest visible state in V2 without a transition compatibility snapshot',async()=>{
  const previous=globalThis.localStorage,storage=emergencyStore();globalThis.localStorage=storage;
  try{
    let releaseReset,startReset;const started=new Promise(resolve=>{startReset=resolve}),released=new Promise(resolve=>{releaseReset=resolve}),model={state:clone(KUPA_INITIAL_STATE)},files={},session={localSnapshotSeq:0,localGeneration:0,dbRevision:12,storageV2CloudPending:false,cloudConflictPending:true};
    const cloudProject=value=>{const next=clone(value);delete next.checks;return next},remote=cloudProject(model.state),storageV2={primaryReady:true,resetCloudHead:async()=>{startReset();await released;return {epoch:'epoch-new',seq:1,ackSeq:0,revision:12}},persist:()=>({handled:true,emergencyDurable:true,transitioning:true,committed:Promise.resolve(true),seq:1}),cloudState:async()=>({seq:1,base:{version:2,owner:'kupa:test',epoch:'epoch-new',revision:12,state:clone(remote),projection:'cloud',ackSeq:0},flight:null,control:null,pending:true,pendingDeleteIntents:{},pendingGeneration:1,pendingMutationType:'edit',pendingSurface:'kupa',afterFlightPending:false,afterFlightDeleteIntents:{},afterFlightGeneration:0,afterFlightMutationType:'autosave',afterFlightSurface:'unknown'})};
    const browser=createKupaStorageBrowser({storageV2,model,files,session,normalizeState:clone,prepareKupaCloudState:cloudProject,idbPut:async()=>true,idbGet:async()=>null});
    const reset=browser.resetStorageV2CloudHead(12,clone(model.state));await started;model.state.notes=[{id:'during-reset',content:'latest-visible-state',createdAt:'2026-09-22',updatedAt:'2026-09-22'}];session.localGeneration=1;assert.equal(browser.persistImmediateBrowserSnapshot(model.state,12,{operations:[{type:'set',field:'__unused',value:true}]}),true);releaseReset();await reset;await files.browserStateWritePromise;
    assert.equal(storage.getItem(KUPA_STORAGE_KEY),null,'the durable V2 reset and edit do not write a full V1 snapshot');assert.equal(session.storageV2CloudPending,true);assert.equal(session.cloudConflictPending,false);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});

test('transition fallback does not enqueue a second legacy epoch install when emergency durability is unavailable',async()=>{
  const previous=globalThis.localStorage,storage=emergencyStore();globalThis.localStorage=storage;
  try{
    let afterLegacyCalls=0;const state=clone(KUPA_INITIAL_STATE),files={},session={localSnapshotSeq:0,dbRevision:9,storageV2CloudPending:false},storageV2={persist:()=>({handled:false,emergencyDurable:false,transitioning:true,committed:Promise.resolve(true),seq:1}),afterLegacy:()=>{afterLegacyCalls++}};
    const browser=createKupaStorageBrowser({storageV2,model:{state},files,session,normalizeState:clone,prepareKupaCloudState:clone,idbPut:async()=>true,idbGet:async()=>null});
    assert.equal(browser.persistImmediateBrowserSnapshot(state,9,{operations:[{type:'set',field:'__unused',value:true}]}),true);assert.equal(afterLegacyCalls,0);assert.equal(JSON.parse(storage.getItem(KUPA_STORAGE_KEY)).snapshotSeq,1);await files.browserStateWritePromise;
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});

function postAckStorageV2({kind}){
  const orders=kind==='orders',full=clone(orders?ORDERS_INITIAL_STATE:KUPA_INITIAL_STATE);delete full.checks;const baseState=clone(full),sentState=clone(full);if(orders)sentState.notes=[{id:'N1',content:'sent'}];else sentState.notes=[{id:'N1',content:'sent',createdAt:'2026-09-22',updatedAt:'2026-09-22'}];
  let acknowledged=false;const prior={seq:1,base:{version:2,owner:`${kind}:test`,epoch:'epoch-1',revision:10,state:clone(baseState),projection:'cloud',ackSeq:0},flight:{version:2,owner:`${kind}:test`,epoch:'epoch-1',operationId:`${kind}-flight`,baseRevision:10,startSeq:1,endSeq:1,snapshot:clone(sentState),deleteIntents:{},generation:1,mutationType:'edit',surface:kind},control:{retry:{attempts:1}},pending:true,pendingDeleteIntents:{},pendingGeneration:1,pendingMutationType:'edit',pendingSurface:kind,afterFlightPending:false,afterFlightDeleteIntents:{},afterFlightGeneration:0,afterFlightMutationType:'autosave',afterFlightSurface:'unknown'};
  const storageV2={primaryReady:true,cloudState:async()=>{if(acknowledged)throw new Error('injected post-commit read failure');return clone(prior)},acknowledgeFlight:async (operationId,_revision,_state,options)=>{assert.equal(operationId,prior.flight.operationId);assert.equal(options.expectedSeq,prior.seq,'ACK must fence the exact visible local sequence');acknowledged=true;return {operationId,revision:11,ackSeq:1}}};
  const session=orders?{localSnapshotSeq:1,cloudRevision:10,storageV2CloudPending:true,cloudConflictBlocked:false}:{localSnapshotSeq:1,dbRevision:10,storageV2CloudPending:true,cloudConflictPending:false};
  if(orders)return {browser:createOrdersStorageBrowser({storageV2,model:{state:clone(full)},files:{},session,prepareState:clone,prepareCloudState:value=>{const next=clone(value);delete next.checks;return next},normalizeState:clone}),session,sentState,operationId:prior.flight.operationId};
  return {browser:createKupaStorageBrowser({storageV2,model:{state:clone(KUPA_INITIAL_STATE)},session,files:{},normalizeState:clone,prepareKupaCloudState:value=>{const next=clone(value);delete next.checks;return next},idbPut:async()=>true,idbGet:async()=>null}),session,sentState,operationId:prior.flight.operationId};
}

test('Orders browser adapter keeps an exact post-ACK cache when the verification read fails after commit',async()=>{
  const f=postAckStorageV2({kind:'orders'});await f.browser.refreshStorageV2CloudState();const state=await f.browser.acknowledgeStorageV2CloudFlight(f.operationId,11,f.sentState,{currentState:clone(ORDERS_INITIAL_STATE)});assert.equal(state.base.revision,11);assert.equal(state.base.ackSeq,1);assert.equal(state.flight,null);assert.equal(state.control,null);assert.equal(state.pending,false);assert.equal(f.session.storageV2CloudPending,false);
});

test('Kupa browser adapter keeps an exact post-ACK cache when the verification read fails after commit',async()=>{
  const f=postAckStorageV2({kind:'kupa'});await f.browser.refreshStorageV2CloudState();const state=await f.browser.acknowledgeStorageV2CloudFlight(f.operationId,11,f.sentState,{currentState:clone(KUPA_INITIAL_STATE)});assert.equal(state.base.revision,11);assert.equal(state.base.ackSeq,1);assert.equal(state.flight,null);assert.equal(state.control,null);assert.equal(state.pending,false);assert.equal(f.session.storageV2CloudPending,false);
});
