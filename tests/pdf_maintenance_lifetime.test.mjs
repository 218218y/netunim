import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {maintenanceFixture,deferred,plain,workRow,baseline} from './pdf_maintenance_fixture.mjs';
import {readPdfMaintenanceMetadata} from '../netunim-orders/document-bridge/pdf-maintenance-platform.mjs';
import {indexFixture} from './pdf_index_file_fixture.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('native journal failure: old joined caller returns before failure metadata, current callers join the complete operation',async t=>{
 for(const version of ['baseline','current']){
  let writes=0;const disk=await indexFixture(t,{ioHook:io=>({...io,open:async(file,...args)=>{
   const handle=await io.open(file,...args);if(!file.endsWith('.jsonl')||args[0]!=='a+')return handle;
   return new Proxy(handle,{get(target,key){if(key==='writeFile')return async()=>{writes++;throw Object.assign(new Error('synthetic native disk failure'),{code:'EIO'})};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}});
  }})});await disk.read();
  const metadataPath=path.join(path.dirname(disk.snapshotPath),'maintenance.json');await fs.writeFile(metadataPath,'{}');
  const extracting=deferred(),releaseExtraction=deferred(),cleaning=deferred(),releaseCleanup=deferred();
  const f=maintenanceFixture(version,{rows:[workRow(1)],extract:async()=>{extracting.resolve();await releaseExtraction.promise},append:records=>disk.append(records),
   metadataRead:async()=>JSON.parse(await fs.readFile(metadataPath,'utf8')),metadataWrite:async record=>{if(record.lastFailureAt){cleaning.resolve();await releaseCleanup.promise}await fs.writeFile(metadataPath,JSON.stringify(record))}});
  const first=f.owner.refresh({force:true}),firstFailed=assert.rejects(first,{code:'EIO'});await extracting.promise;
  let joinedDone=false;const joined=f.owner.refresh({force:true});joined.then(()=>{joinedDone=true},()=>{joinedDone=true});const joinedFailed=assert.rejects(joined,{code:'EIO'});
  releaseExtraction.resolve();await cleaning.promise;await tick();assert.equal(joinedDone,version==='baseline');
  assert.deepEqual(await disk.capture(),[disk.snapshotBytes,disk.journalBytes]);assert.equal(writes,1);releaseCleanup.resolve();await Promise.all([firstFailed,joinedFailed]);
  assert.ok(JSON.parse(await fs.readFile(metadataPath,'utf8')).lastFailureAt);assert.equal(f.logs.some(text=>text.startsWith('PDF_FORM_INDEX_FILE_FAILED')),false);await f.owner.dispose?.();
 }
});
test('coalesced cancellation returns the same completed aborted result and disposal joins its cleanup',async()=>{
 for(const version of ['baseline','current']){
  const entered=deferred(),release=deferred(),cleaning=deferred(),finish=deferred();
  const f=maintenanceFixture(version,{rebuild:async({signal})=>{entered.resolve();await release.promise;if(signal.aborted)throw Object.assign(new Error('stopped'),{name:'AbortError',code:'ABORT_ERR'})},metadataWrite:async record=>{if(record.lastResult?.aborted){cleaning.resolve();await finish.promise}}});
  const first=f.owner.refresh({force:true});await entered.promise;const joined=f.owner.refresh({force:true});let early=false;joined.then(()=>{early=true},()=>{early=true});
  const result=joined.then(value=>({value:plain(value)}),error=>({code:error.code}));f.owner.stop();release.resolve();await cleaning.promise;await tick();assert.equal(early,version==='baseline');
  let disposed=false;const disposal=f.owner.dispose?.().then(()=>{disposed=true});if(version==='current'){await tick();assert.equal(disposed,false);await assert.rejects(f.owner.refresh(),{code:'PDF_MAINTENANCE_DISPOSED'})}
  finish.resolve();const completed=plain(await first),other=await result;assert.equal(completed.aborted,true);
  if(version==='current'){assert.deepEqual(other,{value:completed});await disposal;assert.equal(disposed,true)}else assert.deepEqual(other,{code:'ABORT_ERR'});
  assert.equal(f.timers.size,0);
 }
});
test('unknown malformed metadata cannot write a journal, compact index or replace the metadata evidence',async()=>{
 for(const value of [null,[],true,7,{lastAttemptAt:7},{lastResult:[]},{lastSuccessfulAt:{}},{lastFailure:false}]){
  let writes=0;const f=maintenanceFixture('current',{metadataRead:async()=>value,metadataWrite:async()=>{writes++}});
  await assert.rejects(f.owner.refresh({force:true}),{code:'PDF_MAINTENANCE_METADATA_INVALID'});assert.equal(writes,0);assert.equal(f.extractions(),0);assert.equal(f.events.some(([kind])=>['append','compact'].includes(kind)),false);await f.owner.dispose();
 }
 for(const value of [{lastResult:null,lastSuccessfulAt:null},{lastResult:{pending:'0'},lastSuccessfulAt:'2026-10-15T11:59:00Z'}]){
  const f=maintenanceFixture('current',{metadata:value});await f.owner.refresh();await f.owner.dispose();
 }
});
test('native malformed checkpoint bytes are overwritten by the original fallback reader and retained by the new boundary',async t=>{
 const disk=await indexFixture(t),file=path.join(path.dirname(disk.snapshotPath),'maintenance.json'),raw='{"lastResult":';
 const oldRead=vm.runInNewContext(baseline.functions.readJsonFile.source+'\nreadJsonFile',{fs});
 for(const version of ['baseline','current']){
  await fs.writeFile(file,raw);
  const f=maintenanceFixture(version,{metadataRead:()=>version==='baseline'?oldRead(file,{}):readPdfMaintenanceMetadata(file),metadataWrite:value=>fs.writeFile(file,JSON.stringify(value))});
  if(version==='baseline'){await f.owner.refresh({force:true});assert.notEqual(await fs.readFile(file,'utf8'),raw)}
  else{await assert.rejects(f.owner.refresh({force:true}),{code:'PDF_MAINTENANCE_METADATA_INVALID'});assert.equal(await fs.readFile(file,'utf8'),raw);assert.equal(f.extractions(),0);assert.equal(f.events.some(([kind])=>['append','compact'].includes(kind)),false);await f.owner.dispose()}
 }
 await fs.writeFile(file,'\uFEFF{}');assert.deepEqual(await readPdfMaintenanceMetadata(file),{});assert.deepEqual(await readPdfMaintenanceMetadata(file+'.missing'),{});
});
test('a cleanup read failure retains the operation failure and does not invent a successful checkpoint',async()=>{
 let reads=0,writes=0;const first=Object.assign(new Error('first inventory failure'),{code:'EIO'});
 const f=maintenanceFixture('current',{metadataRead:async()=>{if(++reads>1)throw new Error('cleanup read failure');return{}},metadataWrite:async()=>{writes++},rebuild:async()=>{throw first}});
 await assert.rejects(f.owner.refresh({force:true}),error=>error===first);assert.equal(writes,1);assert.equal(f.events.some(([kind])=>['append','compact'].includes(kind)),false);await f.owner.dispose();
});
