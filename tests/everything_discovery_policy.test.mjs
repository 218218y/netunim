import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {discoveryFixture,config} from './everything_discovery_fixture.mjs';
import {deferred,baseline} from './everything_session_fixture.mjs';
async function outcome(work){try{return {value:await work()}}catch(error){return {error:{code:error.code,message:error.message}}}}
test('old and current ES/application discovery preserve every ordered candidate, registry/PATH fallback and platform guard',async()=>{
 let cases=0;
 for(const platform of ['win32','linux'])for(const env of [{},{NETUNIM_EVERYTHING_ES_PATH:'C:\\override-es.exe',NETUNIM_EVERYTHING_EXE_PATH:'C:\\override-app.exe',PROGRAMFILES:'C:\\apps',LOCALAPPDATA:'C:\\local','PROGRAMFILES(X86)':'C:\\x86'}])for(const method of ['es','executable']){
  const options={platform,env},inventory=discoveryFixture('baseline',options);await outcome(()=>inventory.owner[method](config));
  for(const selected of [null,...new Set(inventory.checks)]){
   const settings={...options,exists:file=>file===selected},old=discoveryFixture('baseline',settings),current=discoveryFixture('current',settings);
   assert.deepEqual(await outcome(()=>current.owner[method](config)),await outcome(()=>old.owner[method](config)));
   assert.deepEqual(current.observation(),old.observation());await current.owner.dispose();cases++;
  }
 }
 assert.ok(cases>=80,cases);
});
test('native platform retains exact default path strings before host path normalization',()=>{
 const source=fs.readFileSync(new URL('../netunim-orders/document-bridge/everything-process-platform.mjs',import.meta.url),'utf8');
 const pattern=/env\.PROGRAMFILES\s*\|\|\s*('(?:\\.|[^'])*')/;
 assert.equal(vm.runInNewContext(source.match(pattern)[1]),vm.runInNewContext(baseline.functions.whereEs.source.match(pattern)[1]));
});
test('ES PATH reply retains first nonempty line and subsequent cache; application PATH verifies each returned target',async()=>{
 for(const whereError of [false,true])for(const method of ['es','executable']){
  const options={whereError,where:['','  C:\\first.exe  ','C:\\second.exe'],exists:file=>file==='C:\\second.exe'};
  const old=discoveryFixture('baseline',options),current=discoveryFixture('current',options);
  for(let call=0;call<2;call++)assert.deepEqual(await outcome(()=>current.owner[method](config)),await outcome(()=>old.owner[method](config)));
  assert.deepEqual(current.observation(),old.observation());await current.owner.dispose();
 }
});
test('disposal during file lookup or registry read joins work and prevents a late cache/next lookup',async()=>{
 for(const phase of ['file','registry']){
  const entered=deferred(),release=deferred(),f=discoveryFixture();
  if(phase==='file')f.ports.files.exists=async()=>{entered.resolve();await release.promise;return true};
  else f.ports.commands.registry=async()=>{entered.resolve();await release.promise;return 'C:\\late'};
  const operation=f.owner[phase==='file'?'es':'executable'](config),rejected=assert.rejects(operation,{code:'EVERYTHING_DISCOVERY_DISPOSED'});await entered.promise;
  let done=false;const disposal=f.owner.dispose().then(()=>{done=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
  release.resolve();await Promise.all([rejected,disposal]);await assert.rejects(f.owner.es(),{code:'EVERYTHING_DISCOVERY_DISPOSED'});
 }
});
