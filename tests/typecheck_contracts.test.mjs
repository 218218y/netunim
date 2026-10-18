import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {root, check, describe, fixture} from './typecheck_contract_fixture.mjs';

test('Cloud read implementation rejects text revision authority',()=>{
  const source=path.join(root,'shared/cloud-read-records.js'),original=readFileSync(source,'utf8');
  const changed=original.replace('return structuredClone(value);',"return {...value,revision:'1'};");
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('Journal authority implementation rejects a text sequence receipt',()=>{
  const source=path.join(root,'shared/storage-journal-authority.js'),original=readFileSync(source,'utf8');
  const changed=original.replace('return sealStorageJsonRecord(operation);',"return sealStorageJsonRecord({...operation,seq:'1'});");
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('Main write authority and transport reject fabricated authority in their actual bodies',()=>{
 for(const [file,from,to] of [
  ['shared/cloud-write-authority.js','cloudWriteScopeIsCurrent(captured, scope.read(), head)',"'current'"],
  ['shared/cloud-write-authority.js','isCurrent: () => isCurrent(captured)','isCurrent: async () => isCurrent(captured)'],
  ['netunim-kupa/site/assets/js/cloud/main-document-write.js','return { r, j, body, row:',"return {r:'saved',j,body,row:"],
 ]){
  const source=path.join(root,file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('restore review implementation cannot return display text as authorization',()=>{
  const source=path.join(root,'shared/restore-review-scope.js'),original=readFileSync(source,'utf8');
  const changed=original.replace('return true;',"return 'confirmed';");assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Orders local write cannot replace confirmed success with display text',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/domains/finance/credit-connection-owner.js'),original=readFileSync(source,'utf8');
 const changed=original.replace('return { ok: true };',"return { ok: 'saved' };");assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
test('the actual Kupa archive cache cannot publish a numeric status as transaction rows',()=>{
 const source=path.join(root,'netunim-kupa/site/assets/js/domains/bank/archive-readout.js'),original=readFileSync(source,'utf8');
 const changed=original.replace(/rows:\s*record\.rows/,'rows:200');assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual primary lock cannot publish text as writer authority',()=>{
  const source=path.join(root,'shared/tab-lock.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('tab.primaryTab=value;', 'tab.primaryTab="primary";');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual folder writer cannot replace a detached input with a timestamp',()=>{
  const source=path.join(root,'netunim-orders/site/assets/js/storage/folder-write-runtime.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('last.payload=captured;', 'last.payload=Date.now();');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual automatic backup owner cannot replace a detached payload with a timestamp',()=>{
  const source=path.join(root,'shared/automatic-backup-runtime.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('payload:clonePayload(payload)', 'payload:Date.now()');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual debounced task cannot publish text as wakeup readiness',()=>{
  const source=path.join(root,'shared/debounced-task.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('task.ready = true;', 'task.ready = "ready";');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Checks flight cannot replace a tracked operation with a timer ID',()=>{
  const source=path.join(root,'shared/shared-checks-flight.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('state[key]=tracked;', 'state[key]=123;');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual task owner cannot replace closed state with a formatted label',()=>{
  const source=path.join(root,'shared/runtime-task-owner.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('active=false;', 'active="closed";');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('strict implementation and consumer checking passes, including every negative type fixture',()=>{
  const diagnostics=check();
  assert.equal(diagnostics.length,0,describe(diagnostics));
});

test('an actual typed implementation mistake is rejected rather than masked by a declaration facade',()=>{
  const source=path.join(root,'shared/cloud-checkpoint-publication.js');
  const diagnostics=check(new Map([[source,readFileSync(source,'utf8')+
    '\n/** @type {number} */\nconst incompatibleRevision="7";\n']]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('a current writer returning a string sequence fails its actual implementation contract',()=>{
  const source=path.join(root,'shared/storage-records.js');
  const original=readFileSync(source,'utf8');
  const changed=original.replace('return {version:2,owner,epoch,seq,state,appMetadata,savedAt}',
    'return {version:2,owner,epoch,seq:String(seq),state,appMetadata,savedAt}');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('an RPC receipt returning a string revision fails its actual implementation contract',()=>{
  const source=path.join(root,'shared/document-write-ack.js');
  const original=readFileSync(source,'utf8');
  const changed=original.replace('return {...receipt,state}', 'return {...receipt,revision:String(receipt.revision),state}');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('a decoder claiming an unvalidated numeric owner fails its actual implementation contract',()=>{
  const source=path.join(root,'shared/storage-checkpoint.js');
  const original=readFileSync(source,'utf8');
  const changed=original.replace('return data;', 'return {...data,owner:1};');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('a persisted operation decoder cannot return an unvalidated string sequence',()=>{
  const source=path.join(root,'shared/storage-operation.js');
  const original=readFileSync(source,'utf8');
  const changed=original.replace('return data;', 'return {...data,seq:String(data.seq)};');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('negative fixture assertions fail if an invalid consumer is accidentally accepted',()=>{
  const diagnostics=check(new Map([[fixture,readFileSync(fixture,'utf8')+
    '\n// @ts-expect-error deliberately unused: must make the gate fail\nconst validRevision=7;\n']]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===fixture&&item.code===2578),describe(diagnostics));
});

test('a cloud flight decoder cannot publish an unchecked string sequence',()=>{
  const source=path.join(root,'shared/storage-cloud-records.js');
  const original=readFileSync(source,'utf8').replace(/\r\n/g,'\n');
  const changed=original.replace("return data}\n/** @param {unknown} record @returns {StoredCloudControl}","return {...data,endSeq:String(data.endSeq)}}\n/** @param {unknown} record @returns {StoredCloudControl}");
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the command fails closed when the configured offline compiler is absent',()=>{
  const result=spawnSync(process.execPath,[path.join(root,'tools/typecheck.mjs')],{
    cwd:root,encoding:'utf8',env:{...process.env,NETUNIM_OFFLINE_NODE_MODULES:path.join(root,'tests/fixtures/no-installed-node-modules')},
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/MODULE_NOT_FOUND/);
});
