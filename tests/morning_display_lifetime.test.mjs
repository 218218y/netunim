import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningDisplayLifetime,clearMorningDisplay} from '../netunim-orders/site/assets/js/domains/customers/morning-display-lifetime.js';

function fixture(){
  const listeners=new Set();let invalidations=0;
  const build=()=>createMorningDisplayLifetime({subscribeAccountScope:listener=>{listeners.add(listener);return ()=>listeners.delete(listener)},onInvalidate:()=>invalidations++});
  return {listeners,build,notify:()=>{for(const listener of listeners)listener()},get invalidations(){return invalidations}};
}
test('account invalidation cancels only presentation and renewal owns a new signal',()=>{
  const f=fixture(),display=f.build(),first=display.signal;
  f.notify();assert.equal(first.aborted,true);assert.equal(f.invalidations,1);
  display.renew();assert.notEqual(display.signal,first);assert.equal(display.signal.aborted,false);
  f.notify();assert.equal(display.signal.aborted,true);assert.equal(f.invalidations,2);display.dispose();
});
test('replacing a form revokes its unaccepted confirmation',()=>{
  const f=fixture(),display=f.build(),signal=display.signal;
  display.renew();assert.equal(signal.aborted,true);assert.equal(display.signal.aborted,false);assert.equal(f.invalidations,0);display.dispose();
});
test('visual invalidation does not abort or retry a started durable task',async()=>{
  const f=fixture(),display=f.build();let finish,commits=0;
  const committed=new Promise(resolve=>{finish=()=>{commits++;resolve('same-operation-id')}});
  f.notify();display.dispose();finish();assert.equal(await committed,'same-operation-id');assert.equal(commits,1);
});
test('100 display cycles remove subscriptions and fence retained callbacks',()=>{
  const f=fixture();
  for(let i=0;i<100;i++){
    const display=f.build(),callback=[...f.listeners][0];assert.equal(f.listeners.size,1);
    assert.equal(display.dispose(),true);assert.equal(display.dispose(),false);assert.equal(f.listeners.size,0);
    callback();assert.equal(f.invalidations,i+1);assert.throws(()=>display.renew(),/morning_display_disposed/);
  }
});
test('an unmounted owner cannot replace another capability or a newer Morning surface',()=>{
  const renders=[],render=(...args)=>{renders.push(args)};
  assert.equal(clearMorningDisplay(null,render),false);assert.equal(clearMorningDisplay({isConnected:false},render),false);assert.deepEqual(renders,[]);
  assert.equal(clearMorningDisplay({isConnected:true},render),true);assert.equal(renders.length,1);assert.match(renders[0][1],/role="status"/);
});
