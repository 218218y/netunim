import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parse} from 'acorn';
import {createPdfInventory} from '../netunim-orders/document-bridge/pdf-inventory.mjs';
import {createEverythingInventorySource} from '../netunim-orders/document-bridge/everything-inventory-source.mjs';
import {pdfIndexNeedsInspection} from '../netunim-orders/document-bridge/pdf-index-policy.mjs';
import * as lib from '../netunim-orders/document-bridge/lib.mjs';
import {indexFixture} from './pdf_index_file_fixture.mjs';

const execute=promisify(execFile),worker=fileURLToPath(new URL('./fixtures/everything_json_process_worker.mjs',import.meta.url));
async function fixture(t,{count='0',page='',abortPhase='',handoffAbort=false}={}){
  const f=await indexFixture(t);await f.read();const controller=new AbortController(),commands=[];
  const source=await fs.readFile(new URL('../netunim-orders/document-bridge/server.mjs',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  Object.assign(f.context,{...lib,AbortController,createEverythingInventorySource,createPdfInventory:ports=>{
    const inventory=createPdfInventory(ports,{pageSize:2});if(!handoffAbort)return inventory;
    return {...inventory,read:async options=>{const rows=await inventory.read(options);queueMicrotask(()=>controller.abort());return rows}};
  },loadConfig:async()=>({searchTimeoutMs:3000}),probeEverything:async()=>({esPath:'synthetic-es',instance:'A'}),
    runEs:async(_file,args,options)=>{
      const kind=args.includes('-get-result-count')?'count':'page';commands.push(kind);
      const output=await execute(process.execPath,[worker,kind==='count'?count:page],{encoding:'utf8',windowsHide:true,cwd:path.dirname(f.snapshotPath),...(options.signal?{signal:options.signal}:{})});
      if(abortPhase===kind)controller.abort();return output;
    },PDF_FORM_INDEX_PAGE_SIZE:2,PDF_FORM_DETECTION_REVISION:2,PDF_FORM_SEARCH_TEXT_REVISION:2,
    pdfIndexNeedsInspection,shuttingDown:false,pdfMaintenanceStopRequested:false,pdfFormIndexBacklog:[{fullPath:'retained backlog'}],
  });
  const functions=ast.body.filter(node=>node.type==='FunctionDeclaration'&&['listEverythingPdfs','rebuildPdfFormIndexBacklog','runEverythingJson','searchDocuments'].includes(node.id.name));
  const variable=ast.body.find(node=>node.type==='VariableDeclaration'&&node.declarations.some(value=>value.id.name==='pdfInventory'));
  const root=vm.runInNewContext([source.slice(variable.start,variable.end),...functions.map(node=>source.slice(node.start,node.end)),'({rebuild:rebuildPdfFormIndexBacklog,search:searchDocuments})'].join('\n'),f.context);
  return {...f,root,controller,commands};
}
async function retained(f,errorCode){
  const bytes=await f.capture(),model=[...f.context.pdfFormIndex.values()].map(JSON.stringify),backlog=f.context.pdfFormIndexBacklog;
  await assert.rejects(f.root.rebuild({full:true,signal:f.controller.signal}),{code:errorCode});assert.deepEqual(await f.capture(),bytes);
  assert.deepEqual([...f.context.pdfFormIndex.values()].map(JSON.stringify),model);assert.equal(f.context.pdfFormIndexBacklog,backlog);assert.deepEqual(f.writes,[]);
}
test('actual rebuild refuses malformed ES envelope without removing any native indexed record',async t=>{
  const f=await fixture(t,{page:'{"error":"synthetic process failure"}'});await retained(f,'ES_INVALID_JSON');assert.deepEqual(f.commands,['count','page']);
});
test('actual rebuild refuses dropped rows and non-scalar counts before journal mutation',async t=>{
  const f=await fixture(t,{count:'2',page:'[{"Name":"one.pdf","Path":"C:\\\\synthetic"},{}]'});await retained(f,'ES_INVALID_JSON');
  const count=await fixture(t,{count:'failure 0'});await retained(count,'ES_INVALID_COUNT');assert.deepEqual(count.commands,['count']);
});
test('native process output arriving after abort cannot authorize cache cleanup',async t=>{
  const f=await fixture(t,{abortPhase:'page'});await retained(f,'ABORT_ERR');assert.deepEqual(f.commands,['count','page']);
});
test('the caller checks cancellation again during the read-to-rebuild handoff',async t=>{
  const f=await fixture(t,{handoffAbort:true});await retained(f,'ABORT_ERR');assert.deepEqual(f.commands,['count','page','count']);
});
test('verified empty ES stdout remains an authoritative empty derived inventory',async t=>{
  const f=await fixture(t);const result=await f.root.rebuild({full:true,signal:f.controller.signal});assert.equal(result.removed,2);assert.equal(f.context.pdfFormIndex.size,0);
  assert.equal((await f.fresh()).entries.size,0);assert.equal(f.context.pdfFormIndexInventoryCount,0);assert.deepEqual(f.commands,['count','page','count']);
});
test('storage work already begun drains while a late stop prevents successful backlog publication',async t=>{
  const f=await fixture(t),append=f.context.appendPdfIndexJournal,backlog=f.context.pdfFormIndexBacklog;
  f.context.appendPdfIndexJournal=async records=>{await append(records);f.controller.abort()};
  await assert.rejects(f.root.rebuild({full:true,signal:f.controller.signal}),{code:'ABORT_ERR'});assert.equal((await f.fresh()).entries.size,0);assert.equal(f.context.pdfFormIndexBacklog,backlog);assert.equal(f.context.pdfFormIndexInventoryCount,2);
});
test('actual search refuses malformed process results before opaque-ID or success publication',async t=>{
  const f=await fixture(t,{page:'{"metadata":[]}'});let registered=0,pruned=0;Object.assign(f.context,{appendLog:async()=>{},pruneResults:()=>{pruned++},publicResult:()=>{registered++;return {id:'synthetic'}}});
  await assert.rejects(f.root.search('synthetic',2),{code:'ES_INVALID_JSON'});assert.equal(registered,0);assert.equal(pruned,0);
});
