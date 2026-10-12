import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {indexFixture,journalRow} from './pdf_index_file_fixture.mjs';

const row={...journalRow,fullPath:'C:\\synthetic\\new.pdf',text:'new committed text'};
const fault=()=>Object.assign(new Error('synthetic disk fault'),{code:'EIO'});
function handleHook(handle,overrides){return new Proxy(handle,{get(target,key){if(key in overrides)return overrides[key];const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})}
async function sourceFunction(name,context){const source=await fs.readFile(new URL('../netunim-orders/document-bridge/server.mjs',import.meta.url),'utf8'),node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name===name);return vm.runInNewContext(source.slice(node.start,node.end)+`\n${name}`,context)}

test('production append preserves replay of a historical journal with no final newline',async t=>{
  for(const suffix of ['', '\r', '\n', '\r\n']){
    const f=await indexFixture(t,{journal:JSON.stringify({op:'upsert',entry:journalRow})+suffix});
    await f.append([{op:'remove',fullPath:journalRow.fullPath},{op:'upsert',entry:row}]);const recovered=await f.fresh();
    assert.equal(recovered.entries.has(journalRow.fullPath.toLowerCase()),false);assert.equal(recovered.entries.get(row.fullPath.toLowerCase()).text,row.text);
    assert.equal(f.context.pdfFormIndex.get(row.fullPath.toLowerCase()).text,row.text);assert.equal(f.context.pdfFormIndexPending,4,'append does not reset the local maintenance backlog');
  }
});
test('production on-demand publication stays unchanged when its native journal write fails',async t=>{
  let writes=0;const f=await indexFixture(t,{ioHook:io=>({...io,open:async(file,...args)=>{
    const handle=await io.open(file,...args);return file.endsWith('.jsonl')&&args[0]==='a+'?handleHook(handle,{writeFile:async()=>{writes++;throw fault()}}):handle;
  }})});await f.read();const before=await f.capture(),model=[...f.context.pdfFormIndex.values()].map(JSON.stringify);
  Object.assign(f.context,{loadPdfFormIndex:async()=>{},appendLog:async()=>{},PDF_FORM_DETECTION_REVISION:3,PDF_FORM_SEARCH_TEXT_REVISION:3,PDF_FORM_GEOMETRY_REVISION:3,
    extractPdfOnDemand:async()=>({hasForm:true,text:row.text,formFields:journalRow.formFields,formFieldCount:1}),trimPreviewText:text=>({text}),pdfIndexFingerprint:()=>''});
  const supplement=await sourceFunction('supplementalPdfData',f.context),stat={size:3,mtimeMs:1,mtime:new Date(1)};
  assert.equal(await supplement(row,stat),null);assert.equal(writes,1);assert.deepEqual(await f.capture(),before);assert.deepEqual([...f.context.pdfFormIndex.values()].map(JSON.stringify),model);
});
test('production maintenance does not reinterpret a journal failure as an extraction failure or append twice',async t=>{
  let writes=0;const f=await indexFixture(t,{ioHook:io=>({...io,open:async(file,...args)=>{
    const handle=await io.open(file,...args);return file.endsWith('.jsonl')&&args[0]==='a+'?handleHook(handle,{writeFile:async()=>{writes++;throw fault()}}):handle;
  }})});const logs=[],maintenance={};
  Object.assign(f.context,{AbortController,setTimeout,clearTimeout,process:{cpuUsage:()=>({user:0,system:0})},shuttingDown:false,pdfMaintenanceStopRequested:false,pdfFormIndexRefreshPromise:null,pdfFormIndexRefreshAbortController:null,
    PDF_FORM_MAINTENANCE_MAX_FILES:1,PDF_FORM_MAINTENANCE_MAX_MS:0,PDF_FORM_MAINTENANCE_PATH:'synthetic',PDF_FORM_MAINTENANCE_INTERVAL_MS:1,PDF_FORM_RECONCILE_INTERVAL_MS:1,PDF_FORM_MAX_BYTES:100,PDF_FORM_DETECTION_REVISION:3,PDF_FORM_SEARCH_TEXT_REVISION:3,PDF_FORM_GEOMETRY_REVISION:3,PDF_FORM_RETRY_MS:100,
    pdfFormIndexBacklog:[row],readJsonFile:async()=>maintenance,writeJsonFile:async(_file,value)=>Object.assign(maintenance,value),appendLog:async text=>logs.push(text),
    pdfMaintenanceInventoryPlan:()=>({full:false,modifiedSince:''}),rebuildPdfFormIndexBacklog:async()=>({pdfCount:3,changed:1,removed:0}),isAbortError:()=>false,
    extractInteractivePdfText:async()=>({hasForm:true,text:row.text,formFields:journalRow.formFields,formFieldCount:1})});
  const refresh=await sourceFunction('refreshPdfFormIndex',f.context);await assert.rejects(refresh({force:true}),{code:'EIO'});
  assert.equal(writes,1);assert.equal(f.context.pdfFormIndex.has(row.fullPath.toLowerCase()),false);assert.equal(maintenance.lastSuccessfulAt,undefined);
  assert.ok(logs.some(text=>text.startsWith('PDF_FORM_INDEX_MAINTENANCE_FAILED')));assert.equal(logs.some(text=>text.startsWith('PDF_FORM_INDEX_FILE_FAILED')),false);assert.deepEqual(await f.capture(),[f.snapshotBytes,f.journalBytes]);
});
test('partial native append retains raw evidence, blocks further writes, and exact restoration recovers original content',async t=>{
  let inject=true;const f=await indexFixture(t,{ioHook:io=>({...io,open:async(file,...args)=>{
    const handle=await io.open(file,...args);return file.endsWith('.jsonl')&&args[0]==='a+'?handleHook(handle,{writeFile:async text=>{if(inject){await handle.writeFile(text.slice(0,8));throw fault()}await handle.writeFile(text)}}):handle;
  }})});await f.read();const model=[...f.context.pdfFormIndex.values()].map(JSON.stringify);
  await assert.rejects(f.append([{op:'upsert',entry:row}]),{code:'EIO'});const failedBytes=await f.capture();assert.equal(failedBytes[1],f.journalBytes+'{"op":"u');
  inject=false;await assert.rejects(f.append([{op:'upsert',entry:row}]),{code:'PDF_INDEX_JOURNAL_INVALID'});await assert.rejects(f.compact(),{code:'PDF_INDEX_JOURNAL_INVALID'});
  assert.deepEqual(await f.capture(),failedBytes);assert.deepEqual([...f.context.pdfFormIndex.values()].map(JSON.stringify),model);
  await fs.writeFile(f.journalPath,f.journalBytes);assert.deepEqual([... (await f.fresh()).entries.values()].map(JSON.stringify),model);await f.append([{op:'upsert',entry:row}]);assert.equal((await f.fresh()).entries.get(row.fullPath.toLowerCase()).text,row.text);
});
test('failed sync after full append reports failure before publication and a fresh read resolves the recorded outcome',async t=>{
  const f=await indexFixture(t,{ioHook:io=>({...io,open:async(file,...args)=>{const handle=await io.open(file,...args);return file.endsWith('.jsonl')&&args[0]==='a+'?handleHook(handle,{sync:async()=>{throw fault()}}):handle}})});await f.read();
  await assert.rejects(f.append([{op:'upsert',entry:row}]),{code:'EIO'});assert.equal(f.context.pdfFormIndex.has(row.fullPath.toLowerCase()),false);
  assert.equal((await f.fresh()).entries.get(row.fullPath.toLowerCase()).text,row.text);await f.read();assert.equal(f.context.pdfFormIndex.has(row.fullPath.toLowerCase()),true);
});
test('failed atomic snapshot rename preserves both old files and removes only its own temporary artifact',async t=>{
  const f=await indexFixture(t,{ioHook:io=>({...io,rename:async(from,to)=>{if(to.endsWith('.json'))throw fault();await io.rename(from,to)}})});const before=await f.capture();
  await assert.rejects(f.compact({pending:9}),{code:'EIO'});assert.deepEqual(await f.capture(),before);assert.equal(f.context.pdfFormIndexPending,4);assert.equal(f.context.pdfFormIndex.get('c:\\known.pdf').text,'last known good');
  assert.deepEqual((await fs.readdir(path.dirname(f.snapshotPath))).filter(name=>name.includes('.tmp-')),[]);
});
test('failure replacing the journal after snapshot commit leaves complete replay and retry compaction safe',async t=>{
  let fail=true;const f=await indexFixture(t,{ioHook:io=>({...io,rename:async(from,to)=>{if(to.endsWith('.jsonl')&&fail)throw fault();await io.rename(from,to)}})});await f.read();
  const expected=[... (await f.fresh()).entries.values()].map(JSON.stringify);await assert.rejects(f.compact({pending:1}),{code:'EIO'});
  assert.equal(await fs.readFile(f.journalPath,'utf8'),f.journalBytes);assert.deepEqual([... (await f.fresh()).entries.values()].map(JSON.stringify),expected);assert.equal(f.context.pdfFormIndexPending,0);
  fail=false;await f.compact({pending:1});assert.equal(await fs.readFile(f.journalPath,'utf8'),'');assert.equal(f.context.pdfFormIndexPending,1);assert.deepEqual([... (await f.fresh()).entries.values()].map(JSON.stringify),expected);
});
