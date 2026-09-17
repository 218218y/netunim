import assert from 'node:assert/strict';
import {createSearchScheduler,createDeferredSearchUpdater,createLazyDeferredSearchUpdater} from '../shared/search-scheduler.js';

function fakeTimers(){
  let nextId=1;const tasks=new Map();
  return {
    setTimer(fn){const id=nextId++;tasks.set(id,fn);return id},
    clearTimer(id){tasks.delete(id)},
    run(){const pending=[...tasks.entries()];tasks.clear();for(const [,fn] of pending)fn()},
    size(){return tasks.size}
  };
}

{
  const timers=fakeTimers(),calls=[];
  const schedule=createSearchScheduler(value=>calls.push(value),{delay:100,setTimer:timers.setTimer,clearTimer:timers.clearTimer});
  schedule('א');schedule('אב');schedule('אבג');
  assert.equal(timers.size(),1,'rapid typing must coalesce to one render');
  assert.deepEqual(calls,[],'render must not block the input event');
  timers.run();
  assert.deepEqual(calls,['אבג'],'only the latest query should render');
}

{
  const timers=fakeTimers(),state={query:''},calls=[];
  const update=createDeferredSearchUpdater(value=>{state.query=value},value=>calls.push(value),{setTimer:timers.setTimer,clearTimer:timers.clearTimer});
  const source={isConnected:true};
  update('bank',source);
  assert.equal(state.query,'bank','search state must update synchronously so other UI actions see the current query');
  assert.deepEqual(calls,[]);
  update.flush();
  assert.deepEqual(calls,['bank'],'flush should render the latest query immediately');
}

{
  const timers=fakeTimers(),calls=[];
  const update=createDeferredSearchUpdater(()=>{},value=>calls.push(value),{setTimer:timers.setTimer,clearTimer:timers.clearTimer});
  const source={isConnected:true};
  update('credit',source);source.isConnected=false;timers.run();
  assert.deepEqual(calls,[],'a queued search from a view that was replaced must not render off-screen');
}


{
  const lazy=createLazyDeferredSearchUpdater(()=>{},undefined);
  assert.equal(lazy.pending(),false,'unused lazy updater must not require unrelated render dependencies');
  assert.throws(()=>lazy('x'),/requires update and render functions/,'using the action still fails fast when its render dependency is missing');
}

console.log('search scheduler tests passed');
