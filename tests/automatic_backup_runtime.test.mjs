import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomaticBackupRuntime} from '../shared/automatic-backup-runtime.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function fixture(write){
  const jobs=new Map(),errors=[];let id=0,target={folder:'A'};
  const timers={setTimeout:(run,delay)=>{jobs.set(++id,{run,delay});return id},clearTimeout:key=>jobs.delete(key)};
  const runtime=createAutomaticBackupRuntime({readTarget:()=>target,clonePayload:structuredClone,write,timers,onError:error=>errors.push(error)});
  const fire=()=>{const [key,task]=[...jobs.entries()][0];jobs.delete(key);task.run()};
  return {runtime,jobs,errors,fire,setTarget:value=>{target=value}};
}
test('backup owner serializes active writes, coalesces unstarted inputs and detaches submission data',async()=>{
  const entered=gate(),held=gate(),writes=[];
  const f=fixture(async(_target,payload)=>{writes.push(payload.note);if(writes.length===1){entered.resolve();await held.promise}return payload.note});
  const original={note:'first'},first=f.runtime.submit(original);await entered.promise;original.note='mutated';
  const second=f.runtime.submit({note:'superseded'}),last=f.runtime.submit({note:'latest'});
  held.resolve();assert.deepEqual(await Promise.all([first,second,last]),['first',null,'latest']);
  assert.deepEqual(writes,['first','latest']);assert.equal(f.runtime.isPending(),false);
});
test('a deferred backup ready during the original operation survives completion and runs serially',async()=>{
  const entered=gate(),held=gate();let runs=0;
  const f=fixture(async(_target,_payload,continuation)=>{if(++runs===1){continuation.defer(1000);entered.resolve();await held.promise}return 'written'});
  const first=f.runtime.submit({note:'retained'});await entered.promise;f.fire();await settle();assert.equal(runs,1);
  held.resolve();await first;await f.runtime.drain();assert.equal(runs,2);assert.equal(f.runtime.isPending(),false);
});
test('invalid individual deadlines retain a valid queued obligation, and long deadlines stay within native timer limits',async()=>{
  const f=fixture(async()=> 'saved');
  f.runtime.schedule({},2_147_483_648);assert.equal([...f.jobs.values()][0].delay,2_147_483_647);
  for(const delay of [-1,NaN,Infinity])assert.throws(()=>f.runtime.schedule({},delay),/delay_required/);
  assert.equal(f.jobs.size,1);f.runtime.dispose();assert.equal(f.jobs.size,0);await f.runtime.drain();
});
test('a cancelled callback cannot re-enter even after the same directory is selected again',async()=>{
  let writes=0;const f=fixture(async()=>{writes++;return 'saved'});
  f.runtime.schedule({},1000);const stale=[...f.jobs.values()][0].run;f.runtime.cancelPending();
  stale();await f.runtime.drain();assert.equal(writes,0);assert.equal(f.runtime.isPending(),false);
});
