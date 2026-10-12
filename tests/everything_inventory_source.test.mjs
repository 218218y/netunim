import test from 'node:test';
import assert from 'node:assert/strict';
import {createEverythingInventorySource} from '../netunim-orders/document-bridge/everything-inventory-source.mjs';

function fixture(){
  const calls=[],config={searchTimeoutMs:3000},probe={esPath:'synthetic-es',instance:'A'};let probes=0;
  const ports={loadConfig:async()=>config,probeEverything:async options=>{probes++;calls.push({probe:options});return probe},runEs:async(file,args,options)=>{calls.push({file,args,options});return {stdout:args.includes('-get-result-count')?'1':'[{"Name":"one.pdf","Path":"C:\\\\synthetic"}]'}}};
  return {source:createEverythingInventorySource({loadConfig:(...args)=>ports.loadConfig(...args),probeEverything:(...args)=>ports.probeEverything(...args),runEs:(...args)=>ports.runEs(...args)}),ports,calls,config,probe,probes:()=>probes};
}
test('the native source pins path, IPC instance and timeout across count/page/config-cache changes',async()=>{
  const f=fixture(),controller=new AbortController(),session=await f.source.open(controller.signal);f.config.searchTimeoutMs=30000;f.probe.esPath='replacement-es';f.probe.instance='B';
  assert.equal(await session.count(controller.signal),1);assert.equal((await session.page({offset:2,limit:2,modifiedSince:'2026-10-11',signal:controller.signal}))[0].fullPath,'C:\\synthetic\\one.pdf');
  const calls=f.calls.filter(call=>call.file);assert.equal(f.probes(),1);for(const call of calls){assert.equal(call.file,'synthetic-es');assert.equal(call.args[call.args.indexOf('-instance')+1],'A');assert.equal(call.options.signal,controller.signal)}
  assert.equal(calls[0].options.timeout,6000);assert.equal(calls[1].options.timeout,8000);assert.ok(calls[1].args.includes('2'));
});
test('the existing exit-8 page retry is bounded and permitted only for the same captured source',async()=>{
  const f=fixture();let runs=0;f.ports.runEs=async()=>{if(++runs===1)throw Object.assign(new Error('IPC missing'),{exitCode:8});return {stdout:'[]'}};
  const session=await f.source.open(null);assert.deepEqual(await session.page({offset:0,limit:2,modifiedSince:'',signal:null}),[]);assert.equal(runs,2);assert.equal(f.probes(),2);assert.deepEqual(f.calls.at(-1).probe,{fresh:true,autoStart:true});
  f.ports.runEs=async()=>{runs++;throw Object.assign(new Error('IPC still missing'),{exitCode:8})};await assert.rejects(session.page({offset:0,limit:2,modifiedSince:'',signal:null}),{exitCode:8});assert.equal(runs,4);
});
test('a refreshed IPC source cannot supply remaining pages or counts under the old inventory',async()=>{
  const f=fixture(),session=await f.source.open(null);let runs=0;f.ports.runEs=async()=>{runs++;throw Object.assign(new Error('old IPC missing'),{exitCode:8})};f.probe.instance='B';
  await assert.rejects(session.page({offset:2,limit:2,modifiedSince:'',signal:null}),{code:'PDF_INVENTORY_SOURCE_CHANGED'});assert.equal(runs,1);
});
test('count and non-exit-8 failures retain native classification and cause no new retry policy',async()=>{
  const f=fixture(),session=await f.source.open(null);let runs=0;f.ports.runEs=async()=>{runs++;throw Object.assign(new Error('query failed'),{exitCode:8})};
  await assert.rejects(session.count(null),{exitCode:8});assert.equal(f.probes(),1);assert.equal(runs,1);
  f.ports.runEs=async()=>{throw Object.assign(new Error('query failed'),{exitCode:7})};await assert.rejects(session.page({offset:0,limit:2,modifiedSince:'',signal:null}),{exitCode:7});assert.equal(f.probes(),1);
});
test('abort after config hydration blocks probe and abort after process output blocks acceptance',async()=>{
  const f=fixture(),controller=new AbortController();f.ports.loadConfig=async()=>{controller.abort();return f.config};await assert.rejects(f.source.open(controller.signal),{code:'ABORT_ERR'});assert.equal(f.probes(),0);
  const next=fixture(),active=new AbortController(),session=await next.source.open(active.signal);next.ports.runEs=async()=>{active.abort();return {stdout:'[]'}};
  await assert.rejects(session.page({offset:0,limit:2,modifiedSince:'',signal:active.signal}),{code:'ABORT_ERR'});
});
test('invalid source details are rejected before command execution',async()=>{
  const f=fixture();f.config.searchTimeoutMs=NaN;await assert.rejects(f.source.open(null),/source_required/);assert.equal(f.calls.some(call=>call.file),false);
});
