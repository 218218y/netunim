import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createMaintenanceProcessOwner,runMaintenanceWorker} from '../netunim-orders/document-bridge/maintenance-process-owner.mjs';
import {deferred,fixture,finish} from './maintenance_process_fixture.mjs';

test('parallel starts join one held probe and one child',async()=>{
  const held=deferred();let probes=0;const f=fixture({host:{isHeld:()=>{probes++;return held.promise}}});
  const a=f.owner.start(),b=f.owner.start();assert.equal(f.children.length,0);held.resolve(false);await Promise.all([a,b]);
  assert.equal(probes,1);assert.equal(f.children.length,1);await f.owner.start();assert.equal(f.children.length,1);finish(f.children[0]);
});
test('shutdown during the held probe never launches new work',async()=>{
  const held=deferred(),f=fixture({host:{isHeld:()=>held.promise}});const starting=f.owner.start();
  const rejected=assert.rejects(starting,{code:'PDF_MAINTENANCE_DISPOSED'}),disposed=f.owner.dispose();held.resolve(false);
  await Promise.all([disposed,rejected]);assert.equal(f.children.length,0);assert.equal(f.timers.size,0);await assert.rejects(f.owner.start(),{code:'PDF_MAINTENANCE_DISPOSED'});
});
test('scheduled lock and failed lock observation do not start a manual child',async()=>{
  const f=fixture({host:{isHeld:async()=>true}});await f.owner.start();assert.equal(f.children.length,0);
  const error=new Error('uncertain owner');f.ports.host.isHeld=async()=>{throw error};await assert.rejects(f.owner.start(),error);assert.equal(f.children.length,0);
});
test('stop requests coalesce before their async send confirms',async()=>{
  const sent=deferred();let sends=0;const f=fixture({host:{requestStop:()=>{sends++;return sent.promise}}});await f.owner.start();
  const a=f.owner.stop(),b=f.owner.stop();await Promise.resolve();assert.equal(sends,1);assert.equal(f.owner.view().manual.stopRequested,false);
  sent.resolve();await Promise.all([a,b]);await f.owner.stop();assert.equal(sends,1);assert.equal(f.owner.view().manual.phase,'stopping');
  f.children[0].emit('message',{type:'pdf-maintenance-progress',progress:{phase:'file'}});assert.equal(f.owner.view().manual.phase,'stopping');finish(f.children[0]);
});
test('a failed stop is visible and can be retried under the same child',async()=>{
  const error=new Error('IPC failure'),f=fixture({host:{requestStop:async()=>{throw error}}});await f.owner.start();await assert.rejects(f.owner.stop(),error);
  assert.equal(f.owner.view().manual.stopRequested,false);f.ports.host.requestStop=async child=>f.sent.push(child);await f.owner.stop();assert.equal(f.sent.length,1);finish(f.children[0]);
});
test('process error and close without exit end the run and allow a replacement',async()=>{
  const f=fixture();await f.owner.start();const first=f.children[0];first.emit('error',new Error('spawn rejected'));first.emit('close',-1,null);
  assert.equal(f.owner.view().manual.running,false);assert.equal(f.owner.view().manual.error,'spawn rejected');assert.equal(first.listenerCount('message'),0);
  await f.owner.start();assert.equal(f.children.length,2);finish(f.children[1]);
});
test('late messages and send callback from a closed scope cannot mutate the replacement',async()=>{
  const send=deferred(),f=fixture({host:{requestStop:()=>send.promise}});await f.owner.start();const first=f.children[0],late=first.listeners('message')[0];
  const stopping=f.owner.stop();await Promise.resolve();finish(first);await f.owner.start();const before=f.owner.view();late({type:'pdf-maintenance-result',result:{processed:999}});send.resolve();await stopping;
  assert.deepEqual(f.owner.view(),before);finish(f.children[1]);
});
test('result is provisional until close and successful exit without result is not success',async()=>{
  const f=fixture();await f.owner.start();const child=f.children[0];child.emit('message',{type:'pdf-maintenance-result',result:{processed:4}});
  child.emit('exit',0,null);assert.equal(f.owner.view().manual.running,true);await f.owner.start();assert.equal(f.children.length,1);
  child.emit('close',0,null);assert.equal(f.owner.view().manual.result.processed,4);assert.equal(f.owner.view().manual.error,'');
  await f.owner.start();f.children[1].emit('close',0,null);assert.match(f.owner.view().manual.error,/ללא אישור תוצאה/);
});
test('dispose joins callers, waits for started work to close and removes its timer',async()=>{
  const f=fixture();await f.owner.start();let drained=false;const a=f.owner.dispose().then(()=>{drained=true}),b=f.owner.dispose();
  await Promise.resolve();assert.equal(drained,false);assert.equal(f.children[0].listenerCount('close'),1);finish(f.children[0],{aborted:true,processed:1});await Promise.all([a,b]);
  assert.equal(f.sent.length,1);assert.equal(f.timers.size,0);await f.owner.dispose();assert.equal(f.timers.size,0);
});
test('drain timeout retains the worker and its observers; later close permits safe disposal',async()=>{
  const f=fixture();await f.owner.start();const disposal=f.owner.dispose();const rejected=assert.rejects(disposal,{code:'PDF_MAINTENANCE_DRAIN_TIMEOUT'});
  [...f.timers.values()][0]();await rejected;assert.equal(f.owner.view().manual.running,true);assert.equal(f.children[0].listenerCount('close'),1);assert.equal(f.timers.size,0);
  await assert.rejects(f.owner.start(),{code:'PDF_MAINTENANCE_DISPOSED'});finish(f.children[0]);await f.owner.dispose();
});
test('a hanging held probe is bounded during disposal and remains fenced when it returns',async()=>{
  const held=deferred(),f=fixture({host:{isHeld:()=>held.promise}}),start=f.owner.start();const rejectedStart=assert.rejects(start,{code:'PDF_MAINTENANCE_DISPOSED'});
  const disposal=f.owner.dispose(),rejected=assert.rejects(disposal,{code:'PDF_MAINTENANCE_DRAIN_TIMEOUT'});[...f.timers.values()][0]();await rejected;
  held.resolve(false);await rejectedStart;await f.owner.dispose();assert.equal(f.children.length,0);
});
test('optional diagnostic rejection does not orphan a launched child or stop request',async()=>{
  const f=fixture({ports:{log:async()=>{throw new Error('log disk unavailable')}}});await f.owner.start();await f.owner.stop();finish(f.children[0]);await f.owner.dispose();
});
test('100 completed runs release all scoped listeners and disposal timers',async()=>{
  const f=fixture();for(let i=0;i<100;i++){await f.owner.start();const child=f.children[i];await f.owner.stop();finish(child);assert.deepEqual(child.eventNames(),[])}
  await f.owner.dispose();assert.equal(f.children.length,100);assert.equal(f.sent.length,100);assert.equal(f.timers.size,0);
});
test('worker closes IPC and removes its stop listener on init failure and success',async()=>{
  for(const fail of [true,false]){
    const emitter=new EventEmitter();let stopped=0,disconnected=0;const error=new Error('init rejected');
    const work=runMaintenanceWorker({subscribe:listener=>{emitter.on('message',listener);return()=>emitter.removeListener('message',listener)},requestStop:()=>{stopped++},disconnect:()=>{disconnected++}},async()=>{
      emitter.emit('message',{type:'ignored'});emitter.emit('message',{type:'stop-pdf-maintenance'});if(fail)throw error;return {processed:2};
    });
    if(fail)await assert.rejects(work,error);else assert.deepEqual(await work,{processed:2});assert.equal(stopped,1);assert.equal(disconnected,1);assert.equal(emitter.listenerCount('message'),0);
  }
});
test('invalid disposal budgets or ports are rejected before process launch',()=>{
  const f=fixture();for(const drainTimeoutMs of [0,-1,NaN,Infinity])assert.throws(()=>createMaintenanceProcessOwner(f.ports,{drainTimeoutMs}),/ports_required/);
  assert.throws(()=>createMaintenanceProcessOwner({...f.ports,host:{...f.ports.host,requestStop:null}}),/ports_required/);
});
