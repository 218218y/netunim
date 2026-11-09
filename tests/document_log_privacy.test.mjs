import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPrivateAuditLog,privateAuditLine} from '../netunim-orders/document-bridge/private-audit-log.mjs';
import {createBridgeRuntimeFiles} from '../netunim-orders/document-bridge/bridge-runtime-files.mjs';
import {serverFixture} from './document_search_server_fixture.mjs';

async function directory(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-private-log-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root}
test('closed diagnostic vocabulary discards native errors, queries, paths, secrets and multiline payloads',()=>{
  const marker='PRIVATE-לקוח-0501234567';
  const line=privateAuditLine(`SEARCH mode=content results=3 elapsedMs=12 input="${marker}" path="C:\\${marker}" token=${marker}\n${marker}`);
  assert.equal(line,'SEARCH mode=content results=3 elapsedMs=12');
  assert.equal(privateAuditLine(`HTTP_ERROR code=${marker}`),'HTTP_ERROR');
  assert.equal(privateAuditLine(`FATAL ${marker}`),'FATAL');
  assert.equal(privateAuditLine(marker),'EVENT');
});

test('sensitive synthetic searches and recent scopes never enter actual runtime logs',async t=>{
  const root=await directory(t),runtime=createBridgeRuntimeFiles({root}),marker='לקוח-0501234567-IBAN-SYNTHETIC';
  const f=serverFixture('current',{audit:runtime.appendLog});
  await f.search(marker,2,'content',{},`C:\\${marker}`);
  await f.recent(2,`C:\\${marker}`);
  const content=await fs.readFile(runtime.paths.LOG_PATH,'utf8');
  assert.match(content,/SEARCH/);assert.match(content,/RECENT/);
  assert.doesNotMatch(content,/לקוח|0501234567|IBAN|input=|scopePath=|everythingQuery=/);
});

test('first protected write removes only legacy runtime logs and retains configuration, keys and index',async t=>{
  const root=await directory(t),runtime=createBridgeRuntimeFiles({root});
  for(const name of ['bridge.log','bridge.log.1'])await fs.writeFile(path.join(root,name),'SENSITIVE-LEGACY');
  for(const name of ['config.json','bridge-token.txt','pdf-form-index.json','bridge-console.log'])await fs.writeFile(path.join(root,name),'PRESERVE');
  await runtime.appendLog('SEARCH results=1');
  assert.doesNotMatch(await fs.readFile(runtime.paths.LOG_PATH,'utf8'),/SENSITIVE/);
  for(const name of ['config.json','bridge-token.txt','pdf-form-index.json','bridge-console.log'])assert.equal(await fs.readFile(path.join(root,name),'utf8'),'PRESERVE');
  assert.equal((await fs.readdir(root)).includes('bridge.log.1'),false);
});

test('concurrent log writers enforce byte and backup budgets and prune old logs without waiting on contention',async t=>{
  const root=await directory(t);let now=Date.now();
  const log=createPrivateAuditLog({root,maxBytes:256,backups:2,maxAgeMs:1000,now:()=>now});
  await Promise.all(Array.from({length:50},(_,i)=>log.append(`SEARCH results=${i} elapsedMs=123`)));
  const names=(await fs.readdir(root)).filter(name=>/^bridge\.log(?:\.\d+)?$/.test(name));
  assert.equal(names.length,3);
  for(const name of names)assert.ok((await fs.stat(path.join(root,name))).size<=256);
  now+=2000;await log.prune();
  assert.deepEqual((await fs.readdir(root)).filter(name=>/^bridge\.log(?:\.\d+)?$/.test(name)),[]);
  const blocked=createPrivateAuditLog({root,lock:{run:async()=>{throw Error('held by another writer')}}});
  await blocked.append('SEARCH results=1');await blocked.drain();
  assert.equal((await fs.readdir(root)).includes('bridge.log'),false);
});
