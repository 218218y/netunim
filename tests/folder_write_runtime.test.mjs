import test from 'node:test';
import assert from 'node:assert/strict';
import {createFolderWriteRuntime} from '../netunim-orders/site/assets/js/storage/folder-write-runtime.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(write){
  let target={folder:'A'},writable=true;const rows=[],errors=[];
  const runtime=createFolderWriteRuntime({readTarget:()=>target,clonePayload:structuredClone,canStart:()=>writable,
    write:async(...args)=>{rows.push(args);return write?write(...args):args[3].begin()},onError:error=>errors.push(error)});
  return {runtime,rows,errors,select:value=>{target=value},setWritable:value=>{writable=value}};
}
test('adjacent unstarted mirrors coalesce detached latest input and retain a forced safety copy',async()=>{
  const f=fixture(),first=f.runtime.mirror({note:'first'},true),payload={note:'latest'};
  const second=f.runtime.mirror(payload);payload.note='mutated after submission';
  assert.deepEqual(await Promise.all([first,second]),[true,true]);await f.runtime.drain();
  assert.equal(f.rows.length,1);assert.deepEqual(f.rows[0][1],{note:'latest'});assert.equal(f.rows[0][2].forceBackup,true);
});
test('explicit snapshots are FIFO barriers between mirror obligations',async()=>{
  const f=fixture(),jobs=[f.runtime.mirror({note:'before'}),f.runtime.snapshot({note:'safety'},true),f.runtime.mirror({note:'after'})];
  assert.deepEqual(await Promise.all(jobs),[true,true,true]);await f.runtime.drain();
  assert.deepEqual(f.rows.map(row=>row[1].note),['before','safety','after']);
});
test('cancel rejects queued work and preflight without aborting a started write',async()=>{
  const entered=gate(),held=gate();let started=false;
  const f=fixture(async(_target,_payload,_command,scope)=>{started=scope.begin();entered.resolve();await held.promise;assert.equal(scope.isCurrent(),false);return scope.begin()});
  const first=f.runtime.snapshot({note:'started'},true);await entered.promise;
  const queued=f.runtime.snapshot({note:'discard'});f.runtime.cancelPending();
  assert.equal(await queued,false);assert.equal(started,true);
  let drained=false;const draining=f.runtime.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);
  held.resolve();assert.equal(await first,true);await draining;assert.equal(f.rows.length,1);
});
test('cancelled asynchronous preflight never starts a file effect',async()=>{
  const entered=gate(),held=gate();
  const f=fixture(async(_target,_payload,_command,scope)=>{entered.resolve();await held.promise;return scope.begin()});
  const writing=f.runtime.snapshot({note:'preflight'});await entered.promise;f.runtime.cancelPending();held.resolve();
  assert.equal(await writing,false);await f.runtime.drain();
});
test('target and write authority are checked before queued work starts',async()=>{
  const f=fixture(),stale=f.runtime.snapshot({note:'A'});f.select({folder:'B'});
  assert.equal(await stale,false);assert.equal(f.rows.length,0);await f.runtime.drain();
  const revoked=f.runtime.snapshot({note:'B'});f.setWritable(false);
  assert.equal(await revoked,false);assert.equal(await f.runtime.snapshot({note:'secondary'}),false);assert.equal(f.rows.length,0);
});
test('dispose is idempotent and drains accepted work while rejecting future commands',async()=>{
  const entered=gate(),held=gate();
  const f=fixture(async(_target,_payload,_command,scope)=>{assert.equal(scope.begin(),true);entered.resolve();await held.promise;return scope.begin()});
  const writing=f.runtime.snapshot({note:'accepted'});await entered.promise;
  assert.equal(f.runtime.dispose(),true);assert.equal(f.runtime.dispose(),false);
  assert.equal(await f.runtime.mirror({note:'late'}),false);held.resolve();assert.equal(await writing,true);await f.runtime.drain();assert.equal(f.runtime.isPending(),false);
});
test('a receipt consumer may submit another command as the current drain completes',async()=>{
  const f=fixture();
  const consumer=f.runtime.snapshot({note:'first'}).then(()=>f.runtime.snapshot({note:'receipt followup'}));
  assert.equal(await consumer,true);await f.runtime.drain();assert.deepEqual(f.rows.map(row=>row[1].note),['first','receipt followup']);
});
test('a failed write settles its receipt and leaves explicit retry and later barriers usable',async()=>{
  let calls=0;const f=fixture(async()=>{if(++calls===1)throw new Error('native failure');return true});
  const failed=f.runtime.snapshot({note:'failure'}),retry=f.runtime.snapshot({note:'retry'});
  assert.deepEqual(await Promise.all([failed,retry]),[false,true]);await f.runtime.drain();assert.equal(f.errors.length,1);
});
