import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';
import {mergeArray} from '../netunim-orders/site/assets/js/sync/merge-records.js';

const schema={collections:['transactions'],fields:[]},validate=()=>{};
const put=(record,mode='replace',index=0)=>({type:'put',collection:'transactions',id:record.id,record,mode,index});
for(const count of [100,500,2000])test(`${count} rapid mutations survive delayed IDB, restart and lost ACK without loss or duplicate IDs`,async()=>{
  const db=memoryDb(),emergency=emergencyStore();let release,next=0;
  const gate=new Promise(resolve=>{release=resolve});
  const delayed={...db,append:async(...args)=>{await gate;return db.append(...args)}};
  const ports={owner:'stress',schema,validate,emergency,operationId:()=>`stress-${++next}`};
  const writer=createStorageJournal({...ports,db:delayed});
  let row={id:'A',sequence:1,invoiceReceived:false,note:'base'};
  const initial={transactions:[row]};await writer.initializeCloudHead(10,initial);
  const receipts=[];
  for(let i=1;i<=count;i++){
    row={...row,invoiceReceived:i%2===1,note:`note-${i}`};
    receipts.push(writer.append([put(row)],{generation:i}));
  }
  assert.equal(receipts.filter(receipt=>receipt.emergencyDurable).length,64);
  assert.equal(emergency.length,64);
  assert.equal((await db.load()).metadata.seq,0,'IDB has not yet acknowledged any change');
  const crashView=await createStorageJournal({...ports,db}).recover();
  assert.equal(crashView.seq,64,'only the verified emergency prefix is crash-durable before IDB');
  assert.equal(crashView.state.transactions[0].note,'note-64');
  release();await Promise.all(receipts.map(receipt=>receipt.committed));
  assert.equal(emergency.length,0);
  const ids=receipts.map(receipt=>receipt.operationId);assert.equal(new Set(ids).size,count);
  const reopened=createStorageJournal({...ports,db});await reopened.open();
  const recovered=await reopened.recover();assert.equal(recovered.seq,count);
  assert.deepEqual(recovered.state,{transactions:[row]});
  const flight=await reopened.materializeFlight({baseRevision:10,operationId:'cloud-first'});
  assert.deepEqual(flight.snapshot,recovered.state);assert.equal(flight.endSeq,count);
  // The server committed, but the response was lost. A restarted client must
  // resend exactly the same operation and snapshot, even after a new local edit.
  const cloud=structuredClone(flight.snapshot),restarted=createStorageJournal({...ports,db});await restarted.open();
  const later={...row,note:'after-flight'};
  await restarted.append([put(later)],{generation:count+1}).committed;
  assert.deepEqual(await restarted.materializeFlight(),flight);
  await restarted.acknowledge(flight.operationId,11,cloud);
  assert.equal((await restarted.cloudState()).base.ackSeq,count);
  assert.equal((await restarted.cloudState()).pending,true);
  const tail=await restarted.materializeFlight({baseRevision:11,operationId:'cloud-tail'});assert.notEqual(tail.operationId,flight.operationId);
  assert.equal(tail.startSeq,count+1);assert.equal(tail.endSeq,count+1);
  await restarted.acknowledge(tail.operationId,12,tail.snapshot);
  assert.equal((await restarted.cloudState()).pending,false);
  assert.deepEqual((await restarted.recover()).state,tail.snapshot);
  assert.deepEqual(tail.snapshot,{transactions:[later]});
});

test('a rapid insert, immediate edit, resequence and deletion replay exactly after restart',async()=>{
  const db=memoryDb(),emergency=emergencyStore();let n=0;
  const ports={owner:'structure',schema,validate,db,emergency,operationId:()=>`structure-${++n}`};
  const writer=createStorageJournal(ports);await writer.initializeCloudHead(1,{transactions:[{id:'A',sequence:1}]});
  const writes=[
    writer.append([put({id:'B',sequence:2,note:''},'insert',1)]),
    writer.append([put({id:'B',sequence:2,note:'edited immediately'})]),
    writer.append([put({id:'A',sequence:2}),put({id:'B',sequence:1,note:'edited immediately'})]),
    writer.append([{type:'delete',collection:'transactions',id:'A'}],{deleteIntents:{transactions:['A']}}),
  ];
  await Promise.all(writes.map(write=>write.committed));
  const recovered=await createStorageJournal(ports).open();
  assert.deepEqual(recovered.state,{transactions:[{id:'B',sequence:1,note:'edited immediately'}]});
  const stored=await db.load();assert.equal(stored.journal.length,4);
});

test('two journals converge after 1000 interleaved edits to independent fields of the same record',async()=>{
  const initial={transactions:[{id:'A',sequence:1,invoiceReceived:false,note:'base'}]};let id=0;
  const clients=[0,1].map(()=>createStorageJournal({owner:'same-account',schema,validate,db:memoryDb(),emergency:emergencyStore(),operationId:()=>`pair-${++id}`}));
  await Promise.all(clients.map(client=>client.initializeCloudHead(10,initial)));
  const rows=[structuredClone(initial.transactions[0]),structuredClone(initial.transactions[0])],writes=[];
  for(let i=1;i<=500;i++)for(let c=0;c<2;c++){
    rows[c]={...rows[c],...(c===0?{invoiceReceived:i%3===2}:{note:`remote-${i}`})};
    writes.push(clients[c].append([put(rows[c])],{generation:i}).committed);
  }
  await Promise.all(writes);
  const [a,b]=clients,flightB=await b.materializeFlight({baseRevision:10,operationId:'pair-cloud-B'});
  let cloud=flightB.snapshot;await b.acknowledge(flightB.operationId,11,cloud);
  const flightA=await a.materializeFlight({baseRevision:10,operationId:'pair-cloud-A'}),conflicts=[];
  const merged={transactions:mergeArray(initial.transactions,flightA.snapshot.transactions,cloud.transactions,'id',conflicts,'transaction')};
  assert.deepEqual(conflicts,[]);
  await a.rejectAndRebase(flightA.operationId,11,cloud,{checkpointState:merged,expectedSeq:500});
  const rotated=await a.materializeFlight({baseRevision:11,operationId:'pair-cloud-A-rebased'});
  cloud=rotated.snapshot;await a.acknowledge(rotated.operationId,12,cloud);
  assert.equal((await a.cloudState()).pending,false);
  assert.deepEqual((await a.recover()).state,cloud);
  // B has no pending operations and can adopt the new cloud head normally.
  await b.adoptCloudHead(12,cloud,cloud);
  assert.deepEqual((await b.recover()).state,cloud);
  assert.deepEqual(cloud,{transactions:[{...rows[0],note:rows[1].note}]});
});
