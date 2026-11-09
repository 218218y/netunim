import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createBridgeRuntimeFiles} from '../netunim-orders/document-bridge/bridge-runtime-files.mjs';
import {createDocumentBridgeHttpHandler} from '../netunim-orders/document-bridge/http-handler.mjs';
import {createBridgeReplacementCommand} from '../netunim-orders/document-bridge/bridge-replacement-command.mjs';
import {BRIDGE_SERVICE,BRIDGE_VERSION,DEFAULT_ALLOWED_ORIGINS} from '../netunim-orders/document-bridge/lib.mjs';

// Exact defaults shipped before 266dc479 added the Kupa website to the service.
// Includes the original ordering found in old per-computer config.json files.
const ordersOnlyLegacy=['https://bargig-furniture.com','https://*.bargig-furniture.com',
  'https://bargig-orders.pages.dev','https://*.bargig-orders.pages.dev','http://localhost:*','http://127.0.0.1:*'];

test('reinstalled legacy config serves every production website while preserving pairing, folder consent and custom restrictions',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-origin-upgrade-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const runtime=createBridgeRuntimeFiles({root});
  const original={allowedOrigins:ordersOnlyLegacy,roots:[{path:'Z:\\Business'}],allowDriveRoots:true,everythingInstance:'Private',searchTimeoutMs:9000};
  await fs.writeFile(runtime.paths.CONFIG_PATH,'\uFEFF'+JSON.stringify(original));
  await fs.writeFile(runtime.paths.TOKEN_PATH,'synthetic-pairing-token\n');
  let entries=0;
  const routes=new Map(['POST /documents/warm','GET /documents/pdf-index/status','POST /documents/recent',
    'POST /documents/search','POST /documents/native-preview/hide'].map(key=>[key,{readBody:key.startsWith('POST'),run:async()=>{entries++;return {ok:true}}}]));
  const handler=createDocumentBridgeHttpHandler({loadConfig:runtime.loadConfig,readToken:runtime.ensureToken,routes,
    health:()=>({ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION}),appendLog:async()=>{}});
  const server=http.createServer((req,res)=>handler(req,res).catch(error=>{res.writeHead(500);res.end(error.message)}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
  const port=server.address().port,base=`http://127.0.0.1:${port}`;
  const fail=()=>{throw Error('acceptance must not read token, launch or terminate processes')};
  const replacement=createBridgeReplacementCommand({token:{path:runtime.paths.TOKEN_PATH,read:fail},
    listener:{port,request:http.request,allowedOrigins:async()=>(await runtime.loadConfig()).allowedOrigins},
    processes:{bridgeListenerPid:fail,forceStopProcessTree:fail,waitForProcessExit:fail},runtime:{now:Date.now,setTimeout,log:fail}});
  assert.equal((await replacement.checkRunning()).version,BRIDGE_VERSION);assert.equal(entries,0);
  for(const origin of DEFAULT_ALLOWED_ORIGINS){
    for(const [key] of routes){
      const [method,target]=key.split(' ');
      const preflight=await fetch(base+target,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':'authorization,content-type'},signal:AbortSignal.timeout(3000)});
      assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
      const denied=await fetch(base+target,{method,headers:{Origin:origin},signal:AbortSignal.timeout(3000)});
      assert.equal(denied.status,401);await denied.text();
      const response=await fetch(base+target,{method,headers:{Origin:origin,Authorization:'Bearer synthetic-pairing-token','Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(3000)});
      assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);await response.text();
    }
  }
  assert.equal(entries,DEFAULT_ALLOWED_ORIGINS.length*routes.size);
  const effective=await runtime.loadConfig();
  assert.deepEqual(effective,{...original,everythingExecutable:'',allowedOrigins:DEFAULT_ALLOWED_ORIGINS});
  assert.equal(await fs.readFile(runtime.paths.TOKEN_PATH,'utf8'),'synthetic-pairing-token\n');
  for(const origin of ['https://preview.bargig-orders.pages.dev','http://localhost:3000','https://unrelated.example','null']){
    const response=await fetch(base+'/documents/search',{method:'OPTIONS',headers:{Origin:origin},signal:AbortSignal.timeout(3000)});
    assert.equal(response.status,403);assert.equal(response.headers.has('access-control-allow-origin'),false);await response.text();
  }
  // A later config write and a second runtime instance keep the upgrade stable.
  await runtime.saveConfig(effective);
  assert.deepEqual((await createBridgeRuntimeFiles({root}).loadConfig()).allowedOrigins,DEFAULT_ALLOWED_ORIGINS);
  await runtime.saveConfig({...effective,allowedOrigins:['https://custom.example']});
  assert.equal((await replacement.checkRunning()).version,BRIDGE_VERSION);
  const blocked=await fetch(base+'/health',{headers:{Origin:'https://orders.bargig-furniture.com'},signal:AbortSignal.timeout(3000)});
  assert.equal(blocked.status,403);await blocked.text();
});
