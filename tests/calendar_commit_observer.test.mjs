import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarCommitObserver} from '../netunim-orders/site/assets/js/calendar/commit-observer.js';
import {createCalendarCommitNotifications} from '../netunim-orders/site/assets/js/platform/calendar-commit-notifications.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const microtasks=async()=>{for(let n=0;n<16;n++)await Promise.resolve()};

test('1000 commit hints during one read coalesce into one trailing durable read',async()=>{
  let hint,reads=0,active=0,maxActive=0;const hold=deferred(),started=deferred();
  const owner=createCalendarCommitObserver({subscribe:fn=>{hint=fn;return ()=>{hint=null}},capture:()=>({owner:'A',assertCurrent(){}}),
    async refresh(){reads++;active++;maxActive=Math.max(active,maxActive);if(reads===1){started.resolve();await hold.promise}active--;return true},onError(){assert.fail('unexpected error')}});
  assert.equal(owner.start(),true);assert.equal(owner.start(),false);await started.promise;
  for(let n=0;n<1000;n++)hint();const drain=owner.wake();hold.resolve();assert.equal(await drain,true);
  assert.equal(reads,2);assert.equal(maxActive,1);assert.equal(owner.dispose(),true);assert.equal(owner.dispose(),false);assert.equal(hint,null);assert.equal(await owner.wake(),false);
});

for(const change of ['logout','dispose'])test(`${change} fences a held queue read and does not publish a stale warning`,async()=>{
  let epoch=0,reads=0,published=0,errors=0;const hold=deferred(),started=deferred();
  const owner=createCalendarCommitObserver({subscribe:()=>()=>{},capture:()=>{if(epoch)return null;const scope=epoch;return {owner:'A',assertCurrent(){if(scope!==epoch)throw Object.assign(Error('changed'),{code:'CALENDAR_OPERATION_SCOPE_CHANGED'})}}},
    async refresh(authority){reads++;started.resolve();await hold.promise;authority.assertCurrent();published++;return true},onError(){errors++}});
  owner.start();await started.promise;const drain=owner.wake();epoch++;if(change==='dispose')owner.dispose();hold.resolve();await drain;
  assert.equal(published,0);assert.equal(errors,0);assert.equal(reads,1);owner.dispose();
});

test('a read error is visible once, with no retry loop; the next commit can recover',async()=>{
  let hint,reads=0,errors=0;const owner=createCalendarCommitObserver({subscribe:fn=>{hint=fn;return ()=>{}},capture:()=>({owner:'A',assertCurrent(){}}),
    async refresh(){reads++;if(reads===1)throw Object.assign(Error('aborted'),{name:'QuotaExceededError'});return true},onError(){errors++}});
  owner.start();await microtasks();assert.equal(reads,1);assert.equal(errors,1);
  hint();await microtasks();assert.equal(reads,2);assert.equal(errors,1);owner.dispose();
});

test('unverified owners do not read the queue on start or commit',async()=>{
  let reads=0;const owner=createCalendarCommitObserver({subscribe:()=>()=>{},capture:()=>null,refresh:async()=>{reads++;return true},onError(){assert.fail()}});
  owner.start();await owner.wake();assert.equal(reads,0);owner.dispose();
});

test('a hint in the promise settlement gap cannot lose its trailing read',async()=>{
  for(let gap=1;gap<=6;gap++){
    let hint,reads=0;
    const owner=createCalendarCommitObserver({subscribe:fn=>{hint=fn;return ()=>{}},capture:()=>({owner:'A',assertCurrent(){}}),
      async refresh(){reads++;if(reads===1){let remaining=gap;const later=()=>{if(--remaining)queueMicrotask(later);else hint()};queueMicrotask(later)}return true},onError(){assert.fail()}});
    owner.start();await microtasks();assert.equal(reads,2,`lost hint at microtask ${gap}`);owner.dispose();
  }
});

test('native channels are lazy, payload free, validated, and owned by subscriptions',()=>{
  const opened=[],warnings=[];const bus=createCalendarCommitNotifications({createChannel:name=>{const channel={name,listeners:new Set(),sent:[],closed:0,addEventListener(_type,fn){this.listeners.add(fn)},removeEventListener(_type,fn){this.listeners.delete(fn)},postMessage(data){this.sent.push(data)},close(){this.closed++}};opened.push(channel);return channel},onError:error=>warnings.push(error)});
  assert.equal(opened.length,0);let reads=0;const stop=bus.subscribe(()=>{reads++}),channel=opened[0];
  const receive=[...channel.listeners][0];for(const data of [null,{},true,{type:'calendar-local-commit',version:2}])receive({data});assert.equal(reads,0);
  receive({data:{type:'calendar-local-commit',version:1}});bus.notify();assert.equal(reads,2);
  assert.deepEqual(channel.sent,[{type:'calendar-local-commit',version:1}]);assert.ok(Object.isFrozen(channel.sent[0]));
  stop();stop();assert.equal(channel.closed,1);assert.equal(channel.listeners.size,0);
  bus.notify();assert.equal(reads,2);assert.equal(opened[1].closed,1);assert.equal(opened[1].listeners.size,0);assert.equal(warnings.length,0);
});

test('1000 subscribe/dispose cycles leave no live channels or callbacks',()=>{
  let live=0,listeners=0,callbacks=0;const bus=createCalendarCommitNotifications({createChannel:()=>{live++;return {addEventListener(){listeners++},removeEventListener(){listeners--},postMessage(){},close(){live--}}}});
  for(let n=0;n<1000;n++){const stop=bus.subscribe(()=>{callbacks++});bus.notify();stop();stop()}
  assert.equal(live,0);assert.equal(listeners,0);assert.equal(callbacks,1000);
});

for(const failure of ['unsupported','construct','listen','send','subscriber'])test(`notification ${failure} failure cannot reject a committed producer`,()=>{
  let warnings=0,calls=0,closed=0;
  const bus=createCalendarCommitNotifications({onError(){warnings++},createChannel(){
    if(failure==='unsupported')return null;if(failure==='construct')throw Error('blocked');
    return {addEventListener(){if(failure==='listen')throw Error('listen failed')},removeEventListener(){},postMessage(){if(failure==='send')throw Error('send failed')},close(){closed++}};
  }});
  const stop=bus.subscribe(()=>{calls++;if(failure==='subscriber')throw Error('consumer failed')});
  assert.doesNotThrow(()=>bus.notify());assert.equal(calls,1);stop();
  if(failure==='unsupported')assert.equal(warnings,0);else assert.ok(warnings>0);
  if(!['unsupported','construct'].includes(failure))assert.ok(closed>0);
});
