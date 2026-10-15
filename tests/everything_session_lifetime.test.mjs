import {joinDocumentReads} from '../netunim-orders/document-bridge/document-command-owner.mjs';
import {documentBridgeSource} from './document_bridge_source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createEverythingSession} from '../netunim-orders/document-bridge/everything-session.mjs';
import {fixture,deferred,plain} from './everything_session_fixture.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('a fast native IPC winner does not wait for the losing child, but session disposal joins both',async t=>{
 for(const version of ['baseline','current']){
  const children=[],ready=deferred();
  const f=fixture(version,{run:async(_file,args)=>{
   if(args[0]==='-version')return {stdout:'ES'};
   const child=fork(fileURLToPath(new URL('./fixtures/document_search_worker.mjs',import.meta.url)),[],{silent:true,windowsHide:true});
   let stdout='';const started=deferred(),closed=deferred();children.push({child,started,closed});
   child.stdout.on('data',chunk=>{stdout+=chunk});child.on('error',closed.reject);
   child.on('message',message=>{if(message?.kind==='ready'){started.resolve();if(children.length===2)ready.resolve()}});
   child.once('close',code=>code===0?closed.resolve({stdout}):closed.reject(new Error('synthetic child failed')));
   return closed.promise;
  }});
  t.after(async()=>{for(const record of children)if(record.child.exitCode===null){record.child.kill();await record.closed.promise.catch(()=>{})}});
  const probing=f.owner.probe();await ready.promise;await Promise.all(children.map(record=>record.started.promise));
  children[0].child.send({kind:'finish',stdout:'Everything'});const winner=await probing;assert.equal(winner.instance,'');assert.equal(children[1].child.exitCode,null);
  if(version==='current'){
   let done=false;const disposal=f.owner.dispose().then(()=>{done=true});await tick();assert.equal(done,false);
   await assert.rejects(f.owner.probe(),{code:'EVERYTHING_SESSION_DISPOSED'});
   children[1].child.send({kind:'finish',stdout:'late Everything'});await disposal;assert.equal(done,true);
  }else{children[1].child.send({kind:'finish',stdout:'late Everything'});await children[1].closed.promise}
 }
});
test('disposal during config, discovery or launch logging prevents later process launch and configuration publication',async()=>{
 for(const phase of ['config','executable','audit']){
  const held=deferred(),entered=deferred();
  const options={run:async(_file,args)=>{if(args[0]==='-version')return{stdout:'ES'};throw Object.assign(new Error('not running'),{exitCode:8})},
   [phase==='config'?'load':phase]:async()=>{entered.resolve();await held.promise;if(phase==='config')return{everythingInstance:'',everythingExecutable:'',searchTimeoutMs:15000,allowedOrigins:[]};return 'Everything.exe'}};
  const f=fixture('current',options),operation=f.owner.probe(),rejected=assert.rejects(operation,{code:'EVERYTHING_SESSION_DISPOSED'});await entered.promise;
  const stopping=f.owner.dispose();held.resolve();await Promise.all([stopping,rejected]);assert.equal(f.starts(),0);assert.deepEqual(f.saves,[]);
 }
});
test('configuration save already accepted drains; disposal cannot report success or publish its probe cache',async()=>{
 const entered=deferred(),held=deferred(),f=fixture('current',{preferred:'custom',run:async(_file,args)=>{if(args[0]==='-version')return{stdout:'ES'};if(args.includes('custom'))throw Object.assign(new Error('not running'),{exitCode:8});return{stdout:'Everything'}},save:async()=>{entered.resolve();await held.promise}});
 const operation=f.owner.probe(),rejected=assert.rejects(operation,{code:'EVERYTHING_SESSION_DISPOSED'});await entered.promise;
 let done=false;const stopping=f.owner.dispose().then(()=>{done=true});await tick();assert.equal(done,false);held.resolve();await Promise.all([stopping,rejected]);assert.equal(done,true);
 await assert.rejects(f.owner.probe(),{code:'EVERYTHING_SESSION_DISPOSED'});assert.equal(plain(f.saves).length,1);
});
test('actual server session composition and shutdown join a losing IPC probe after its fast winner returned',async()=>{
 const held=deferred(),f=fixture('current',{run:async(_file,args)=>{if(args[0]==='-version')return{stdout:'ES'};return args.includes('-instance')?held.promise:{stdout:'Everything'}}});
 const {source,ast}=documentBridgeSource();
 const selected=ast.body.filter(node=>node.type==='FunctionDeclaration'&&['probeEverything','prepareShutdown'].includes(node.id.name)||node.type==='VariableDeclaration'&&node.declarations.some(item=>item.id.name==='everythingSession'));
 const context={createEverythingSession,loadConfig:f.ports.configuration.load,saveConfig:f.ports.configuration.save,whereEs:f.ports.discovery.es,findEverythingExecutable:f.ports.discovery.executable,runEs:f.ports.process.run,
  spawn:()=>{throw new Error('unexpected launch')},Date:{now:()=>1000},setTimeout,appendLog:f.ports.audit.write,APP_ROOT:'synthetic',documentCommands:{dispose:async()=>{}},joinDocumentReads,shuttingDown:false,
  documentSearch:{dispose:async()=>{}},documentResults:{dispose:()=>{}},everythingDiscovery:{dispose:async()=>{}},everythingProcesses:{start:f.ports.process.start,dispose:async()=>{}},pdfMaintenanceOperation:{dispose:async()=>{}},pdfPreviewOperation:{dispose:async()=>{},invalidate:async()=>{}},pdfExtractionProcesses:{dispose:async()=>{}},previewTextCache:{dispose:()=>{}},manualMaintenance:{dispose:async()=>{}},nativePreviewSession:{dispose:async()=>{}},process:{pid:10}};
 const root=vm.runInNewContext(selected.map(node=>source.slice(node.start,node.end)).join('\n')+'\n({probe:probeEverything,stop:prepareShutdown})',context);
 await root.probe();let done=false;const stopping=root.stop().then(()=>{done=true});await tick();assert.equal(done,false);await assert.rejects(root.probe(),{code:'EVERYTHING_SESSION_DISPOSED'});
 held.resolve({stdout:'late Everything'});await stopping;assert.equal(done,true);
});
test('startup acknowledgement already accepted is joined without a later readiness probe or config write',async()=>{
 const entered=deferred(),held=deferred(),f=fixture('current',{run:async(_file,args)=>{if(args[0]==='-version')return{stdout:'ES'};throw Object.assign(new Error('not running'),{exitCode:8})},start:async()=>{entered.resolve();await held.promise}});
 const probing=f.owner.probe(),rejected=assert.rejects(probing,{code:'EVERYTHING_SESSION_DISPOSED'});await entered.promise;const calls=f.calls.length;
 let done=false;const stopping=f.owner.dispose().then(()=>{done=true});await tick();assert.equal(done,false);held.resolve();await Promise.all([stopping,rejected]);assert.equal(f.calls.length,calls);assert.deepEqual(f.saves,[]);
});
test('launch rejection is returned to the session caller without another probe, retry or config update',async()=>{
 const failure=Object.assign(new Error('missing executable'),{code:'ENOENT'}),f=fixture('current',{run:async(_file,args)=>{if(args[0]==='-version')return{stdout:'ES'};throw Object.assign(new Error('not running'),{exitCode:8})},start:async()=>{throw failure}});
 await assert.rejects(f.owner.probe(),error=>error===failure);assert.equal(f.starts(),1);assert.deepEqual(f.saves,[]);assert.equal(f.calls.filter(call=>call[0]==='synthetic-es').length,3);await f.owner.dispose();
});
