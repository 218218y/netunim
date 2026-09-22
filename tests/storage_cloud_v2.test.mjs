import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {readStorageRecord} from '../shared/storage-journal-model.js';

const clone=structuredClone;
function emergencyStore(){const rows=new Map();return {get length(){return rows.size},key(index){return [...rows.keys()][index]??null},getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)}}
function memoryDb(){
  let checkpoints=null,metadata=null,journal=[],bases=null,flights=null,controls=null;
  const load=async()=>clone({checkpoints,metadata,journal,bases,flights,controls});
  return {
    load,
    async install(_owner,checkpoint,writer){const data=readStorageRecord(checkpoint);checkpoints=clone(checkpoint);metadata={epoch:data.epoch,seq:data.seq,writer};journal=[];bases=null;flights=null;controls=null},
    async claim(_owner,epoch,writer){assert.equal(metadata.epoch,epoch);metadata={...metadata,writer}},
    async append(_owner,epoch,writer,record){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);const data=readStorageRecord(record);assert.equal(data.seq,metadata.seq+1);journal.push(clone(record));metadata={...metadata,seq:data.seq}},
    async compact(_owner,epoch,writer,checkpoint){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);checkpoints=clone(checkpoint);const seq=readStorageRecord(checkpoint).seq,ack=bases?readStorageRecord(bases).ackSeq:seq;journal=journal.filter(row=>row.data.seq>Math.min(seq,ack))},
    async replaceCheckpoint(_owner,epoch,writer,checkpoint){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(readStorageRecord(checkpoint).seq,metadata.seq);checkpoints=clone(checkpoint)},
    async setBase(_owner,epoch,writer,base){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(flights,null);bases=clone(base)},
    async beginFlight(_owner,epoch,writer,flight){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);if(flights)return clone(flights);flights=clone(flight);return clone(flight)},
    async acknowledge(_owner,epoch,writer,operationId,base,{checkpoint=null,control=null}={}){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(readStorageRecord(flights).operationId,operationId);bases=clone(base);if(checkpoint)checkpoints=clone(checkpoint);flights=null;controls=control&&clone(control);return true},
    async rejectFlight(_owner,epoch,writer,operationId,base,control=null){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(readStorageRecord(flights).operationId,operationId);bases=clone(base);flights=null;controls=control&&clone(control);return true},
    async setControl(_owner,epoch,writer,control){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);controls=clone(control);return true},
    async clearControl(){controls=null;return true},
    async adoptCloudHead(_owner,epoch,writer,checkpoint,base){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);assert.equal(flights,null);assert.equal(readStorageRecord(bases).ackSeq,metadata.seq);checkpoints=clone(checkpoint);bases=clone(base);controls=null;return true},
    async resetCloudHead(_owner,epoch,writer,checkpoint,base){assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer);const cp=readStorageRecord(checkpoint),nextBase=readStorageRecord(base);assert.equal(cp.epoch,nextBase.epoch);assert.equal(cp.seq,0);assert.equal(nextBase.ackSeq,0);checkpoints=clone(checkpoint);metadata={epoch:cp.epoch,seq:0,writer};journal=[];bases=clone(base);flights=null;controls=null;return true},
  }
}

const schema={collections:['notes'],fields:[]};
const put=(id,text)=>({type:'put',collection:'notes',mode:'replace',id,record:{id,text}});

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
  await journal.rejectAndRebase('flight-2',12,{notes:[{id:'A',text:'remote'}]},{control:{conflict:{kind:'entity-conflict'}}});cloud=await journal.cloudState();assert.equal(cloud.flight,null);assert.equal(cloud.base.revision,12);assert.equal(cloud.base.ackSeq,1);assert.equal(cloud.control.conflict.kind,'entity-conflict');
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
