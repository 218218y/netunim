import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeArray} from '../netunim-orders/site/assets/js/sync/merge-records.js';
import {mergeRecordArray} from '../netunim-kupa/site/assets/js/sync/merge-records.js';
import {createSyncMerge} from '../netunim-orders/site/assets/js/sync/merge.js';

const copy = structuredClone;
const base = {id:'A',supplierId:'S',sequence:1,debit:100,credit:0,invoiceReceived:false,signed:false,supplied:false,note:'before',message:'old',updatedAt:'2026-10-01T00:00:00Z'};
function orders(b,l,r,label='transaction') {const conflicts=[];return {rows:mergeArray(b,l,r,'id',conflicts,label),conflicts}}
function kupa(b,l,r,path='cash') {const conflicts=[];return {rows:mergeRecordArray(b,l,r,'id',path,conflicts),conflicts}}

test('supplier workflow and commentary merge independently, symmetrically and with latest edit metadata',()=>{
  for (const field of ['invoiceReceived','signed','supplied']) {
    const local={...base,[field]:true,updatedAt:'2026-10-02T00:00:00Z'},remote={...base,note:'after',updatedAt:'2026-10-03T00:00:00Z'};
    const expected={...local,note:'after',updatedAt:remote.updatedAt};
    for (const [l,r] of [[local,remote],[remote,local]]) {
      const result=orders([base],[l],[r]);assert.deepEqual(result.conflicts,[]);assert.deepEqual(result.rows,[expected]);
    }
    assert.equal(base.note,'before');
  }
});

test('cash and rights commentary merge without mixing monetary edits',()=>{
  const b={id:'C',amount:20,date:'2026-10-01',description:'old',note:'old'};
  for (const path of ['cash','rights','expenses']) {
    const result=kupa([b],[{...b,description:'new'}],[{...b,note:'new'}],path);
    assert.deepEqual(result.conflicts,[]);assert.deepEqual(result.rows,[{...b,description:'new',note:'new'}]);
    assert.equal(kupa([b],[{...b,amount:30}],[{...b,note:'new'}],path).conflicts.length,1);
  }
});

test('same-field contradictions, financial/identity/unknown edits, delete/edit and concurrent births stay conflicts',()=>{
  const remote={...base,note:'remote'};
  for (const patch of [{note:'local'},{debit:200},{supplierId:'other'},{futureField:true},{updatedAt:'invalid'}])
    assert.equal(orders([base],[{...base,...patch}],[remote]).conflicts.length,1,JSON.stringify(patch));
  assert.equal(orders([base],[],[remote]).conflicts.length,1);
  assert.equal(orders([], [base], [remote]).conflicts.length,1);
  assert.equal(orders([base],[{...base,message:'new'}],[remote],'inventoryItem').conflicts.length,1);
  assert.equal(kupa([base],[{...base,message:'new'}],[remote],'checks').conflicts.length,1);
});

test('a move can combine with commentary but competing topology changes are fenced across rows',()=>{
  const second={...base,id:'B',sequence:2},third={...base,id:'C',sequence:3};
  const b={transactions:[base,second,third]},merge=createSyncMerge({normalizeState:copy}).merge3;
  const local={transactions:[{...base,sequence:2},{...second,sequence:1},third]};
  const remote={transactions:[{...base,note:'after'},second,third]};
  const combined=merge(b,local,remote);
  assert.deepEqual(combined.conflicts,[]);assert.equal(combined.state.transactions[0].note,'after');assert.equal(combined.state.transactions[0].sequence,2);
  const concurrent={transactions:[base,{...second,sequence:3},{...third,sequence:2}]};
  assert.ok(merge(b,local,concurrent).conflicts.includes('transactionOrder'));
});

test('1000 deterministic independent edits converge with no duplicate rows or field loss',()=>{
  for (let i=0;i<1000;i++) {
    const b={...base,id:`T${i}`,sequence:i+1},l={...b,invoiceReceived:true,message:`L${i}`},r={...b,note:`R${i}`};
    const result=orders([b],[l],[r]);assert.deepEqual(result.conflicts,[]);
    assert.deepEqual(result.rows,[{...l,note:r.note}]);
    assert.deepEqual(orders([b],[r],[l]),result);
  }
});
