import {createWindowsProcessControl} from '../netunim-orders/document-bridge/windows-process-control.mjs';
﻿import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createBridgeReplacementCommand} from '../netunim-orders/document-bridge/bridge-replacement-command.mjs';
import {BRIDGE_SERVICE,BRIDGE_VERSION} from '../netunim-orders/document-bridge/lib.mjs';
const refused=()=>Object.assign(Error('not listening'),{code:'ECONNREFUSED'});
const installationId='a'.repeat(32);
const health=(pid=42)=>({statusCode:200,data:{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,pid,pairingProtocol:1,installationId}});
const legacyHealth=(pid=42)=>({statusCode:200,data:{ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,pid}});
function fixture(replies,{alive=false,token='private-token',shutdown=200,platform='win32'}={}){
 const requests=[],processes=[],logs=[];let now=0,tokenReads=0;
 const ports={token:{path:'synthetic-token',read:async()=>{tokenReads++;return token}},listener:{port:8766,installationId,allowedOrigins:async()=>['https://orders.bargig-furniture.com'],request:(options,receive)=>{
  requests.push(options);const request=new EventEmitter();request.setTimeout=(ms)=>{request.deadline=ms;return request};request.destroy=error=>request.emit('error',error);request.end=()=>queueMicrotask(()=>{
   const next=replies.length?replies.shift():options.path==='/shutdown'?{statusCode:shutdown,data:{ok:true}}:refused();if(next instanceof Error){request.emit('error',next);return}
   const response=new EventEmitter();response.statusCode=next.statusCode;response.headers=next.headers;receive(response);response.emit('data',Buffer.from(JSON.stringify(next.data)));response.emit('end');
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
for(const code of ['ETIMEDOUT','ECONNRESET'])test('inconclusive listener probe prevents replacement '+code,async()=>{
 const unknown=Object.assign(Error('fixture connection failed'),{code});
 const f=fixture([unknown]);
 await assert.rejects(f.api.stopExisting(),{code});
 assert.equal(f.tokenReads(),0);assert.deepEqual(f.processes,[]);
 const drained=fixture([legacyHealth(),{statusCode:200,data:{ok:true}},...Array(32).fill(unknown)]);
 await assert.rejects(drained.api.stopExisting(),{code});
});
test('another service cannot authorize shutdown, token access or process termination',async()=>{
 const f=fixture([{statusCode:200,data:{service:'another-service',pid:42}}]);await assert.rejects(f.api.stopExisting(),{code:'PORT_IN_USE'});assert.equal(f.tokenReads(),0);assert.deepEqual(f.processes,[]);assert.equal(f.requests.length,1);
});
test('a missing private token prevents shutdown before any process termination',async()=>{
 const f=fixture([legacyHealth()],{token:''});await assert.rejects(f.api.stopExisting(),{code:'TOKEN_MISSING'});assert.equal(f.requests.length,1);assert.deepEqual(f.processes,[]);
});
test('a refused shutdown never escalates to taskkill',async()=>{
 const f=fixture([legacyHealth(),{statusCode:403,data:{}}]);await assert.rejects(f.api.stopExisting(),{code:'SHUTDOWN_FAILED'});assert.equal(f.processes.some(row=>row.command==='taskkill.exe'),false);
});
test('force termination follows an accepted shutdown and waits for the known process to exit',async()=>{
 const f=fixture([legacyHealth(),{statusCode:200,data:{ok:true}},refused()],{alive:true});await f.api.stopExisting();
 assert.equal(f.requests[1].path,'/shutdown');assert.equal(f.requests[1].headers.Authorization,'Bearer private-token');const kill=f.processes.find(row=>row.command==='taskkill.exe');assert.deepEqual(kill.args,['/PID','42','/T','/F']);assert.equal(kill.options.windowsHide,true);assert.equal(f.logs.length,1);assert.match(f.logs[0],/listener-closed-process-still-running/);
});
test('an already exited process needs no forced termination',async()=>{
 const f=fixture([legacyHealth(),{statusCode:200,data:{ok:true}},refused()]);await f.api.stopExisting();assert.equal(f.processes.some(row=>row.command==='taskkill.exe'),false);
});
test('PID discovery stays with the validated service and exact listening port',async()=>{
 const f=fixture([legacyHealth(0),{statusCode:200,data:{ok:true}},refused()]);await f.api.stopExisting();assert.equal(f.processes[0].command,'netstat.exe');assert.equal(f.processes[0].options.windowsHide,true);
});
for(const response of [{...health(),statusCode:503},{...health(),data:{...health().data,version:BRIDGE_VERSION-1}},{...health(),data:{...health().data,service:'other'}}])test('check-running rejects mismatched service health '+JSON.stringify(response),async()=>{
 const f=fixture([response]);await assert.rejects(f.api.checkRunning(),{code:'HEALTHCHECK_FAILED'});assert.equal(f.tokenReads(),0);assert.deepEqual(f.processes,[]);
});

for(const [label,change] of [['pre-pairing listener',{pairingProtocol:undefined}],
 ['earlier pairing build',{installationId:undefined}],['previous installation',{installationId:'b'.repeat(32)}]])test('check-running rejects same-version '+label,async()=>{
 const f=fixture([{...health(),data:{...health().data,...change}}]);
 await assert.rejects(f.api.checkRunning(),{code:'INSTALLATION_MISMATCH'});
 assert.equal(f.requests.length,1);assert.equal(f.tokenReads(),0);assert.deepEqual(f.processes,[]);
});

test('replacement command rejects incomplete I/O capabilities before any work',()=>{
 const f=fixture([]);assert.throws(()=>createBridgeReplacementCommand({...f.ports,listener:{...f.ports.listener,port:0}}),/document_replacement_ports_required/);
 assert.throws(()=>createBridgeReplacementCommand({...f.ports,token:{path:'synthetic'}}),/document_replacement_ports_required/);assert.deepEqual(f.requests,[]);assert.deepEqual(f.processes,[]);
 assert.throws(()=>createBridgeReplacementCommand({...f.ports,listener:{...f.ports.listener,allowedOrigins:null}}),/document_replacement_ports_required/);
});

const website='https://orders.bargig-furniture.com';
const cors={'access-control-allow-origin':website,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Authorization,Content-Type','access-control-allow-private-network':'true'};
const preflight=()=>({statusCode:204,data:{},headers:{...cors}});
const websiteHealth=()=>({...health(),headers:{'access-control-allow-origin':website}});
test('check-running proves browser preflight and health without reading the private token or entering a capability',async()=>{
 const f=fixture([health(),preflight(),websiteHealth()]);assert.deepEqual(await f.api.checkRunning(),health().data);
 assert.deepEqual(f.requests.map(row=>[row.method,row.path,row.headers.Origin]),[['GET','/health',undefined],['OPTIONS','/documents/search',website],['GET','/health',website]]);
 assert.equal(f.requests[1].headers['Access-Control-Request-Headers'],'authorization,content-type');
 assert.equal(f.requests.some(row=>row.headers.Authorization),false);assert.equal(f.tokenReads(),0);assert.deepEqual(f.processes,[]);
});
test('installer waits for a late listener and then verifies its identity and browser preflight',async()=>{
 const timedOut=Object.assign(new Error('fixture stalled'),{code:'ETIMEDOUT'});
 const f=fixture([refused(),timedOut,health(),preflight(),websiteHealth()]);
 assert.deepEqual(await f.api.waitForStartup(),health().data);
 assert.deepEqual(f.requests.map(({method,path})=>[method,path]),[
  ['GET','/health'],['GET','/health'],['GET','/health'],['OPTIONS','/documents/search'],['GET','/health'],
 ]);
 assert.equal(f.tokenReads(),0);
});
test('installer waiting is bounded and never retries a different installation',async()=>{
 const offline=fixture([]);
 await assert.rejects(offline.api.waitForStartup(),{code:'ECONNREFUSED'});
 assert.ok(offline.ports.runtime.now()>=10000&&offline.ports.runtime.now()<10200);
 const stale=fixture([{...health(),data:{...health().data,installationId:'b'.repeat(32)}}]);
 await assert.rejects(stale.api.waitForStartup(),{code:'INSTALLATION_MISMATCH'});
 assert.equal(stale.requests.length,1);
});
for(const [label,alter] of [
 ['rejected preflight',reply=>{reply.statusCode=403}],
 ['missing CORS',reply=>{delete reply.headers['access-control-allow-origin']}],
 ['foreign CORS',reply=>{reply.headers['access-control-allow-origin']='https://other.example'}],
 ['missing POST',reply=>{reply.headers['access-control-allow-methods']='GET,OPTIONS'}],
 ['missing Bearer header',reply=>{reply.headers['access-control-allow-headers']='Content-Type'}],
 ['missing JSON header',reply=>{reply.headers['access-control-allow-headers']='Authorization'}],
 ['missing private network grant',reply=>{delete reply.headers['access-control-allow-private-network']}],
])test('check-running rejects '+label+' even after healthy loopback response',async()=>{
 const reply=preflight();alter(reply);const f=fixture([health(),reply,websiteHealth()]);
 await assert.rejects(f.api.checkRunning(),{code:'ORIGIN_PREFLIGHT_FAILED'});assert.equal(f.tokenReads(),0);
});
for(const reply of [health(),{...websiteHealth(),statusCode:403},{...websiteHealth(),data:{service:'other',version:BRIDGE_VERSION}},
 {...websiteHealth(),data:{...health().data,installationId:'b'.repeat(32)}}])test('check-running rejects unreadable or foreign browser health '+JSON.stringify(reply),async()=>{
 const f=fixture([health(),preflight(),reply]);await assert.rejects(f.api.checkRunning(),{code:'ORIGIN_PREFLIGHT_FAILED'});
});
test('check-running retains explicit custom websites and rejects configurations with no usable website',async()=>{
 const f=fixture([health(),preflight(),websiteHealth()]);f.ports.listener.allowedOrigins=async()=>['https://custom.example'];
 await assert.rejects(f.api.checkRunning(),{code:'ORIGIN_PREFLIGHT_FAILED'});assert.equal(f.requests[1].headers.Origin,'https://custom.example');
 const g=fixture([health()]);g.ports.listener.allowedOrigins=async()=>['https://*.bargig-furniture.com','null'];
 await assert.rejects(g.api.checkRunning(),{code:'ORIGIN_CONFIGURATION_INVALID'});assert.equal(g.requests.length,1);
});
