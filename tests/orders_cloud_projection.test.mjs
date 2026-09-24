import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateSnapshots} from '../netunim-orders/site/assets/js/state/snapshots.js';
import {prepareStateData} from '../netunim-orders/site/assets/js/state/serialization.js';

test('Orders V2 cloud projection is stable across serializer timestamps',()=>{
  const state={notes:[],checks:[{id:'shared-only'}],_meta:{localSnapshotSeq:4,savedAt:'2000-01-01T00:00:00Z'}};
  let timestamp=0;
  const snapshots=createStateSnapshots({model:{state},prepareState:value=>{
    const result=prepareStateData(value);
    result._meta.savedAt=`2026-09-24T00:00:0${timestamp++}Z`;
    return result;
  }});
  const first=snapshots.prepareCloudState(state);
  const second=snapshots.prepareCloudState(state);
  assert.deepEqual(first,second);
  assert.equal(Object.hasOwn(first,'checks'),false);
  assert.equal(Object.hasOwn(first._meta,'savedAt'),false);
  assert.equal(first._meta.localSnapshotSeq,4);
  assert.equal(state._meta.savedAt,'2000-01-01T00:00:00Z');
});
