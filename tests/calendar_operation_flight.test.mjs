import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarOperationFlight} from '../netunim-orders/site/assets/js/calendar/operation-flight.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const obsolete=()=>Object.assign(new Error('changed'),{code:'obsolete'});
const fixture=()=>{let epoch=1;const flight=createCalendarOperationFlight({isObsolete:error=>error.code==='obsolete'});return {flight,change:()=>epoch++,capture:()=>{const captured=epoch;return {assertCurrent:()=>{if(captured!==epoch)throw obsolete()}}}}};
test('current flight coalesces without executing another operation',async()=>{
  const f=fixture(),held=gate();let calls=0;const first=f.flight.run(f.capture(),async()=>{calls++;await held.promise;return true});
  assert.equal(f.flight.current(),first);const joined=f.flight.run(f.capture(),async()=>{calls++;return false});assert.equal(joined,first);
  held.resolve();assert.equal(await first,true);await f.flight.drain();assert.equal(calls,1);assert.equal(f.flight.current(),null);
});
test('obsolete flight is replaced while drain still waits for its accepted work',async()=>{
  const f=fixture(),entered=gate(),held=gate();
  const old=f.flight.run(f.capture(),async control=>{entered.resolve();await held.promise;return control.isCurrent()});await entered.promise;f.change();assert.equal(f.flight.current(),null);
  const latest=f.flight.run(f.capture(),async()=>true);assert.equal(await latest,true);
  let drained=false;const draining=f.flight.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);
  held.resolve();assert.equal(await old,false);await draining;assert.equal(f.flight.isPending(),false);
});
test('an older finally cannot release a newer authority flight',async()=>{
  const f=fixture(),oldEntered=gate(),oldHeld=gate(),newEntered=gate(),newHeld=gate();
  const old=f.flight.run(f.capture(),async control=>{oldEntered.resolve();await oldHeld.promise;assert.equal(control.release(),false);return false});await oldEntered.promise;f.change();
  const latest=f.flight.run(f.capture(),async()=>{newEntered.resolve();await newHeld.promise;return true});await newEntered.promise;
  oldHeld.resolve();await old;assert.equal(f.flight.current(),latest);newHeld.resolve();await latest;await f.flight.drain();
});
test('releasing a settled pass permits a known follow-up without joining its own completion',async()=>{
  const f=fixture();let followup,calls=0;
  const first=f.flight.run(f.capture(),async control=>{calls++;assert.equal(control.release(),true);followup=f.flight.run(f.capture(),async()=>{calls++;return true});return false});
  assert.equal(await first,false);assert.equal(await followup,true);await f.flight.drain();assert.equal(calls,2);
});
test('dispose is final, waits for accepted work and prevents queued preflight',async()=>{
  const f=fixture(),entered=gate(),held=gate();const pending=f.flight.run(f.capture(),async control=>{entered.resolve();await held.promise;return control.isCurrent()});await entered.promise;
  assert.equal(f.flight.dispose(),true);assert.equal(f.flight.dispose(),false);assert.equal(f.flight.current(),null);assert.equal(await f.flight.run(f.capture(),()=>true),false);
  let drained=false;const draining=f.flight.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);held.resolve();assert.equal(await pending,false);await draining;
  const next=fixture();let ran=false;const queued=next.flight.run(next.capture(),()=>{ran=true;return true});next.flight.dispose();assert.equal(await queued,false);assert.equal(ran,false);
});
