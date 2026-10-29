import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseFileQueue} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-file-queue.js';
const file=(name,bytes)=>new File([bytes],name,{type:'application/pdf'});
const validate=async file=>({file,name:file.name,type:file.type});
const hash=async file=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
const check=()=>{};

test('repeated and renamed copies are definite duplicates, while same name/size with different bytes remains distinct',async()=>{
 const queue=createExpenseFileQueue({validate,hash});const original=file('invoice.pdf','one');
 const first=await queue.prepare([original],[],check);
 const repeated=await queue.prepare([original,file('renamed.pdf','one'),file('invoice.pdf','two')],first.accepted,check);
 assert.equal(repeated.duplicates.length,2);assert.equal(repeated.accepted.length,1);assert.equal(repeated.accepted[0].file.size,original.size);
 assert.equal(first.accepted.length,1);
});

test('duplicates in a batch do not consume quota and full queues can report an already-added file',async()=>{
 const queue=createExpenseFileQueue({validate,hash});const files=Array.from({length:20},(_,n)=>file(n+'.pdf',String(n)));
 const first=await queue.prepare(files,[],check);assert.equal(first.accepted.length,20);
 const repeated=await queue.prepare([file('copy.pdf','0')],first.accepted,check);assert.equal(repeated.accepted.length,0);assert.equal(repeated.duplicates.length,1);
 await assert.rejects(queue.prepare([file('new.pdf','different')],first.accepted,check),/20/);
 const batch=await queue.prepare([file('a.pdf','same'),file('b.pdf','same')],[],check);assert.equal(batch.accepted.length,1);assert.equal(batch.duplicates.length,1);
});

test('failed validation and account changes leave the existing queue untouched',async()=>{
 const existing=[await validate(file('keep.pdf','keep'))];let current=true;
 const queue=createExpenseFileQueue({validate:async file=>{if(file.name==='bad.pdf')throw Error('invalid file');return validate(file);},hash});
 await assert.rejects(queue.prepare([file('new.pdf','new'),file('bad.pdf','bad')],existing,check),/invalid file/);assert.equal(existing.length,1);
 const scoped=createExpenseFileQueue({validate,hash:async file=>{current=false;return hash(file);}});
 await assert.rejects(scoped.prepare([file('new.pdf','new')],[],()=>{if(!current)throw Error('account changed');}),/account changed/);
 assert.equal(existing[0].name,'keep.pdf');
});

test('hash caching is memory-only, reusable and reset for a new scope',async()=>{
 let calls=0;const queue=createExpenseFileQueue({validate,hash:async file=>{calls++;return hash(file);}});const original=file('keep.pdf','keep');
 const first=await queue.prepare([original],[],check);await queue.prepare([original],first.accepted,check);assert.equal(calls,1);
 queue.reset();await queue.prepare([original],[],check);assert.equal(calls,2);
});

test('selection and new batches retain the original queue order',async()=>{
 const queue=createExpenseFileQueue({validate,hash});
 const {accepted:[first,second,third]}=await queue.prepare(['first','second','third'].map(name=>file(name+'.pdf',name)),[],check);
 assert.deepEqual(queue.items(third,[first,second]),[first,second,third]);
 const {accepted:[fourth]}=await queue.prepare([file('fourth.pdf','fourth')],[third,first,second],check);
 assert.deepEqual(queue.items(second,[fourth,third,first]),[first,second,third,fourth]);
 assert.deepEqual(queue.items(null,[third,fourth,second]),[second,third,fourth]);
});


test('resource ceilings bound selection and unique retained bytes without allocating large file buffers',async()=>{
 const bytes=20*1024*1024;const virtual=n=>({name:n+'.pdf',size:bytes,key:n});
 const queue=createExpenseFileQueue({validate:async file=>({file,name:file.name}),hash:async file=>file.key.toString(16).padStart(64,'0')});
 const first=await queue.prepare(Array.from({length:5},(_,n)=>virtual(n)),[],check);
 assert.equal(first.accepted.length,5);await assert.rejects(queue.prepare([virtual(6)],first.accepted,check),/100MB/);
 await assert.rejects(queue.prepare(Array.from({length:21},(_,n)=>virtual(n)),[],check),/20/);
 assert.equal(first.accepted.length,5);
});
