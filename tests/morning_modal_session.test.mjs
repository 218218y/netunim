import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningModalSession} from '../netunim-orders/site/assets/js/domains/customers/morning-modal-session.js';
function fixture(){
  let root=null,open=true,epoch=0,unsubscribe=0,listener,cleared=0;
  const session=createMorningModalSession({authority:{captureRead:()=>{const captured=epoch;return ()=>{if(captured!==epoch)throw Error('account changed')}}},account:{subscribe:fn=>{listener=fn;return ()=>{unsubscribe++}}},surface:{find:()=>root,isOpen:()=>open},presentation:{render:()=>{root={isConnected:true}},clear:()=>{cleared++;root=null}}});
  return {session,mount:()=>session.open('Morning',generation=>String(generation),''),replace:()=>{root={isConnected:true}},close:()=>{open=false},invalidate:()=>{epoch++;listener()},cleared:()=>cleared,unsubscribe:()=>unsubscribe};
}
test('native identity replacement fences actions even with the same marker generation',()=>{
  const f=fixture(),generation=f.mount();f.replace();assert.equal(f.session.isActive(generation),false);assert.throws(()=>f.session.assert(),{code:'MORNING_OPERATION_SCOPE_CHANGED'});
  f.invalidate();assert.equal(f.cleared(),0,'account cleanup cannot replace another owner surface');f.session.dispose();
});
test('close fences actions while account invalidation still removes retained private DOM',()=>{
  const f=fixture(),generation=f.mount(),signal=f.session.signal;f.close();assert.equal(f.session.isActive(generation),false);assert.throws(()=>f.session.assert());
  f.invalidate();assert.equal(f.cleared(),1);assert.equal(signal.aborted,true);f.session.dispose();
});
test('renewal cancels the former confirmation and disposal is final and idempotent',()=>{
  const f=fixture(),first=f.mount(),signal=f.session.signal,second=f.mount();assert.equal(signal.aborted,true);assert.equal(f.session.signal.aborted,false);assert.equal(f.session.isActive(first),false);assert.equal(f.session.isActive(second),true);
  assert.equal(f.session.dispose(),true);assert.equal(f.session.dispose(),false);assert.equal(f.unsubscribe(),1);assert.equal(f.cleared(),1);assert.throws(()=>f.mount(),/morning_display_disposed/);
});
