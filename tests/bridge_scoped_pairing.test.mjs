import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createScopedPairing, readPairingAdminToken} from '../netunim-orders/document-bridge/scoped-pairing.mjs';
import {createDocumentBridgeHttpHandler} from '../netunim-orders/document-bridge/http-handler.mjs';
import {createDocumentBridgeRoutes} from '../netunim-orders/document-bridge/http-routes.mjs';
import {createDocumentResultRegistry} from '../netunim-orders/document-bridge/result-registry.mjs';
import {createBankBridgeHttpHandler} from '../netunim-kupa/bank-bridge/http-handler.mjs';
import {createBankBridgeRoutes} from '../netunim-kupa/bank-bridge/http-routes.mjs';
import {createBridgeOperationOwner} from '../netunim-kupa/bank-bridge/operation-owner.mjs';

const orders = 'https://orders.bargig-furniture.com';
const kupa = 'https://kupa.bargig-furniture.com';
const legacy = 'synthetic-legacy-token';
const allow = origin => [orders,kupa].includes(origin);
const all = {bank:['bank.read','bank.refresh','bank.configure','bank.remove'],
  document:['document.read','document.delete','document.maintenance']};
const readRoute = {bank:'/status',document:'/status'};
const forbiddenRoute = {bank:'/v2/credit/sync',document:'/documents/delete'};

async function fixture(t, kind) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'netunim-scoped-pairing-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith('netunim-scoped-pairing-'));
    return fs.rm(resolved,{recursive:true,force:true});
  });
  let now = 1_800_000_000_000, tick = 0;
  const create = () => createScopedPairing({root,permissions:all[kind],wall:()=>now,tick:()=>tick});
  let pairing = create();
  await pairing.initialize();
  const adminToken = await readPairingAdminToken(root);
  const calls = [];
  const run = name => () => {calls.push(name);return {ok:true}};
  const makeListener = () => {
    if (kind === 'bank') {
      const ports = {
        version:79,contractVersion:2,service:{bankStatus:run('status'),creditStatus:run('creditStatus')},
        connections:Object.fromEntries(['saveCreditProfile','deleteCreditProfile','resetCreditProfiles','saveCredentials','selectAccount','deleteCredentials','importConnectionSettings'].map(name=>[name,run(name)])),
        finance:{balance:run('balance'),syncCredit:run('creditSync')},
        diagnostics:{credit:run('creditDiagnostic'),creditData:run('creditData'),bank:run('bankDiagnostic')},
        cheques:{read:async()=>null},shutdown:{afterResponse:run('shutdown')},
      };
      return createBankBridgeHttpHandler({pairing,token:legacy,routes:createBankBridgeRoutes(ports),
        admission:{assertAccepting(){}},health:()=>({ok:true})});
    }
    const registry = createDocumentResultRegistry({
      authority:pairing,clock:{now:()=>now,ttlMs:600000},identity:{next:()=>String(calls.length)},
      files:{stat:async()=>({}),authorize:async file=>file},
    });
    const document = {name:'sample.txt',fullPath:'C:\\fixture\\sample.txt'};
    const access = async id => {await registry.resolve(id);calls.push('opened');return {ok:true}};
    const routes = createDocumentBridgeRoutes({
      service:{status:run('status'),warm:run('warm')},
      maintenance:{status:run('indexStatus'),start:run('indexStart'),stop:run('indexStop')},
      search:{selectFolder:run('picker'),recent:run('recent'),search:async()=>{calls.push('search');return {ok:true,result:registry.publish(document,{query:'sample',mode:'everything',contentSearch:{}})}}},
      preview:{document:access,matches:access,file:async()=>({buffer:Buffer.from('test'),mime:'text/plain',name:'sample.txt'})},
      nativePreview:{open:access,move:run('move'),hide:run('hide')},
      files:{open:access,reveal:access,delete:run('delete')},
      shutdown:{prepare:run('shutdown'),afterResponse:()=>{}},
    });
    return createDocumentBridgeHttpHandler({pairing,routes,health:()=>({ok:true}),readToken:async()=>legacy,
      loadConfig:async()=>({allowedOrigins:[orders,kupa]}),appendLog:async()=>{}});
  };
  let listener = makeListener();
  const server = http.createServer((req,res)=>listener(req,res));
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
  const base='http://127.0.0.1:'+server.address().port;
  async function request(route,{method='POST',origin,token,body={}}={}) {
    const response=await fetch(base+route,{method,signal:AbortSignal.timeout(4000),headers:{
      ...(origin===undefined?{}:{Origin:origin}),...(token?{Authorization:'Bearer '+token}:{}),
      'Content-Type':'application/json',
    },...(['GET','OPTIONS'].includes(method)?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  }
  const admin=(body,origin,token=adminToken)=>request('/pairing/admin',{token,origin,body});
  const exchange=(code,origin)=>request('/pairing/exchange',{origin,body:{code}});
  return {root,admin,exchange,request,calls,adminToken,create,get pairing(){return pairing},
    advance:(ms)=>{now+=ms;tick+=ms},
    async restart(){await pairing.close();pairing=create();await pairing.initialize();listener=makeListener()},
  };
}

for (const kind of ['bank','document']) test(kind+' isolates sites and capabilities through real HTTP across migration, revocation and restart',async t=>{
  const f=await fixture(t,kind);
  const status=(origin,token)=>f.request(readRoute[kind],{method:'GET',origin,token});
  const issue=async(origin,permissions=[all[kind][0]])=>(await f.admin({action:'issue',origin,permissions})).data.code;
  assert.equal((await status(orders,legacy)).status,200);
  assert.equal((await f.admin({action:'begin'},orders)).status,401);
  assert.equal((await f.admin({action:'begin'},undefined,legacy)).status,401);
  assert.equal((await f.admin({action:'begin'})).data.mode,'transition');
  const code=await issue(orders);
  assert.ok(code.startsWith('ntp1.'));
  assert.equal((await f.exchange(code,kupa)).status,401);
  const parallel=await Promise.all([f.exchange(code,orders),f.exchange(code,orders)]);
  assert.deepEqual(parallel.map(item=>item.status).sort(),[200,401]);
  const key=parallel.find(item=>item.status===200).data.token;
  assert.equal((await status(orders,key)).status,200);
  assert.equal((await status(kupa,key)).status,401);
  assert.equal((await status(undefined,key)).status,401);
  assert.equal((await status(orders,legacy)).status,401);
  assert.equal((await status(kupa,legacy)).status,200);
  assert.equal((await f.request(forbiddenRoute[kind],{origin:orders,token:key,body:'invalid json'})).status,403);
  assert.equal((await f.request('/shutdown',{origin:orders,token:key})).status,403);
  if (kind==='bank') {
    const configure=(await f.exchange(await issue(orders,['bank.read','bank.configure']),orders)).data.token;
    assert.equal((await f.request('/settings/import',{origin:orders,token:configure,body:'invalid json'})).status,403);
    assert.equal((await status(orders,key)).status,401);
  }
  assert.equal(f.calls.includes(kind==='bank'?'creditSync':'delete'),false);
  const other=(await f.exchange(await issue(kupa,all[kind]),kupa)).data.token;
  assert.equal((await f.request(forbiddenRoute[kind],{origin:kupa,token:other})).status,200);
  let id;
  if (kind==='document') {
    id=(await f.request('/documents/search',{origin:orders,token:key})).data.result.id;
    assert.equal((await f.request('/documents/open',{origin:kupa,token:other,body:{id}})).status,410);
    assert.equal((await f.request('/documents/open',{origin:orders,token:key,body:{id}})).status,200);
  }
  await f.admin({action:'revoke',origin:orders});
  assert.equal((await status(orders,key)).status,401);
  assert.equal((await status(orders,legacy)).status,401);
  assert.equal((await status(kupa,other)).status,200);
  assert.equal((await f.admin({action:'finish'})).data.mode,'scoped');
  const legacyFile = path.join(f.root, 'bridge-token.txt');
  await fs.writeFile(legacyFile, legacy);
  const rolled = await f.admin({action:'prepare-rollback'});
  assert.equal(rolled.data.mode,'scoped');
  const freshLegacy = (await fs.readFile(legacyFile,'utf8')).trim();
  assert.match(freshLegacy, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(freshLegacy,legacy);
  assert.ok(!JSON.stringify(rolled).includes(freshLegacy));
  await f.restart();
  assert.equal((await status(kupa,other)).status,200);
  assert.equal((await status(orders,key)).status,401);
  assert.equal((await status(undefined,legacy)).status,401);
  assert.equal((await f.request('/shutdown',{token:f.adminToken})).status,200);
  const file=await fs.readFile(path.join(f.root,'pairing-v1','registry.json'),'utf8');
  for (const secret of [code,key,other,legacy,f.adminToken]) assert.ok(!file.includes(secret));
});

test('pairing expires by monotonic time, bounds guesses and cannot resume a failed durable commit',async t=>{
  const f=await fixture(t,'bank');
  await f.admin({action:'begin'});
  assert.equal((await f.admin({action:'prepare-rollback'})).status,400);
  const issue=async()=>(await f.admin({action:'issue',origin:orders,permissions:['bank.read']})).data.code;
  const cancelled=await issue();
  assert.equal((await f.admin({action:'revoke',origin:orders})).status,200);
  assert.equal((await f.exchange(cancelled,orders)).status,401);
  const abandoned=await issue();
  await f.restart();
  assert.equal((await f.exchange(abandoned,orders)).status,401);
  const expired=await issue();
  f.advance(120001);
  assert.equal((await f.exchange(expired,orders)).status,401);
  const throttled=await issue();
  for(let i=0;i<5;i++)assert.equal((await f.exchange('ntp1.'+'Z'.repeat(43),orders)).status,401);
  assert.equal((await f.exchange(throttled,orders)).status,401);
  const code=await issue(),registry=path.join(f.root,'pairing-v1','registry.json');
  await fs.rename(registry,registry+'.retained');
  await fs.mkdir(registry);
  assert.equal((await f.exchange(code,orders)).status,503);
  assert.equal((await f.exchange(code,orders)).status,401);
  assert.equal((await f.admin({action:'status'})).data.records.length,0);
  await fs.rmdir(registry);
  await fs.rename(registry+'.retained',registry);
  await fs.unlink(registry);
  await assert.rejects(f.create().initialize(),{code:'BRIDGE_PAIRING_STORAGE'});
  await fs.writeFile(registry,'{');
  await assert.rejects(f.create().initialize(),{code:'BRIDGE_PAIRING_STORAGE'});
});

test('revoking a Bank grant rejects its already queued configuration before it can write',async t=>{
  const f=await fixture(t,'bank');
  await f.admin({action:'begin'});
  const {code}=(await f.admin({action:'issue',origin:orders,permissions:['bank.configure']})).data;
  const {token}=(await f.exchange(code,orders)).data;
  const grant=await f.pairing.capture({origin:orders,bearer:token,originAllowed:allow,readLegacy:()=>legacy});
  const owner=createBridgeOperationOwner({assertAuthorized:f.pairing.assertCurrent});
  let release;
  const held=owner.configuration(()=>new Promise(resolve=>{release=resolve}));
  const queued=f.pairing.run(grant,()=>owner.configuration(()=>assert.fail('revoked command reached a write')));
  const rejected=assert.rejects(queued,{code:'UNAUTHORIZED'});
  await f.admin({action:'revoke',origin:orders});
  release();
  await held;
  await rejected;
});
