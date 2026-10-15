import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createBridgeRuntimeFiles,bridgeDataRoot} from '../netunim-orders/document-bridge/bridge-runtime-files.mjs';
import {createPdfMaintenanceTaskDiagnostics} from '../netunim-orders/document-bridge/pdf-maintenance-task-diagnostics.mjs';
import {createBridgeInstallationDiagnostics} from '../netunim-orders/document-bridge/bridge-installation-diagnostics.mjs';
import {BRIDGE_NODE_VERSION,DEFAULT_ALLOWED_ORIGINS} from '../netunim-orders/document-bridge/lib.mjs';
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-runtime-owner-'));assert.ok(path.isAbsolute(dir));assert.ok(!path.relative(os.tmpdir(),dir).startsWith('..'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir}
test('runtime construction allocates no filesystem or process work',()=>{
 let calls=0;const io=new Proxy({},{get:()=>()=>{calls++;throw Error('unexpected I/O')}});const runtime=createBridgeRuntimeFiles({root:path.resolve('synthetic-runtime'),files:io,syncFiles:io});assert.equal(calls,0);assert.ok(Object.isFrozen(runtime.paths));
});
test('runtime file ownership preserves private token identity and config normalization',async t=>{
 const root=await directory(t),runtime=createBridgeRuntimeFiles({root});await runtime.init();const token=await runtime.ensureToken();assert.match(token,/^[a-f0-9]{64}$/);assert.equal(await runtime.ensureToken(),token);
 await runtime.saveConfig({everythingInstance:'  Private  ',everythingExecutable:' C:\\Everything.exe ',searchTimeoutMs:999999,allowedOrigins:['http://localhost:8766']});
 const config=await runtime.loadConfig();assert.equal(config.everythingInstance,'Private');assert.equal(config.searchTimeoutMs,30000);assert.deepEqual(config.allowedOrigins,['http://localhost:8766']);
 await runtime.appendLog('synthetic event');assert.match(await fs.readFile(runtime.paths.LOG_PATH,'utf8'),/synthetic event/);assert.equal((await fs.readdir(root)).some(name=>name.endsWith('.tmp')),false);
});
test('BOM config readers preserve historical optional settings and invalid JSON bytes',async t=>{
 const runtime=createBridgeRuntimeFiles({root:await directory(t)});await fs.writeFile(runtime.paths.CONFIG_PATH,'\uFEFF{"everythingInstance":"legacy"}');const config=await runtime.loadConfig();assert.equal(config.everythingInstance,'legacy');assert.deepEqual(config.allowedOrigins,DEFAULT_ALLOWED_ORIGINS);
 await fs.writeFile(runtime.paths.CONFIG_PATH,'{unfinished');await runtime.init();assert.equal(await fs.readFile(runtime.paths.CONFIG_PATH,'utf8'),'{unfinished','initialization cannot overwrite an existing undecodable local file');
});
test('default runtime roots respect the explicit home and local application directory',()=>{
 assert.equal(bridgeDataRoot({NETUNIM_DOCUMENT_BRIDGE_HOME:'explicit'},'unused'),'explicit');assert.equal(bridgeDataRoot({LOCALAPPDATA:'local'},'unused'),path.join('local','NetunimDocumentBridge'));
});
function nodeFixture({pointer='node-v24.21.0-win-x64-20261015-000000-1-1234abcd',version=BRIDGE_NODE_VERSION,missing=false,actual,readError=false}={},factory=createBridgeRuntimeFiles){
 const root=path.resolve('synthetic-runtime'),expected=path.join(root,pointer,'node.exe'),reads=[];
 const runtime=factory({root,host:{platform:'win32',versions:{node:version},execPath:actual||expected},syncFiles:{existsSync:()=>!missing,readFileSync:file=>{reads.push(file);if(readError)throw Error('no pointer');return file.endsWith('node-runtime.txt')?'\uFEFF'+pointer+'\n':Buffer.from('unreviewed executable')}}});
 return {runtime,reads};
}
test('private runtime verification retains the exact reviewed executable boundary',()=>{
 const f=nodeFixture();assert.equal(f.runtime.privateNodeRuntimeInfoSync().verified,true);assert.equal(f.reads.length,1);assert.throws(()=>f.runtime.privateNodeRuntimeInfoSync({verifyHash:true}),{code:'NODE_RUNTIME_INTEGRITY_MISMATCH'});
});
for(const [options,code] of [[{version:'22.0.0'},'NODE_RUNTIME_UNSUPPORTED'],[{readError:true},'NODE_RUNTIME_POINTER_MISSING'],[{pointer:'../node.exe'},'NODE_RUNTIME_POINTER_INVALID'],[{missing:true},'NODE_RUNTIME_MISSING'],[{actual:path.resolve('foreign-node.exe')},'NODE_RUNTIME_NOT_PRIVATE']])test('private runtime rejects '+code,()=>{
 assert.throws(()=>nodeFixture(options).runtime.privateNodeRuntimeInfoSync(),{code});
});
const readyTask={state:'Ready',enabled:true,triggerEnabled:true,lastRunTime:'2026-10-14T01:00:00Z',lastResult:0,nextRunTime:'2026-10-16T01:00:00Z',missedRuns:0,actionExecuteValid:true,actionRunnerValid:true,actionWorkingDirectoryValid:true};
function taskFixture(raw=readyTask){const calls=[],lines=[],root=path.resolve('synthetic root with spaces');const task=createPdfMaintenanceTaskDiagnostics({root,taskName:'NetunimDocumentBridgePdfMaintenance',host:{platform:'win32',env:{SYNTHETIC:'yes'},execute:async(...args)=>{calls.push(args);return {stdout:typeof raw==='string'?raw:JSON.stringify(raw)}}},output:{log:value=>lines.push(value)}});return {task,calls,lines,root}}
test('task diagnostics verify execute/runner/working directory using explicit environment data',async()=>{
 const f=taskFixture(),task=await f.task.pdfMaintenanceTaskDiagnostics();assert.equal(task.scheduleActive,true);assert.equal(task.actionValid,true);const [exe,args,options]=f.calls[0];assert.equal(exe,'powershell.exe');assert.ok(args.includes('-NonInteractive'));assert.equal(options.windowsHide,true);assert.equal(options.timeout,8000);assert.equal(options.env.NETUNIM_TASK_EXPECTED_RUNNER,path.join(f.root,'run_pdf_maintenance.ps1'));assert.equal(args.at(-1).includes(f.root),false);f.task.printPdfMaintenanceTaskDiagnostics(task);assert.ok(f.lines.some(line=>line.includes('schedule active=yes')));assert.ok(f.lines.some(line=>line.includes('0x00000000')));
});
for(const key of ['enabled','triggerEnabled','actionExecuteValid','actionRunnerValid','actionWorkingDirectoryValid'])test('task diagnostics cannot promote truthy '+key,async()=>{
 const f=taskFixture({...readyTask,[key]:'true'}),task=await f.task.pdfMaintenanceTaskDiagnostics();assert.equal(task.scheduleActive,false);
});
test('malformed task output remains diagnostic failure and unsupported platforms do not run PowerShell',async()=>{
 const f=taskFixture('{broken'),task=await f.task.pdfMaintenanceTaskDiagnostics();assert.equal(task.exists,false);assert.ok(task.error);
 let executed=false;const unsupported=createPdfMaintenanceTaskDiagnostics({root:'unused',taskName:'unused',host:{platform:'linux',execute:async()=>{executed=true}}});assert.equal((await unsupported.pdfMaintenanceTaskDiagnostics()).unsupported,true);assert.equal(executed,false);
});
function installFixture({taskReady=true,indexError='',nodeError=false}={},factory=createBridgeInstallationDiagnostics){
 const lines=[],written=[],calls=[];const files={paths:{APP_ROOT:'synthetic',LOG_PATH:'synthetic/log',SUMMARY_PATH:'synthetic/summary'},init:async()=>calls.push('init'),ensureToken:async()=>{calls.push('token');return 'private-local-token'},loadConfig:async()=>({}),existsFile:async()=>true,privateNodeRuntimeInfoSync:()=>{if(nodeError)throw Error('bad private node');return {actualPath:'private-node',sha256:'reviewed'}}};
 const task=taskFixture({...readyTask,enabled:taskReady}).task;
 const diagnostics=factory({runtime:{host:{platform:'win32',execPath:'private-node',versions:{node:BRIDGE_NODE_VERSION}},root:'runtime',previewHost:'preview.exe',files},search:{diagnoseIndex:async()=>({probe:{esPath:'es.exe'},diagnostics:{fileCount:2,indexedContentCount:1,sampleOk:true,error:indexError}}),findEverythingExecutable:async()=> 'Everything.exe'},pdf:{verifyNodePdfJsRuntime:async()=>({version:'pinned',runtime:'legacy'}),...task},files:{writeFile:async(...args)=>written.push(args)},output:{log:value=>lines.push(value)}});
 return {diagnostics,lines,written,calls};
}
test('doctor reports readiness and rejects an unready scheduled task by default',async()=>{
 const ready=installFixture();await ready.diagnostics.printDoctor();assert.equal(ready.calls.includes('token'),false);
 const f=installFixture({taskReady:false});await assert.rejects(f.diagnostics.printDoctor(),{code:'PDF_MAINTENANCE_TASK_DIAGNOSTICS_FAILED'});await f.diagnostics.printDoctor({allowUnreadyScheduledTask:true});
});
test('allow-unready-task never suppresses failed Everything diagnostics',async()=>{
 const f=installFixture({taskReady:false,indexError:'ES failure'});await assert.rejects(f.diagnostics.printDoctor({allowUnreadyScheduledTask:true}),{code:'INDEX_DIAGNOSTICS_FAILED'});
});
test('installation report retains local pairing and errors in its owned file',async()=>{
 const f=installFixture({nodeError:true});await f.diagnostics.writeInstallSummary();assert.equal(f.written.length,1);assert.equal(f.written[0][0],'synthetic/summary');assert.match(f.written[0][1],/private-local-token/);assert.match(f.written[0][1],/bad private node/);assert.equal(f.lines.includes('private-local-token'),false);assert.equal(f.lines.at(-1),'synthetic/summary');
});

async function mutatedFactory(file,from,to,name){
 const {readFileSync}=await import('node:fs'),url=new URL('../netunim-orders/document-bridge/'+file,import.meta.url),original=readFileSync(url,'utf8');
 let source=original.replace(from,to);assert.notEqual(source,original);source=source.replace(/from '(\.[^']+)'/g,(_,relative)=>'from '+JSON.stringify(new URL(relative,url).href));return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')))[name];
}
test('negative implementation: removing executable identity accepts a foreign Node process',async()=>{
 const factory=await mutatedFactory('bridge-runtime-files.mjs','if(normalizedRuntimePath(expectedPath)!==normalizedRuntimePath(actualPath))','if(false)','createBridgeRuntimeFiles');
 assert.equal(nodeFixture({actual:path.resolve('foreign-node.exe')},factory).runtime.privateNodeRuntimeInfoSync().verified,true,'the private-runtime scenario must detect this implementation mutation');
});
test('negative implementation: bypassing task readiness permits an invalid installation doctor result',async()=>{
 const factory=await mutatedFactory('bridge-installation-diagnostics.mjs','if(!task.unsupported&&!allowUnreadyScheduledTask&&(!task.exists||!task.scheduleActive))','if(false)','createBridgeInstallationDiagnostics');
 await installFixture({taskReady:false},factory).diagnostics.printDoctor();
});
