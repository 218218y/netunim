import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {createEverythingProcess} from '../netunim-orders/document-bridge/everything-process.mjs';
import {createEverythingSession} from '../netunim-orders/document-bridge/everything-session.mjs';
import {createEverythingDiscovery} from '../netunim-orders/document-bridge/everything-discovery.mjs';
import {createEverythingProcessPlatform} from '../netunim-orders/document-bridge/everything-process-platform.mjs';
import {baseline,deferred,plain} from './everything_session_fixture.mjs';
const execute=promisify(execFile);
test('ES output, abort identity, exit/error messages and process options match the original transport',async()=>{
 for(const error of [undefined,null,{}, {code:8,stderr:' IPC failure \n'}, {code:'2',message:' process failure '},{code:'ENOENT',message:'missing'},{name:'AbortError',code:'ABORT_ERR'}, {code:'ABORT_ERR'}])for(const timeout of [undefined,3000]){
  const oldCalls=[],newCalls=[],output={stdout:'תוכן',stderr:''},options=timeout===undefined?{}:{timeout};
  const exec=async(file,args,opts)=>{oldCalls.push([file,args,opts]);if(error!==undefined)throw error;return output};
  const old=vm.runInNewContext(baseline.functions.runEs.source+'\nrunEs',{execFile:exec,APP_ROOT:'synthetic'});
  const current=createEverythingProcess({commands:{execute:async(file,args,{kind,timeout,signal})=>{newCalls.push([file,args,{encoding:'utf8',windowsHide:true,timeout,...(kind==='es'?{maxBuffer:16*1024*1024,cwd:'synthetic'}:{}),...(signal?{signal}:{})}]);if(error!==undefined)throw error;return output},launch:async()=>{}}});
  async function observe(work){try{return {value:await work()}}catch(value){if(error?.code==='ABORT_ERR')assert.equal(value,error);return {error:{name:value?.name,code:value?.code,message:value?.message,exitCode:value?.exitCode,stderr:value?.stderr}}}}
  assert.deepEqual(plain(await observe(()=>current.es('es.exe',['query'],options))),plain(await observe(()=>old('es.exe',['query'],options))));assert.deepEqual(plain(newCalls),plain(oldCalls));await current.dispose();
 }
});
test('disposal joins accepted generic/ES/launch commands and rejects commands that have not entered execution',async()=>{
 for(const kind of ['command','es','start']){
  const entered=deferred(),held=deferred();let calls=0;const work=async()=>{calls++;entered.resolve();await held.promise;return{stdout:''}};
  const owner=createEverythingProcess({commands:{execute:work,launch:async()=>{await work()}}});
  const accepted=owner[kind]('synthetic',[]);await entered.promise;let done=false;const stopping=owner.dispose().then(()=>{done=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
  await assert.rejects(owner[kind]('late',[]),{code:'EVERYTHING_PROCESS_DISPOSED'});held.resolve();await Promise.all([accepted,stopping]);assert.equal(calls,1);
 }
 const owner=createEverythingProcess({commands:{execute:async()=>{throw new Error('must not launch')},launch:async()=>{throw new Error('must not launch')}}});
 const accepted=owner.start('synthetic',[]),rejected=assert.rejects(accepted,{code:'EVERYTHING_PROCESS_DISPOSED'});await Promise.all([owner.dispose(),rejected]);
});
test('native platform retains ES cwd/Unicode/large output, timeout and abort and handles missing-app spawn failure',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-process-עברית-'));assert.equal(path.dirname(root),path.resolve(os.tmpdir()));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const owner=createEverythingProcess(createEverythingProcessPlatform({root}));t.after(()=>owner.dispose());
 const result=await owner.es(process.execPath,['-e',"process.stdout.write(JSON.stringify({cwd:process.cwd(),text:'תוכן'}))"]);assert.deepEqual(JSON.parse(result.stdout),{cwd:root,text:'תוכן'});
 assert.equal((await owner.es(process.execPath,['-e',"process.stdout.write('x'.repeat(1200000))"])).stdout.length,1200000);
 await assert.rejects(owner.es(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:60}));
 const abort=new AbortController(),pending=owner.es(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:abort.signal});abort.abort();await assert.rejects(pending,{code:'ABORT_ERR'});
 await assert.rejects(owner.start(path.join(root,'missing-app.exe'),[]),{code:'ENOENT'});
 assert.equal((await owner.command(process.execPath,['-e',"process.stdout.write('still alive')"])).stdout,'still alive');
});
test('the original unhandled launch error kills an isolated baseline worker; the current platform rejects it',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-old-launch-'));assert.equal(path.dirname(root),path.resolve(os.tmpdir()));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await assert.rejects(execute(process.execPath,[fileURLToPath(new URL('./fixtures/everything_launch_baseline.mjs',import.meta.url)),root],{windowsHide:true}),error=>error.code!==0&&/ENOENT/.test(error.stderr));
 const owner=createEverythingProcess(createEverythingProcessPlatform({root}));await assert.rejects(owner.start(path.join(root,'missing-app.exe'),[]),{code:'ENOENT'});await owner.dispose();
});
test('actual server composition joins direct ES work as well as session and discovery during shutdown',async()=>{
 const entered=deferred(),held=deferred();
 const source=await fs.readFile(new URL('../netunim-orders/document-bridge/server.mjs',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const selected=ast.body.filter(node=>node.type==='FunctionDeclaration'&&['whereEs','findEverythingExecutable','runEs','probeEverything','prepareShutdown'].includes(node.id.name)||node.type==='VariableDeclaration'&&node.declarations.some(item=>['everythingSession','everythingDiscovery','everythingProcesses'].includes(item.id.name)));
 const context={createEverythingProcess,createEverythingSession,createEverythingDiscovery,
  createEverythingProcessPlatform:()=>({commands:{execute:async(_file,args)=>{if(args[0]==='held'){entered.resolve();await held.promise}return{stdout:'Everything'}},launch:async()=>{}}}),
  createEverythingDiscoveryPlatform:()=>({locations:{esCandidates:['synthetic'],direct:()=>[],registryKeys:[],known:[],windows:false},files:{exists:async()=>true},commands:{where:async()=>'',registry:async()=>''},paths:{executables:()=>[]}}),
  loadConfig:async()=>({everythingInstance:'',everythingExecutable:'',searchTimeoutMs:15000,allowedOrigins:[]}),saveConfig:async()=>{},Date,setTimeout,appendLog:async()=>{},APP_ROOT:'synthetic',shuttingDown:false,
  documentSearch:{dispose:async()=>{}},documentResults:{dispose:()=>{}},previewTextCache:{dispose:()=>{}},manualMaintenance:{dispose:async()=>{}},nativePreviewSession:{dispose:async()=>{}},process:{pid:10}};
 const root=vm.runInNewContext(selected.map(node=>source.slice(node.start,node.end)).join('\n')+'\n({probe:probeEverything,run:runEs,stop:prepareShutdown})',context);
 await root.probe();const reading=root.run('synthetic',['held']);await entered.promise;
 let done=false;const stopped=root.stop().then(()=>{done=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
 await assert.rejects(root.run('synthetic',['late']),{code:'EVERYTHING_PROCESS_DISPOSED'});held.resolve();await Promise.all([reading,stopped]);assert.equal(done,true);
});
