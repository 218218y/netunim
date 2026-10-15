import {createWindowsProcessControl} from '../netunim-orders/document-bridge/windows-process-control.mjs';
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createBridgeReplacementCommand} from '../netunim-orders/document-bridge/bridge-replacement-command.mjs';
import {BRIDGE_SERVICE,BRIDGE_VERSION} from '../netunim-orders/document-bridge/lib.mjs';
const refused=()=>Object.assign(Error('not listening'),{code:'ECONNREFUSED'});
const health=(pid=42)=>({statusCode:200,data:{service:BRIDGE_SERVICE,version:BRIDGE_VERSION,pid}});
function fixture(replies,{alive=false,token='private-token',shutdown=200,platform='win32'}={}){
 const requests=[],processes=[],logs=[];let now=0,tokenReads=0;
 const ports={token:{path:'synthetic-token',read:async()=>{tokenReads++;return token}},listener:{port:8766,request:(options,receive)=>{
  requests.push(options);const request=new EventEmitter();request.setTimeout=(ms)=>{request.deadline=ms;return request};request.destroy=error=>request.emit('error',error);request.end=()=>queueMicrotask(()=>{
   const next=replies.length?replies.shift():options.path==='/shutdown'?{statusCode:shutdown,data:{ok:true}}:refused();if(next instanceof Error){request.emit('error',next);return}
   const response=new EventEmitter();response.statusCode=next.statusCode;receive(response);response.emit('data',Buffer.from(JSON.stringify(next.data)));response.emit('end');
  });return request;
 }},processes:{platform,execute:async(command,args,options)=>{
  processes.push({command,args,options});if(command==='taskkill.exe'){alive=false;return {stdout:''}}if(command==='tasklist.exe')return {stdout:alive?'"node.exe","42","Console"':''};if(command==='netstat.exe')return {stdout:' TCP 127.0.0.1:8766 0.0.0.0:0 LISTENING 42\r\n'};throw Error('unexpected process command');
 }},runtime:{now:()=>now,setTimeout:(run,ms)=>{now+=ms;queueMicrotask(run);return 1},log:async text=>logs.push(text)}};
 ports.processes=createWindowsProcessControl({platform:ports.processes.platform,execute:ports.processes.execute,port:ports.listener.port,clock:{now:ports.runtime.now},timers:{setTimeout:ports.runtime.setTimeout}});
 return {api:createBridgeReplacementCommand(ports),ports,requests,processes,logs,tokenReads:()=>tokenReads};
}
test('replacement command construction does not read a token, probe a port or launch a process',()=>{
 const f=fixture([]);assert.deepEqual(f.requests,[]);assert.deepEqual(f.processes,[]);assert.equal(f.tokenReads(),0);
});
test('no existing listener needs no authorization or process operation',async()=>{
 const f=fixture([refused()]);await f.api.stopExisting();assert.equal(f.tokenReads(),0);assert.deepEqual(f.processes,[]);
});
test('another service cannot authorize shutdown, token access or process termination',async()=>{
 const f=fixture([{statusCode:200,data:{service:'another-service',pid:42}}]);await assert.rejects(f.api.stopExisting(),{code:'PORT_IN_USE'});assert.equal(f.tokenReads(),0);assert.deepEqual(f.processes,[]);assert.equal(f.requests.length,1);
});
test('a missing private token prevents shutdown before any process termination',async()=>{
 const f=fixture([health()],{token:''});await assert.rejects(f.api.stopExisting(),{code:'TOKEN_MISSING'});assert.equal(f.requests.length,1);assert.deepEqual(f.processes,[]);
});
test('a refused shutdown never escalates to taskkill',async()=>{
 const f=fixture([health(),{statusCode:403,data:{}}]);await assert.rejects(f.api.stopExisting(),{code:'SHUTDOWN_FAILED'});assert.equal(f.processes.some(row=>row.command==='taskkill.exe'),false);
});
test('force termination follows an accepted shutdown and waits for the known process to exit',async()=>{
 const f=fixture([health(),{statusCode:200,data:{ok:true}},refused()],{alive:true});await f.api.stopExisting();
 assert.equal(f.requests[1].path,'/shutdown');assert.equal(f.requests[1].headers.Authorization,'Bearer private-token');const kill=f.processes.find(row=>row.command==='taskkill.exe');assert.deepEqual(kill.args,['/PID','42','/T','/F']);assert.equal(kill.options.windowsHide,true);assert.equal(f.logs.length,1);assert.match(f.logs[0],/listener-closed-process-still-running/);
});
test('an already exited process needs no forced termination',async()=>{
 const f=fixture([health(),{statusCode:200,data:{ok:true}},refused()]);await f.api.stopExisting();assert.equal(f.processes.some(row=>row.command==='taskkill.exe'),false);
});
test('PID discovery stays with the validated service and exact listening port',async()=>{
 const f=fixture([health(0),{statusCode:200,data:{ok:true}},refused()]);await f.api.stopExisting();assert.equal(f.processes[0].command,'netstat.exe');assert.equal(f.processes[0].options.windowsHide,true);
});
for(const response of [{statusCode:503,data:{service:BRIDGE_SERVICE,version:BRIDGE_VERSION}},{statusCode:200,data:{service:BRIDGE_SERVICE,version:BRIDGE_VERSION-1}},{statusCode:200,data:{service:'other',version:BRIDGE_VERSION}}])test('check-running rejects mismatched service health '+JSON.stringify(response),async()=>{
 const f=fixture([response]);await assert.rejects(f.api.checkRunning(),{code:'HEALTHCHECK_FAILED'});assert.equal(f.tokenReads(),0);assert.deepEqual(f.processes,[]);
});

test('replacement command rejects incomplete I/O capabilities before any work',()=>{
 const f=fixture([]);assert.throws(()=>createBridgeReplacementCommand({...f.ports,listener:{...f.ports.listener,port:0}}),/document_replacement_ports_required/);
 assert.throws(()=>createBridgeReplacementCommand({...f.ports,token:{path:'synthetic'}}),/document_replacement_ports_required/);assert.deepEqual(f.requests,[]);assert.deepEqual(f.processes,[]);
});
