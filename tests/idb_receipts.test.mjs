import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {completeIndexedDbTransaction as complete} from '../shared/indexed-db-connection.js';

function transaction(){
  return {error:null,abort(){queueMicrotask(()=>this.onabort())}};
}
test('prepared results wait for complete; abort after request success rejects',async()=>{
  const tx=transaction();let settled=false;
  const writing=complete(()=>tx,(_tx,done)=>{done(true)}).finally(()=>{settled=true});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  tx.oncomplete();assert.equal(await writing,true);
  const aborted=transaction(),failed=complete(()=>aborted,(_tx,done)=>{done(true);aborted.abort()});
  await assert.rejects(failed,/transaction_aborted/);
});
test('synchronous failures abort and retain even falsy causes; unfinished work grants no receipt',async()=>{
  for(const cause of [new Error('quota'),null,0]){
    const tx=transaction();
    await assert.rejects(complete(()=>tx,()=>{throw cause}),error=>error===cause);
  }
  const tx=transaction(),missing=complete(()=>tx,()=>{});
  await new Promise(resolve=>setImmediate(resolve));tx.oncomplete();
  await assert.rejects(missing,/transaction_unfinished/);
});
test('real-body mutation that ACKs an abort violates the receipt contract',async()=>{
  const source=readFileSync(new URL('../shared/indexed-db-connection.js',import.meta.url),'utf8');
  const original="tx.onabort=()=>reject(failure?failure.cause:tx.error||new Error(abortCode));";
  assert.ok(source.includes(original));
  const mutated=source.replace(original,'tx.onabort=()=>resolve(outcome.value);');
  const {completeIndexedDbTransaction:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(mutated).toString('base64'));
  const tx=transaction();assert.equal(await unsafe(()=>tx,(_tx,done)=>{done(true);tx.abort()}),true);
});
