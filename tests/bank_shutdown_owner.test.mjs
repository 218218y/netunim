import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeOperationOwner} from '../netunim-kupa/bank-bridge/operation-owner.mjs';
import {createBridgeShutdownOwner} from '../netunim-kupa/bank-bridge/shutdown-owner.mjs';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(override={}){
  const calls=[],operations=createBridgeOperationOwner(),diagnostic=gate(),closed=gate();let stopListener,wakeup;
  const platform={schedule(run,delay){calls.push(['schedule',delay]);wakeup=run;return ()=>calls.push(['cancel'])},
    subscribeStop(run){calls.push(['subscribe']);stopListener=run;return ()=>calls.push(['unsubscribe'])},
    closeListener:async()=>{calls.push(['close-listener']);closed.resolve()},exit:()=>calls.push(['exit']),reportError:error=>calls.push(['error',error.message]),...override};
  const owner=createBridgeShutdownOwner({operations,diagnostics:{drain:async()=>{calls.push(['diagnostics']);await diagnostic.promise}},platform});
  return {owner,operations,calls,diagnostic,closed,wake:()=>wakeup(),signal:()=>stopListener()};
}

test('shutdown is inert until started/requested and duplicate stop requests join one owner',async()=>{
  const f=fixture();assert.deepEqual(f.calls,[]);assert.equal(f.owner.start(),true);assert.equal(f.owner.start(),false);
  const first=f.owner.request(),again=f.owner.request();assert.equal(first,again);assert.equal(f.owner.isStopping(),true);
  assert.equal(f.owner.start(),false);await assert.rejects(f.operations.configuration(()=>{}),{code:'BRIDGE_STOPPING'});
  f.wake();f.wake();f.diagnostic.resolve();await first;
  assert.deepEqual(f.calls.map(row=>row[0]),['subscribe','schedule','diagnostics','close-listener','unsubscribe','exit']);
  await f.owner.request();assert.equal(f.calls.filter(row=>row[0]==='exit').length,1);
});

test('signal closes admission and retains a disconnected provider through cleanup and diagnostic drain',async()=>{
  const f=fixture(),entered=gate(),providerHeld=gate();f.owner.start();
  const provider=f.operations.provider(async()=>{entered.resolve();await providerHeld.promise;f.calls.push(['provider-cleanup']);return 42});await entered.promise;
  f.signal();f.wake();await Promise.resolve();assert.ok(!f.calls.some(row=>row[0]==='close-listener'));
  for(const command of [()=>f.operations.read(()=>{}),()=>f.operations.configuration(()=>{}),()=>f.operations.provider(()=>{})])await assert.rejects(command(),{code:'BRIDGE_STOPPING'});
  providerHeld.resolve();assert.equal(await provider,42);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.calls.some(row=>row[0]==='diagnostics'));assert.ok(!f.calls.some(row=>row[0]==='close-listener'));
  f.diagnostic.resolve();await f.owner.drain();assert.equal(f.calls.at(-1)[0],'exit');
});

test('closed operation owner drains every accepted FIFO command after a prior failure',async()=>{
  const owner=createBridgeOperationOwner(),first=gate(),second=gate(),entered=gate(),order=[];
  const a=owner.configuration(async()=>{order.push('first');await first.promise;throw new Error('fixture')});
  const b=owner.configuration(async()=>{order.push('second');entered.resolve();await second.promise;return 7});
  const rejected=assert.rejects(a,/fixture/);assert.equal(owner.close(),true);assert.equal(owner.close(),false);assert.throws(owner.assertAccepting,{code:'BRIDGE_STOPPING'});
  let drained=false;const drainage=owner.drain().then(()=>{drained=true});first.resolve();await rejected;await entered.promise;
  assert.equal(drained,false);second.resolve();assert.equal(await b,7);await drainage;assert.deepEqual(order,['first','second']);
});

test('a failed listener close leaves exit uncertified and allows one teardown retry',async()=>{
  let attempts=0;const f=fixture({closeListener:async()=>{if(++attempts===1)throw new Error('fixture close failed')}});f.owner.start();
  const first=f.owner.request();f.wake();f.diagnostic.resolve();await assert.rejects(first,/close failed/);
  assert.ok(!f.calls.some(row=>row[0]==='exit'));assert.equal(f.owner.isStopping(),true);assert.equal(f.calls.filter(row=>row[0]==='subscribe').length,1);
  const retry=f.owner.request();f.wake();await retry;assert.equal(attempts,2);assert.equal(f.calls.at(-1)[0],'exit');assert.equal(f.calls.filter(row=>row[0]==='unsubscribe').length,1);
});

test('shutdown cannot attach signal listeners after a pre-start request',async()=>{
  const f=fixture(),task=f.owner.request();assert.equal(f.owner.start(),false);f.wake();f.diagnostic.resolve();await task;
  assert.ok(!f.calls.some(row=>row[0]==='subscribe'));
});
