import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const modules=process.env.NETUNIM_OFFLINE_NODE_MODULES||path.join(root,'node_modules');
const ts=createRequire(import.meta.url)(path.join(modules,'typescript/lib/typescript.js'));
const config=ts.readConfigFile(path.join(root,'tsconfig.contracts.json'),ts.sys.readFile);
assert.equal(config.error,undefined);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
assert.deepEqual(parsed.errors,[]);
const fixture=path.join(root,'tests/fixtures/checked-contracts.mjs');

function check(overrides=new Map()){
  const host=ts.createCompilerHost(parsed.options);
  const read=host.readFile;
  const normalized=new Map([...overrides].map(([file,text])=>[path.resolve(file),text]));
  host.readFile=file=>normalized.get(path.resolve(file))??read(file);
  const program=ts.createProgram(parsed.fileNames,parsed.options,host);
  return ts.getPreEmitDiagnostics(program);
}
function describe(diagnostics){return ts.formatDiagnostics(diagnostics,{getCanonicalFileName:file=>file,getCurrentDirectory:()=>root,getNewLine:()=> '\n'})}

test('the actual Bank provider cannot substitute presentation text for successful terminal cleanup',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/hapoalim-provider.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace(/success\s*=\s*true;/,'success="completed";');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Credit session cannot publish a display string as a profile result',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/credit-session.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace(/return adapter\.scrape\(\);/,'return "completed";');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Bank shutdown cannot publish presentation text as completed teardown',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/shutdown-owner.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace(/completed\s*=\s*true;/, 'completed="stopped";');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Bank route cannot publish JSON fields in place of binary response bytes',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/http-routes.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('run:()=>cheques.read(key)', 'run:async()=>({path:key})');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Bank Bridge owner cannot replace provider exclusivity with formatted status',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/operation-owner.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('providerActive = true;', 'providerActive = "busy";');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Calendar flight cannot replace a promised receipt with status text',()=>{
  const source=path.join(root,'netunim-orders/site/assets/js/calendar/operation-flight.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('return task.promise;', 'return "completed";');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Calendar effects cannot publish text as connectivity evidence',()=>{
  const source=path.join(root,'netunim-orders/site/assets/js/platform/calendar-browser-effects.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('active&&environment.navigator.onLine===true', '"online"');
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
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

test('the actual Credit form cannot convert credential strings into numbers',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/ui/credit-connection-input.js');
  const original=readFileSync(source,'utf8'),changed=original.replace("card6Digits:readField('ccCard6')", "card6Digits:Number(readField('ccCard6'))");
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Dashboard read owner cannot report a string as read completion',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/domains/dashboard/controller.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('return changed;', "return 'confirmed';");
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Finance platform cannot return text as connectivity evidence',()=>{
  const source=path.join(root,'shared/finance-browser-effects.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('isOnline:() => !disposed && environment.navigator.onLine === true', 'isOnline:() => "online"');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
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

test('the actual PDF inventory cannot send a formatted string as its paging offset',()=>{
  const source=path.join(root,'netunim-orders/document-bridge/pdf-inventory.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('session.page({offset, limit: pageSize', 'session.page({offset:String(offset), limit: pageSize');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual PDF index writer cannot publish text as committed numeric metadata',()=>{
  const source=path.join(root,'netunim-orders/document-bridge/pdf-index-writer.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('...candidate, ...metadata, updatedAt, signature', '...candidate, ...metadata, updatedAt:String(updatedAt), signature');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual maintenance owner cannot publish text as worker running evidence',()=>{
  const source=path.join(root,'netunim-orders/document-bridge/maintenance-process-owner.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('scope.run.running = false;', 'scope.run.running = "finished";');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual file lock cannot replace a settled task result with formatted text',()=>{
  const source=path.join(root,'netunim-orders/document-bridge/file-lock-owner.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('return outcome.value;', 'return String(outcome.value);');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual PDF index reader cannot publish a string as pending-count evidence',()=>{
  const source=path.join(root,'netunim-orders/document-bridge/pdf-index-reader.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('return {entries, pending, pdfCount, updatedAt, signature};', 'return {entries, pending:String(pending), pdfCount, updatedAt, signature};');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual preview cache cannot store a formatted string as numeric expiry evidence',()=>{
  const source=path.join(root,'netunim-orders/document-bridge/preview-text-cache.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('entry.at = clock(); touch(key, entry);', 'entry.at = "now"; touch(key, entry);');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual preview file response cannot substitute a string for binary bytes',()=>{
  const source=path.join(root,'netunim-orders/document-bridge/preview-content.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('buffer: await files.readBinary(meta.fullPath, BINARY_PREVIEW_MAX_BYTES)', 'buffer: "not bytes"');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Calendar confirmation reader cannot resolve a string as confirmation',()=>{
  const source=path.join(root,'netunim-orders/site/assets/js/calendar/queue-confirmation.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('resolve(result)','resolve(String(result))');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2345),describe(diagnostics));
});

test('an actual Credit preference reader cannot return a string attempt timestamp',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/platform/credit-preferences.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('attemptAt:Number(storage.getItem(ATTEMPT)||0)','attemptAt:storage.getItem(ATTEMPT)||"0"');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
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

test('a Credit implementation cannot replace an explicit remote commit result with a string',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/domains/credit/publication.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('remoteCommitted:true,displayPublished:true',"remoteCommitted:'true',displayPublished:true");
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
