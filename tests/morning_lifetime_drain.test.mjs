import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningLifetime} from '../netunim-orders/site/assets/js/domains/customers/morning-lifetime.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const changed=()=>Object.assign(Error('scope changed'),{code:'MORNING_OPERATION_SCOPE_CHANGED'});
function fixture(){
  let epoch=0,id=0;const queued=new Map();
  const capture=()=>{const old=epoch;return ()=>{if(old!==epoch)throw changed()}};
  const inputs={operationScope:{capture,captureRead:capture},getPendingOperationId:()=> 'same-ID',recover:async()=>false,onInterrupt(){},events:{},timers:{setTimeout:run=>{queued.set(++id,run);return id},clearTimeout:key=>queued.delete(key)}};
  return {inputs,capture,replace:()=>{epoch++},queued};
}
test('Morning drain retains a superseded accepted recovery after the newer login finishes',async()=>{
  const f=fixture(),old=gate(),fresh=gate(),owner=createMorningLifetime(f.inputs);
  const first=owner.join('recovery',f.capture(),()=>old.promise);f.replace();
  const second=owner.join('recovery',f.capture(),()=>fresh.promise);fresh.resolve();await second;
  assert.equal(typeof owner.drain,'function','accepted former-login work needs an explicit joinable lifecycle');
  assert.equal(owner.isPending(),true);owner.dispose();
  let drained=false;const draining=owner.drain().then(()=>{drained=true});for(let n=0;n<8;n++)await Promise.resolve();assert.equal(drained,false);
  old.resolve();await first;await draining;assert.equal(owner.isPending(),false);
});
test('disposing Morning fences raw join consumers even when they pass an unrevoked external assertion',async()=>{
  const f=fixture(),owner=createMorningLifetime(f.inputs);owner.dispose();let effects=0;
  await assert.rejects(async()=>owner.join('application',f.capture(),()=>{effects++;return true}),{code:'MORNING_OPERATION_SCOPE_CHANGED'});
  assert.equal(effects,0,'disposed capability cannot enter a new commit using caller-supplied authority');
});
test('a delivered recovery wake remains drainable after disposal while future wakes are cancelled',async()=>{
  const f=fixture(),held=gate(),entered=gate();f.inputs.recover=async()=>{entered.resolve();await held.promise;return false};
  const owner=createMorningLifetime(f.inputs);owner.scheduleRecovery();const wake=[...f.queued.values()][0];f.queued.clear();wake();await entered.promise;
  assert.equal(typeof owner.drain,'function','timer delivery must retain its asynchronous operation');owner.dispose();
  let drained=false;const draining=owner.drain().then(()=>{drained=true});for(let n=0;n<8;n++)await Promise.resolve();assert.equal(drained,false);
  held.resolve();await draining;assert.equal(owner.isPending(),false);assert.equal(f.queued.size,0);wake();assert.equal(owner.isPending(),false);
});
