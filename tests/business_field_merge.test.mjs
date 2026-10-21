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

const transaction=(id,supplierId,sequence)=>({...base,id,supplierId,sequence});
const sequenced=rows=>rows.map((row,index)=>({...row,sequence:index+1}));
function symmetricOrder(b,l,r,expected){
  const forward=orders(b,l,r),backward=orders(b,r,l);
  assert.deepEqual(forward.conflicts,[]);
  assert.deepEqual(backward,forward);
  for(const [supplier,ids] of Object.entries(expected)){
    const rows=forward.rows.filter(row=>row.supplierId===supplier).sort((a,b)=>a.sequence-b.sequence);
    assert.deepEqual(rows.map(row=>row.id),ids);
    assert.deepEqual(rows.map(row=>row.sequence),rows.map((_,i)=>i+1));
  }
  return forward;
}
test('independent births in different suppliers merge without topology conflicts',()=>{
  const b=[transaction('A','S1',1)];
  symmetricOrder(b,[...b,transaction('B','S2',1)],[...b,transaction('C','S3',1)],{S1:['A'],S2:['B'],S3:['C']});
});
test('concurrent inserts in one supplier preserve anchors and deterministically resequence',()=>{
  const a=transaction('A','S',1),z=transaction('Z','S',2),b=[a,z];
  const merged=symmetricOrder(b,sequenced([a,transaction('B','S',0),z]),sequenced([a,transaction('C','S',0),z]),{S:['A','B','C','Z']});
  assert.deepEqual(orders(merged.rows,merged.rows,merged.rows),merged);
});
test('reorders in different supplier cards and insertion versus commentary merge',()=>{
  const b=['A','B','C'].map((id,i)=>transaction(id,'S1',i+1)).concat(['D','E','F'].map((id,i)=>transaction(id,'S2',i+1)));
  const l=sequenced([b[1],b[0],b[2]]).concat(b.slice(3));
  const r=b.slice(0,3).concat(sequenced([b[3],b[5],b[4]]));
  symmetricOrder(b,l,r,{S1:['B','A','C'],S2:['D','F','E']});
  const result=symmetricOrder(b,[...b,transaction('G','S1',4)],b.map(row=>row.id==='A'?{...row,note:'changed'}:row),{S1:['A','B','C','G'],S2:['D','E','F']});
  assert.equal(result.rows.find(row=>row.id==='A').note,'changed');
});
test('delete versus moved row and incompatible insertion anchors remain conflicts',()=>{
  const b=['A','B','C'].map((id,i)=>transaction(id,'S',i+1));
  assert.ok(orders(b,b.slice(1),sequenced([b[1],b[0],b[2]])).conflicts.length);
  assert.ok(orders(b,sequenced([b[0],transaction('X','S',0),b[1],b[2]]),sequenced([b[1],b[0],b[2]])).conflicts.includes('transactionOrder'));
});
