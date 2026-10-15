import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {parse} from 'acorn';
import {createMaintenanceProcessOwner} from '../netunim-orders/document-bridge/maintenance-process-owner.mjs';
import {createMaintenanceProcessPlatform} from '../netunim-orders/document-bridge/maintenance-process-platform.mjs';
import {deferred,fixture} from './maintenance_process_fixture.mjs';

const worker=fileURLToPath(new URL('./fixtures/maintenance_process_worker.mjs',import.meta.url));
async function native(t,mode='normal') {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-maintenance-owner-')),children=[],jobs=new Set(),messages=[];let stderr='';
  const ports={host:{isHeld:async()=>false,launch:()=>{
    const child=spawn(process.execPath,[worker,mode,root],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
    child.stderr.setEncoding('utf8');child.stderr.on('data',text=>{stderr+=text});
    child.on('message',message=>messages.push(message));child.closed=new Promise(resolve=>child.once('close',resolve));children.push(child);return child;
  },requestStop:child=>new Promise((resolve,reject)=>child.send({type:'stop-pdf-maintenance'},error=>error?reject(error):resolve()))},
    timers:{setTimeout:(callback,ms)=>{const timer=setTimeout(callback,ms);jobs.add(timer);return timer},clearTimeout:timer=>{jobs.delete(timer);clearTimeout(timer)}},now:()=>new Date().toISOString(),log:async()=>{}};
  const owner=createMaintenanceProcessOwner(ports,{drainTimeoutMs:10000});
  t.after(async()=>{for(const child of children){if(child.exitCode===null&&!child.killed)child.kill();await child.closed}for(const timer of jobs)clearTimeout(timer);await fs.rm(root,{recursive:true,force:true})});
  async function bounded(work) {let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`native worker did not settle: ${stderr}`)),12000)})])}finally{clearTimeout(timer)}}
  async function receive(kind) {
    const child=children.at(-1);const existing=messages.find(message=>message.kind===kind);if(existing)return existing;
    let listener;try{return await bounded(new Promise(resolve=>{listener=message=>{if(message.kind===kind)resolve(message)};child.on('message',listener)}))}finally{child.removeListener('message',listener)}
  }
  return {owner,ports,children,jobs,messages,root,receive,bounded,stderr:()=>stderr};
}

test('native IPC stop drains a real worker and concurrent start/stop never duplicates it',async t=>{
  const f=await native(t);await Promise.all([f.owner.start(),f.owner.start()]);await f.receive('ready');const child=f.children[0];
  await Promise.all([f.owner.stop(),f.owner.stop(),f.owner.dispose()]);await f.bounded(child.closed);
  assert.equal(f.children.length,1);assert.equal(child.exitCode,0);assert.equal(child.connected,false);assert.equal(f.owner.view().manual.running,false);
  assert.equal(f.owner.view().manual.result.aborted,true);assert.equal(f.jobs.size,0);assert.equal(child.listenerCount('error'),0);
});
test('native disposal waits for a started synthetic file commit; it never kills the worker',async t=>{
  const f=await native(t,'commit');await f.owner.start();await f.receive('ready');let complete=false;
  const disposal=f.owner.dispose().then(()=>{complete=true});await f.receive('stopping');
  assert.equal(complete,false);assert.equal(f.children[0].killed,false);await assert.rejects(fs.readFile(path.join(f.root,'commits.txt')),{code:'ENOENT'});
  f.children[0].send('release-commit');await f.bounded(disposal);assert.equal(await fs.readFile(path.join(f.root,'commits.txt'),'utf8'),'one retained commit\n');
  assert.equal(f.children[0].exitCode,0);assert.equal(f.owner.view().manual.result.processed,1);assert.equal(f.jobs.size,0);
});
test('production maintenance main disconnects IPC and exits after native init failure',async t=>{
  const f=await native(t,'production-init-failure');await f.owner.start();await f.bounded(f.children[0].closed);
  assert.equal(f.children[0].exitCode,1);assert.equal(f.children[0].connected,false);assert.match(f.stderr(),/synthetic maintenance init failure/);
  assert.equal(f.owner.view().manual.running,false);await f.owner.dispose();assert.equal(f.jobs.size,0);
});
test('native spawn error closes without exit and does not leave an active run',async t=>{
  const f=await native(t),platform=createMaintenanceProcessPlatform({executable:path.join(f.root,'missing-executable'),script:worker,cwd:f.root,isHeld:async()=>false});
  f.ports.host.launch=()=>{const child=platform.launch();child.closed=new Promise(resolve=>child.once('close',resolve));f.children.push(child);return child};
  await f.owner.start();await f.bounded(f.children[0].closed);assert.equal(f.owner.view().manual.running,false);assert.match(f.owner.view().manual.error,/ENOENT/);await f.owner.dispose();
});
test('the production process adapter launches the worker protocol and drains its IPC',async t=>{
  const f=await native(t),platform=createMaintenanceProcessPlatform({executable:process.execPath,script:worker,cwd:f.root,isHeld:async()=>false});
  f.ports.host.requestStop=platform.requestStop;f.ports.host.launch=()=>{
    const child=platform.launch();child.closed=new Promise(resolve=>child.once('close',resolve));f.children.push(child);
    child.on('message',message=>f.messages.push(message));return child;
  };
  await f.owner.start();await f.receive('ready');await f.owner.dispose();assert.equal(f.children[0].exitCode,0);assert.equal(f.children[0].connected,false);
});
test('actual server shutdown fences a pending lock probe and rejects completion without worker drain',async()=>{
  const source=await fs.readFile(new URL('../netunim-orders/document-bridge/server.mjs',import.meta.url),'utf8');
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),held=deferred(),f=fixture({host:{isHeld:()=>held.promise}});
  const names=['startManualPdfMaintenance','prepareShutdown'];const functions=ast.body.filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name));
  const context={manualMaintenance:f.owner,pdfMaintenanceStatus:async()=>({ok:true}),shuttingDown:false,previewTextCache:{dispose:()=>{}},nativePreviewSession:{dispose:async()=>{}},documentSearch:{dispose:async()=>{}},documentResults:{dispose:()=>{}},everythingSession:{dispose:async()=>{}},everythingDiscovery:{dispose:async()=>{}},everythingProcesses:{dispose:async()=>{}},pdfMaintenanceOperation:{dispose:async()=>{}},pdfPreviewOperation:{dispose:async()=>{},invalidate:async()=>{}},pdfExtractionProcesses:{dispose:async()=>{}},process:{pid:10}};
  const root=vm.runInNewContext(functions.map(node=>source.slice(node.start,node.end)).join('\n')+'\n({start:startManualPdfMaintenance,dispose:prepareShutdown})',context);
  const start=root.start(),rejected=assert.rejects(start,{code:'PDF_MAINTENANCE_DISPOSED'}),shutdown=root.dispose();held.resolve(false);await Promise.all([shutdown,rejected]);assert.equal(f.children.length,0);assert.equal(context.shuttingDown,true);
  const live=fixture();context.manualMaintenance=live.owner;await live.owner.start();const blocked=root.dispose();const rejectedShutdown=assert.rejects(blocked,{code:'PDF_MAINTENANCE_DRAIN_TIMEOUT'});[...live.timers.values()][0]();await rejectedShutdown;
  assert.equal(live.owner.view().manual.running,true);live.children[0].emit('close',1,null);await root.dispose();
});
test('actual maintenance status rechecks the manual owner after its scheduled-lock await',async()=>{
  const source=await fs.readFile(new URL('../netunim-orders/document-bridge/server.mjs',import.meta.url),'utf8');
  const declaration=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='pdfMaintenanceStatus');
  const held=deferred(),observing=deferred(),f=fixture();
  const status=vm.runInNewContext(source.slice(declaration.start,declaration.end)+'\npdfMaintenanceStatus',{
    readJsonFile:async()=>({}),PDF_FORM_MAINTENANCE_PATH:'synthetic',manualMaintenance:f.owner,BRIDGE_VERSION:38,
    activePdfMaintenanceLock:()=>{observing.resolve();return held.promise},
  });
  const pending=status();await observing.promise;await f.owner.start();held.resolve(false);const result=await pending;
  assert.equal(result.running,true);assert.equal(result.source,'manual');assert.equal(result.cancelable,true);f.children[0].emit('close',1,null);
});
