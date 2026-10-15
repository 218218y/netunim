import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createDocumentOperations} from '../netunim-orders/document-bridge/document-operations.mjs';
import {createBridgeService} from '../netunim-orders/document-bridge/bridge-service.mjs';
import {createDocumentCommandOwner,joinDocumentReads} from '../netunim-orders/document-bridge/document-command-owner.mjs';
import {createPreviewTextCache} from '../netunim-orders/document-bridge/preview-text-cache.mjs';

function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const noop=()=>{},disposable=()=>({dispose:async()=>{}});
function serviceFixture({commands=createDocumentCommandOwner(),manual=disposable(),host={platform:'linux',argv:[],pid:10}}={}) {
  const events=[];
  const service=createBridgeService({
    files:{init:async()=>events.push('init'),ensureToken:async()=> 'token',readJsonFile:async()=>({}),privateNodeRuntimeInfoSync:noop,appendLog:async text=>events.push(text)},
    search:{probeEverything:async()=>({}),diagnoseIndex:async()=>({probe:{},diagnostics:{}}),documentSearch:disposable(),everythingSession:disposable(),everythingDiscovery:disposable(),everythingProcesses:disposable()},
    pdf:{index:{index:{load:async()=>{}},view:()=>({interactive:0,inspected:0,pending:0,updatedAt:0})},operation:disposable(),preview:disposable(),extraction:disposable(),paths:{},policy:{}},
    documents:{documentCommands:commands,documentResults:{dispose:noop},previewTextCache:{dispose:noop},nativePreviewSession:disposable()},
    maintenance:{manualMaintenance:manual,activePdfMaintenanceLock:async()=>false},installation:{printDoctor:async()=>events.push('doctor'),writeInstallSummary:async()=>events.push('summary'),stopExisting:async()=>events.push('stop'),checkRunning:async()=>events.push('check')},listener:{host,createServer:()=>assert.fail('construction cannot start listener'),handler:noop},
  });
  return {service,events};
}
async function operationsFixture(t,{kind='text',execute,content,pdfRead,factory=createDocumentOperations}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'document-commands-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,kind==='pdf'?'file.pdf':'file.txt');await fs.writeFile(file,'synthetic');
  const stat=await fs.stat(file),events=[],row={fullPath:file,query:'synthetic',mode:'content',contentSearch:{}};
  const owner=factory({registry:{resolve:async id=>{assert.equal(id,'opaque');return {row,stat}},invalidate:()=>{events.push('invalidate');return ['opaque']}},preview:{files:{readText:async()=>({text:'synthetic',truncated:false}),readBinary:async()=>new Uint8Array()},cache:createPreviewTextCache({clock:Date.now,ttlMs:10000,maxEntries:2})},pdf:{index:{remove:async target=>{events.push('index');await fs.appendFile(path.join(root,'journal'),target)}},preview:{read:pdfRead??(async()=>null),invalidate:async()=>events.push('pdf-invalidate')},policy:{PDF_FORM_SEARCH_TEXT_REVISION:2,PDF_FORM_GEOMETRY_REVISION:1}},native:{isRunning:()=>false},search:{loadConfig:async()=>({searchTimeoutMs:100}),probeEverything:async()=>({}),runEs:content??(async()=>({stdout:''}))},platform:{host:{platform:'win32',env:{}},execFile:execute??(async()=>{await fs.unlink(file)}),stat:target=>fs.stat(target)},audit:{write:async text=>events.push(text)}});
  return {owner,file,root,events};
}
test('actual shutdown joins accepted recycle command, native absence verification, index invalidation and audit',async t=>{
  const entered=gate(),release=gate();let f;
  f=await operationsFixture(t,{execute:async()=>{entered.resolve();await release.promise;await fs.unlink(f.file)}});
  const deleting=f.owner.files.delete('opaque');await entered.promise;
  const {service}=serviceFixture({commands:f.owner.runtime});let done=false;
  const shutdown=service.shutdown.prepare().then(()=>{done=true});await tick();assert.equal(done,false);
  await assert.rejects(f.owner.files.open('opaque'),{code:'DOCUMENT_COMMANDS_DISPOSED'});
  await assert.rejects(service.service.status(),{code:'DOCUMENT_COMMANDS_DISPOSED'});
  release.resolve();assert.equal((await deleting).ok,true);await shutdown;
  assert.equal(done,true);assert.deepEqual(f.events.slice(0,3),['invalidate','pdf-invalidate','index']);
  assert.ok(f.events.at(-1).startsWith('DELETE '));assert.equal(await fs.readFile(path.join(f.root,'journal'),'utf8'),f.file);
});
test('shutdown failure still joins every accepted command before rejecting',async()=>{
  const release=gate(),commands=createDocumentCommandOwner(),failure=Error('worker drain failed');
  const accepted=commands.run(()=>release.promise),{service}=serviceFixture({commands,manual:{dispose:async()=>{throw failure}}});
  let finished=false;const shutdown=service.shutdown.prepare();shutdown.then(()=>{finished=true},()=>{finished=true});
  await tick();assert.equal(finished,false);release.resolve(true);await accepted;await assert.rejects(shutdown,error=>error===failure);
});
test('a failed PDF sibling cannot settle a document command or its drain before Everything finishes',async t=>{
  const entered=gate(),release=gate();
  const f=await operationsFixture(t,{kind:'pdf',content:async()=>{entered.resolve();return release.promise},pdfRead:async()=>{throw Error('PDF extraction failed')}});
  let done=false;const reading=f.owner.preview.matches('opaque');reading.then(()=>{done=true},()=>{done=true});
  await entered.promise;f.owner.runtime.close();const drained=f.owner.runtime.drain();await tick();assert.equal(done,false);
  release.resolve({stdout:''});await assert.rejects(reading,/PDF extraction failed/);await drained;
});
test('negative join mutation reproduces early rejection while a sibling is still working',async()=>{
  const failure=Error('first'),release=gate();let settled=false;
  const unsafe=Promise.all([Promise.reject(failure),release.promise]);unsafe.catch(()=>{settled=true});await tick();assert.equal(settled,true);
  let joined=false;const safe=joinDocumentReads([Promise.reject(failure),release.promise]);safe.catch(()=>{joined=true});await tick();assert.equal(joined,false);
  release.resolve();await assert.rejects(safe,error=>error===failure);
});
for(const [arg,expected] of [['--init','init'],['--doctor','doctor'],['--write-install-summary','summary'],['--check-running','check'],['--stop-existing','stop']])test('actual service CLI preserves '+arg,async()=>{
  const {service,events}=serviceFixture({host:{platform:'linux',argv:['node','bridge',arg],pid:10}});assert.deepEqual(events,[]);await service.main();assert.deepEqual(events,[expected]);
});

test('implementation mutation exposes the lost sibling lifetime in the actual document coordinator',async t=>{
  let source=await fs.readFile('netunim-orders/document-bridge/document-operations.mjs','utf8');
  assert.equal(source.split('await joinDocumentReads(').length,2);
  source=source.replace('await joinDocumentReads(','await Promise.all(').replace(/from '(\.[^']+)'/g,(_match,file)=>'from '+JSON.stringify(new URL('../netunim-orders/document-bridge/'+file,import.meta.url).href));
  const {createDocumentOperations:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const entered=gate(),release=gate(),f=await operationsFixture(t,{factory:unsafe,kind:'pdf',content:async()=>{entered.resolve();return release.promise},pdfRead:async()=>{throw Error('PDF extraction failed')}});
  const reading=f.owner.preview.matches('opaque'),rejected=assert.rejects(reading,/PDF extraction failed/);await entered.promise;
  await rejected;f.owner.runtime.close();await f.owner.runtime.drain();
  // The broken implementation drains before this accepted provider completes.
  release.resolve({stdout:''});
});

test('unmodified production entrypoint initializes only its isolated runtime and preserves token', {skip:process.platform==='win32'},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'document-cli-composition-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const run=promisify(execFile),entry=fileURLToPath(new URL('../netunim-orders/document-bridge/server.mjs',import.meta.url)),env={...process.env,NETUNIM_DOCUMENT_BRIDGE_HOME:root};
  await run(process.execPath,[entry,'--init'],{env,windowsHide:true,timeout:10000});
  const token=await fs.readFile(path.join(root,'bridge-token.txt'),'utf8');assert.ok(token.trim());
  const printed=await run(process.execPath,[entry,'--print-token'],{env,windowsHide:true,timeout:10000});assert.equal(printed.stdout.trim(),token.trim());
  assert.ok(JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8')));assert.equal((await fs.readdir(root)).some(name=>name.includes('pdf-form-index')),false);
});
