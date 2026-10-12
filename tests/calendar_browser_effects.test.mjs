import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarBrowserEffects} from '../netunim-orders/site/assets/js/platform/calendar-browser-effects.js';
class Surface{
  listeners=new Map();visibilityState='visible';
  addEventListener(type,run){const set=this.listeners.get(type)||new Set();set.add(run);this.listeners.set(type,set)}
  removeEventListener(type,run){this.listeners.get(type)?.delete(run)}
  emit(type){for(const run of this.listeners.get(type)||[])run()}
}
function fixture(){
  const window=new Surface(),document=new Surface(),navigator={onLine:true},jobs=new Map(),intervals=new Map(),frames=new Map(),errors=[];let id=0;
  const timers={setTimeout:(run,delay)=>{jobs.set(++id,{run,delay});return id},clearTimeout:id=>jobs.delete(id),setInterval:(run,delay)=>{intervals.set(++id,{run,delay});return id},clearInterval:id=>intervals.delete(id),requestAnimationFrame:run=>{frames.set(++id,run);return id},cancelAnimationFrame:id=>frames.delete(id)};
  const effects=createCalendarBrowserEffects({environment:{window,document,navigator,timers},onError:error=>errors.push(error)});
  return {window,document,navigator,jobs,intervals,frames,errors,effects};
}
test('construction is inert and repeated startup owns one poll/listener set',()=>{
  const f=fixture();let resumed=0,offline=0;assert.equal(f.jobs.size+f.intervals.size+f.frames.size,0);
  const ports={resume:()=>resumed++,offline:()=>offline++,canPoll:()=>true,interval:60_000};assert.equal(f.effects.start(ports),true);assert.equal(f.effects.start(ports),false);assert.equal(f.intervals.size,1);
  f.window.emit('online');f.window.emit('offline');assert.equal(resumed,1);assert.equal(offline,1);
  const poll=[...f.intervals.values()][0];assert.equal(poll.delay,60_000);poll.run();assert.equal(resumed,2);
  f.document.visibilityState='hidden';poll.run();assert.equal(resumed,2);f.effects.dispose();
});
test('cancelled day/reconnect/frame callbacks cannot affect newer work',async()=>{
  const f=fixture(),ran=[];f.effects.dayClick.schedule(()=>ran.push('old day'));const oldDay=[...f.jobs.values()][0];
  f.effects.dayClick.schedule(()=>ran.push('new day'));const newDay=[...f.jobs.values()][0];assert.equal(newDay.delay,320);
  oldDay.run();newDay.run();await f.effects.drain();assert.deepEqual(ran,['new day']);
  f.effects.reconnect.schedule(()=>ran.push('old retry'),30_000);const oldRetry=[...f.jobs.values()].at(-1);f.effects.invalidate();oldRetry.run();await f.effects.drain();assert.deepEqual(ran,['new day']);
  f.effects.frame(()=>ran.push('old frame'));const oldFrame=[...f.frames.values()][0];f.effects.invalidate();f.effects.frame(()=>ran.push('new frame'));oldFrame();[...f.frames.values()][0]();assert.deepEqual(ran,['new day','new frame']);f.effects.dispose();
});
test('disposal removes listeners/intervals/deadlines/frames and rejects future scheduling',async()=>{
  const f=fixture();let ran=0;
  f.effects.start({resume:()=>ran++,offline:()=>ran++,canPoll:()=>true,interval:60_000});
  f.effects.dayClick.schedule(()=>ran++);f.effects.reconnect.schedule(()=>ran++);f.effects.frame(()=>ran++);
  const callbacks=[...f.jobs.values(),...f.intervals.values()].map(job=>job.run).concat([...f.frames.values()],...[...f.window.listeners.values()].map(set=>[...set]));
  assert.equal(f.effects.dispose(),true);assert.equal(f.effects.dispose(),false);for(const run of callbacks)run();await f.effects.drain();
  assert.equal(ran,0);assert.equal(f.jobs.size+f.intervals.size+f.frames.size,0);assert.equal([...f.window.listeners.values(),...f.document.listeners.values()].reduce((sum,set)=>sum+set.size,0),0);
  assert.equal(f.effects.isOnline(),false);assert.equal(f.effects.dayClick.schedule(()=>ran++),false);assert.equal(f.effects.frame(()=>ran++),false);
});
test('partial browser registration failure cleans earlier listeners and closes the owner',()=>{
  const f=fixture();f.document.addEventListener=()=>{throw new Error('visibility registration failed')};
  assert.throws(()=>f.effects.start({resume:()=>{},offline:()=>{},canPoll:()=>true,interval:60_000}),/registration failed/);
  assert.equal([...f.window.listeners.values()].reduce((sum,set)=>sum+set.size,0),0);assert.equal(f.intervals.size,0);assert.equal(f.effects.dispose(),false);
});
