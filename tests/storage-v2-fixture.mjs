import assert from 'node:assert/strict';
import {readStorageRecord} from '../shared/storage-journal-model.js';
const clone=structuredClone;
export function emergencyStore({failWrites=false}={}){const rows=new Map();return {get length(){return rows.size},key:index=>[...rows.keys()][index]??null,getItem:key=>rows.get(key)??null,setItem:(key,value)=>{if(failWrites)throw new Error('quota');rows.set(key,value)},removeItem:key=>rows.delete(key)}}
export function memoryDb(){
  let checkpoints=null,metadata=null,journal=[],bases=null,flights=null,controls=null;
  const scoped=(epoch,writer)=>{assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer)};
  return {
    async load(){return clone({checkpoints,metadata,journal,bases,flights,controls})},
    async install(_owner,checkpoint,writer,{expectedEpoch=null}={}){assert.equal(metadata?.epoch??null,expectedEpoch);const data=readStorageRecord(checkpoint);checkpoints=clone(checkpoint);metadata={epoch:data.epoch,seq:data.seq,writer};journal=[];bases=null;flights=null;controls=null},
    async initializeCloudHead(_owner,checkpoint,base,writer,entry=null){
      if(metadata)throw new Error('storage_initialization_exists');
      const data=readStorageRecord(checkpoint);checkpoints=clone(checkpoint);bases=clone(base);journal=entry?[clone(entry)]:[];metadata={epoch:data.epoch,seq:entry?1:0,writer};
    },
    async replaceShadowWithCloudHead(_owner,expectedEpoch,expectedSeq,checkpoint,base,writer,entry=null){
      assert.equal(metadata?.epoch,expectedEpoch);assert.equal(metadata?.seq,expectedSeq);assert.equal(bases,null);assert.equal(flights,null);assert.equal(controls,null);
      const data=readStorageRecord(checkpoint);checkpoints=clone(checkpoint);bases=clone(base);journal=entry?[clone(entry)]:[];metadata={epoch:data.epoch,seq:entry?1:0,writer};
    },
    async claim(_owner,epoch,writer){assert.equal(metadata.epoch,epoch);metadata={...metadata,writer}},
    async append(_owner,epoch,writer,record){scoped(epoch,writer);const data=readStorageRecord(record);assert.equal(data.seq,metadata.seq+1);journal.push(clone(record));metadata={...metadata,seq:data.seq}},
    async compact(_owner,epoch,writer,checkpoint){scoped(epoch,writer);checkpoints=clone(checkpoint);const seq=readStorageRecord(checkpoint).seq,ack=bases?readStorageRecord(bases).ackSeq:seq;journal=journal.filter(row=>row.data.seq>Math.min(seq,ack))},
    async setBase(_owner,epoch,writer,base){scoped(epoch,writer);assert.equal(flights,null);bases=clone(base)},
    async beginFlight(_owner,epoch,writer,flight){scoped(epoch,writer);if(flights)return clone(flights);flights=clone(flight);return clone(flight)},
    async acknowledge(_owner,epoch,writer,id,base,{checkpoint=null,control=null}={}){scoped(epoch,writer);assert.equal(readStorageRecord(flights).operationId,id);bases=clone(base);if(checkpoint)checkpoints=clone(checkpoint);flights=null;controls=control&&clone(control)},
    async rejectFlight(_owner,epoch,writer,id,base,{checkpoint,expectedSeq,control=null}={}){scoped(epoch,writer);assert.equal(readStorageRecord(flights).operationId,id);assert.equal(expectedSeq,metadata.seq);checkpoints=clone(checkpoint);bases=clone(base);flights=null;controls=control&&clone(control)},
    async setControl(_owner,epoch,writer,control){scoped(epoch,writer);controls=clone(control)},
    async clearControl(_owner,epoch,writer){scoped(epoch,writer);controls=null},
    async adoptCloudHead(_owner,epoch,writer,checkpoint,base){scoped(epoch,writer);assert.equal(flights,null);assert.equal(readStorageRecord(bases).ackSeq,metadata.seq);checkpoints=clone(checkpoint);bases=clone(base);controls=null},
    async resetState(_owner,epoch,writer,checkpoint){scoped(epoch,writer);const next=readStorageRecord(checkpoint);checkpoints=clone(checkpoint);metadata={epoch:next.epoch,seq:0,writer};journal=[];bases=null;flights=null;controls=null},
  };
}
