import {createPdfInventoryReconciliation} from '../netunim-orders/document-bridge/pdf-inventory-reconciliation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {createPdfMaintenanceOperation} from '../netunim-orders/document-bridge/pdf-maintenance-operation.mjs';
import {readPdfMaintenanceMetadata} from '../netunim-orders/document-bridge/pdf-maintenance-platform.mjs';
import {pdfIndexNeedsInspection,pdfMaintenanceInventoryPlan} from '../netunim-orders/document-bridge/pdf-index-policy.mjs';
import {indexFixture} from './pdf_index_file_fixture.mjs';
import {limits,deferred,workRow} from './pdf_maintenance_fixture.mjs';

async function fixture(t,{write}={}){
 const disk=await indexFixture(t);await disk.read();const metadataPath=path.join(path.dirname(disk.snapshotPath),'maintenance.json');
 const source=await fs.readFile(new URL('../netunim-orders/document-bridge/server.mjs',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const selected=ast.body.filter(node=>node.type==='FunctionDeclaration'&&['pdfIndexFingerprint','rebuildPdfFormIndexBacklog','refreshPdfFormIndex','prepareShutdown'].includes(node.id.name)||node.type==='VariableDeclaration'&&node.declarations.some(item=>['pdfReconciliation','pdfMaintenanceOperation'].includes(item.id.name)));
 let writes=0;Object.assign(disk.context,{...limits,createPdfInventoryReconciliation,createPdfMaintenanceOperation,readPdfMaintenanceMetadata,PDF_FORM_MAINTENANCE_PATH:metadataPath,AbortController,setTimeout,clearTimeout,process:{cpuUsage:()=>({user:0,system:0}),pid:10},shuttingDown:false,pdfMaintenanceStopRequested:false,
  writeJsonFile:async(file,value)=>{writes++;if(write)await write(value);await fs.writeFile(file,JSON.stringify(value))},appendLog:async()=>{},pdfIndexNeedsInspection,pdfMaintenanceInventoryPlan,
  pdfInventory:{read:async()=>[workRow(3)],assertActive:signal=>{if(signal?.aborted)throw Object.assign(new Error('stopped'),{code:'ABORT_ERR'})}},
  extractInteractivePdfText:async()=>({hasForm:true,text:'native indexed result',formFields:[],formFieldCount:0}),
  documentSearch:{dispose:async()=>{}},documentResults:{dispose:()=>{}},everythingSession:{dispose:async()=>{}},everythingDiscovery:{dispose:async()=>{}},everythingProcesses:{dispose:async()=>{}},manualMaintenance:{dispose:async()=>{}},pdfPreviewOperation:{dispose:async()=>{},invalidate:async()=>{}},pdfExtractionProcesses:{dispose:async()=>{}},nativePreviewSession:{dispose:async()=>{}}});
 const invalidate=disk.context.previewTextCache.invalidate;disk.context.previewTextCache={invalidate,dispose:()=>{}};
 const root=vm.runInNewContext(selected.map(node=>source.slice(node.start,node.end)).join('\n')+'\n({refresh:refreshPdfFormIndex,stop:prepareShutdown})',disk.context);
 return {...disk,...root,metadataPath,writes:()=>writes};
}
test('actual server inventory/batch/operation writes one verified native index and checkpoint',async t=>{
 const f=await fixture(t),result=await f.refresh({force:true});assert.equal(result.processed,1);assert.equal(result.removed,2);assert.equal(result.pending,0);
 const recovered=await f.fresh();assert.equal(recovered.entries.size,1);assert.equal(recovered.entries.get(workRow(3).fullPath.toLowerCase()).text,'native indexed result');
 assert.ok(JSON.parse(await fs.readFile(f.metadataPath,'utf8')).lastSuccessfulAt);await f.stop();
});
test('actual server checkpoint admission retains corrupt bytes and both native index files',async t=>{
 const f=await fixture(t),before=await f.capture(),raw='{"lastResult":';await fs.writeFile(f.metadataPath,raw);
 await assert.rejects(f.refresh({force:true}),{code:'PDF_MAINTENANCE_METADATA_INVALID'});assert.equal(await fs.readFile(f.metadataPath,'utf8'),raw);assert.deepEqual(await f.capture(),before);assert.equal(f.writes(),0);await f.stop();
});
test('actual server shutdown joins accepted checkpoint publication before reporting completion',async t=>{
 const entered=deferred(),release=deferred(),f=await fixture(t,{write:async value=>{if(value.lastResult){entered.resolve();await release.promise}}});
 const reading=f.refresh({force:true});await entered.promise;let done=false;const stopping=f.stop().then(()=>{done=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
 await assert.rejects(f.refresh(),{code:'PDF_MAINTENANCE_DISPOSED'});release.resolve();await Promise.all([reading,stopping]);assert.equal(done,true);assert.ok(JSON.parse(await fs.readFile(f.metadataPath,'utf8')).lastSuccessfulAt);
});
test('actual server refuses false zero evidence and verifies nullable/blank historical pending before checkpoint success',async t=>{
 for(const pending of [[],false,null,'']){
  const f=await fixture(t),before=await f.capture(),raw=JSON.stringify({lastResult:{pending},lastSuccessfulAt:new Date().toISOString()});await fs.writeFile(f.metadataPath,raw);
  if(pending===null||pending===''){
   const result=await f.refresh();assert.equal(result.processed,1);assert.notEqual(result.skipped,true);assert.equal(JSON.parse(await fs.readFile(f.metadataPath,'utf8')).lastResult.pending,0);
  }else{
   await assert.rejects(f.refresh(),{code:'PDF_MAINTENANCE_METADATA_INVALID'});assert.equal(await fs.readFile(f.metadataPath,'utf8'),raw);assert.deepEqual(await f.capture(),before);assert.equal(f.writes(),0);
  }
  await f.stop();
 }
});
