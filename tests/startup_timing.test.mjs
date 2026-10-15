import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStartupTiming} from '../shared/startup-timing.js';

test('startup diagnostics are bounded, first occurrence only and contain no caller names',()=>{
  let now=10;const emitted=[],timing=createStartupTiming({now:()=>now,mark:name=>emitted.push(name)});
  timing.mark('evaluation-start');now=20;timing.mark('composition-start');
  now=24;timing.mark('composition-end');timing.mark('boot-start');
  now=30;timing.mark('recovery-start');now=45;timing.mark('local-recovered');
  now=50;timing.mark('first-view-render');now=60;timing.mark('boot-complete');timing.mark('command-ready');
  for(let i=0;i<1000;i++){now++;timing.mark('first-view-render');timing.mark('customer-name-'+i)}
  const result=timing.snapshot();
  assert.deepEqual(result.durations,{moduleEvaluation:10,composition:4,localRecovery:15,boot:36,firstView:50,commandReady:60});
  assert.equal(Object.keys(result.marks).length,9);assert.equal(emitted.length,9);
  result.marks['command-ready']=-1;
  assert.equal(timing.snapshot().durations.commandReady,60,'snapshots cannot mutate the timeline');
});

test('missing milestones stay unknown and failed optional browser diagnostics do not escape',()=>{
  for(const clock of [undefined,{}, {now:()=>NaN},{now:()=>-1},{now:()=>{throw new Error('unavailable')}}]){
    const timing=createStartupTiming(clock);assert.doesNotThrow(()=>timing.mark('boot-start'));
    assert.deepEqual(timing.snapshot().marks,{});assert.ok(Object.values(timing.snapshot().durations).every(value=>value===null));
  }
  const timing=createStartupTiming({now:()=>42,mark:()=>{throw new Error('mark unavailable')}});
  timing.mark('boot-complete');assert.equal(timing.snapshot().marks['boot-complete'],42);
  assert.equal(timing.snapshot().durations.commandReady,null,'completion is not editing authority');
});

for(const app of ['kupa','orders'])test(`${app}: module evaluation sentinel precedes all other dependencies and body timing`,()=>{
  const source=fs.readFileSync(`netunim-${app}/site/assets/js/main.js`,'utf8');
  assert.ok(source.startsWith("import {startupMark} from './shared/startup-timing.js';"));
  assert.ok(source.indexOf("startupMark('composition-start')")<source.indexOf('=createContexts()'));
  assert.ok(source.indexOf("startupMark('composition-end')")<source.indexOf('export const appReady='));
  assert.match(source,/tab\.primaryTab&&!session\.storageProtocolBlocked&&storageRecovery\.isReady\(\)/);
});
