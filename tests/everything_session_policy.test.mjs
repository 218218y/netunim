import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,plain,deferred} from './everything_session_fixture.mjs';
const failure=exitCode=>Object.assign(new Error('synthetic failure'),{exitCode});
test('original and current instance preference, version tolerance, auto-start and cache policy match in 96 scenarios',async()=>{
 let cases=0;
 for(const preferred of ['', 'configured', '1.5a'])for(const versionFails of [false,true])for(const outcome of ['success','fallback','not-running','unavailable'])for(const autoStart of [false,true])for(const fresh of [false,true]){
  const options={preferred,run:async(_file,args,_opts,starts)=>{
   if(args[0]==='-version'){if(versionFails)throw failure(2);return {stdout:' ES1 \n'}}
   const instance=args.includes('-instance')?args[args.indexOf('-instance')+1]:'';
   if(!starts){if(outcome==='not-running')throw failure(8);if(outcome==='unavailable')throw failure(3);if(outcome==='fallback'&&instance===preferred&&preferred)throw failure(8)}
   return {stdout:' 1.5.0 \n'};
  }};
  const old=fixture('baseline',options),current=fixture('current',options);
  async function observe(f){try{return {result:plain(await f.owner.probe({autoStart,fresh}))}}catch(error){return {error:{code:error.code,message:error.message}}}}
  assert.deepEqual(await observe(current),await observe(old));assert.deepEqual(current.observation(),old.observation());
  if(outcome==='success'){await current.owner.probe();await old.owner.probe();assert.deepEqual(current.observation(),old.observation())}
  await current.owner.dispose();cases++;
 }
 assert.equal(cases,96);
});
test('exact cache boundary, explicit invalidation and overlapping fresh requests preserve single-flight probing',async()=>{
 for(const version of ['baseline','current']){
  const f=fixture(version);await f.owner.probe();const before=f.calls.length;f.setTime(30999);await f.owner.probe();assert.equal(f.calls.length,before);
  f.setTime(31000);await f.owner.probe();assert.ok(f.calls.length>before);f.owner.invalidate();const count=f.calls.length;await f.owner.probe();assert.ok(f.calls.length>count);
  const held=deferred(),g=fixture(version,{load:()=>held.promise}),a=g.owner.probe(),b=g.owner.probe({fresh:true});
  held.resolve({everythingInstance:'',everythingExecutable:'',searchTimeoutMs:15000,allowedOrigins:[]});assert.deepEqual(plain(await a),plain(await b));assert.equal(g.calls.filter(call=>call[0]==='es').length,1);
  await f.owner.dispose?.();await g.owner.dispose?.();
 }
});
test('all IPC exit-8 failures trigger one start; mixed failures and autoStart false never launch',async()=>{
 for(const autoStart of [false,true])for(const exitCode of [8,3]){
  const f=fixture('current',{run:async(_file,args,_opts,starts)=>{if(args[0]==='-version')return{stdout:'ES'};if(!starts)throw failure(exitCode);return{stdout:'Everything'}}});
  if(autoStart&&exitCode===8)await f.owner.probe({autoStart});else await assert.rejects(f.owner.probe({autoStart}),{code:exitCode===8?'EVERYTHING_NOT_RUNNING':'EVERYTHING_UNAVAILABLE'});
  assert.equal(f.starts(),autoStart&&exitCode===8?1:0);await f.owner.dispose();
 }
});
test('original and current startup retain the 15-second polling deadline and one launch',async()=>{
 const options={run:async(_file,args)=>{if(args[0]==='-version')return{stdout:'ES'};throw failure(8)}};
 const old=fixture('baseline',options),current=fixture('current',options);
 for(const f of [old,current])await assert.rejects(f.owner.probe(),{code:'EVERYTHING_START_TIMEOUT'});
 assert.deepEqual(current.observation(),old.observation());assert.equal(current.starts(),1);await current.owner.dispose();
});
