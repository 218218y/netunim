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

test('Morning modal session rejects textual mounted authority and fabricated generation in its implementation',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/domains/customers/morning-modal-session.js'),original=readFileSync(source,'utf8');
 for(const [from,to] of [['return observed;',"return 'mounted';"],['catch{return false}',"catch{return 'active'}"]]){
  const changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
 }
});

test('Morning status and application bodies reject fabricated session, presentation and pending evidence',()=>{
 for(const [file,from,to] of [
  ['morning-status.js','completed:settlement.durable',"completed:'saved'"],
  ['morning-status-message.js','return result;',"return 'ready';"],
  ['morning-debt-application.js','return {apply,isPending};',"return {apply,isPending:()=> 'pending'};"],
 ]){
  const source=path.join(root,'netunim-orders/site/assets/js/domains/customers',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Morning operation evidence, commands, issuance and recovery reject implementation authority mutations',()=>{
 for(const [file,from,to] of [
  ['morning-operation-evidence.js','result.document_id=identity(row.document_id)','result.document_id=true'],
  ['morning-operation-commands.js',"decodeMorningOperationStatus(await read('status',{operation_id:operationId,reconcile},assertCurrent),operationId)","await read('status',{operation_id:operationId,reconcile},assertCurrent)"],
  ['morning-issuance.js','return data;',"return 'created';"],
  ['morning-recovery.js',"return {ok:false,state:'scope-changed',error}","return {ok:'cancelled',state:'scope-changed',error}"],
 ]){
  const source=path.join(root,'netunim-orders/site/assets/js/domains/customers',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Morning operation bodies reject fabricated drain and textual debt completion',()=>{
 for(const [file,from,to] of [
  ['netunim-orders/site/assets/js/domains/customers/morning-lifetime.js','drain:accepted.drain','drain:()=>true'],
  ['netunim-orders/site/assets/js/domains/customers/morning-debt-application.js',"return {changed:false,reason:'standalone'};","return {changed:false,reason:'standalone',persisted:'saved'};"],
 ]){
  const source=path.join(root,file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Morning media implementation rejects fabricated PDF, identity and drain evidence',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/domains/customers/morning-document-media.js'),original=readFileSync(source,'utf8');
 for(const [from,to] of [['return row.document_id;',"return true;"],['return new Blob([bytes],{type:\'application/pdf\'});',"return 'PDF';"],['drain:work.drain','drain:()=>true']]){
  const changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
 }
});

test('Calendar sync implementation rejects status text as native queue confirmation',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/calendar/session-runtime.js'),original=readFileSync(source,'utf8');
 const changed=original.replace('return confirmedResult;',"return 'confirmed';");assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
});

test('restore review implementation cannot return display text as authorization',()=>{
  const source=path.join(root,'shared/restore-review-scope.js'),original=readFileSync(source,'utf8');
  const changed=original.replace('return true;',"return 'confirmed';");assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('Notes ownership rejects a fabricated drain and an unchecked note payload in its implementation',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/domains/notes/commands.js'),original=readFileSync(source,'utf8');
  for(const [from,to] of [['drain:saves.drain','drain:()=>true'],['record:{...note}','record:{...note,content:7}']]){
    const changed=original.replace(from,to);assert.notEqual(changed,original);
    const diagnostics=check(new Map([[source,changed]]));
    assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
  }
});

test('actual shared Bank archive execution and audit reject fabricated drain and textual counts',()=>{
 for(const [file,from,to] of [
  ['shared/bank-archive-reconciliation.js',/drain:\s*work\.drain/,'drain: () => true'],
  ['shared/bank-archive-policy.js',/sourceCount:\s*source\.length/,"sourceCount: 'confirmed'"],
 ]){
  const source=path.join(root,file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
 }
});

test('the actual Orders Bank publisher rejects textual confirmation and a fabricated drain',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/domains/finance/bank-snapshot-publication.js'),original=readFileSync(source,'utf8');
 for(const [from,to] of [[/published:\s*readoutVerified/,"published: 'saved'"],[/drain:\s*work\.drain/,'drain: () => true']]){
  const changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
 }
});
test('the actual Bank scalar and device guard reject display text and asynchronous permission',()=>{
 for(const [file,from,to] of [
  ['shared/bank-money-value.js','return Number.isFinite(numeric) ? numeric : null;',"return Number.isFinite(numeric) ? 'confirmed' : null;"],
  ['shared/bridge-pairing-scope.js','return () => {','return async () => {'],
 ]){
  const source=path.join(root,file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
 }
});
test('the actual Bank balance evidence and its publication consumer reject text confirmations',()=>{
 const source=path.join(root,'shared/bank-balance-result.js'),original=readFileSync(source,'utf8');
 for(const [from,to] of [['    balance,',"    balance: 'confirmed',"],['availableBalance: snapshot.availableBalance',"availableBalance: 'confirmed'"]]){
  const changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
 }
});
test('the actual Orders local write cannot replace confirmed success with display text',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/domains/finance/credit-connection-owner.js'),original=readFileSync(source,'utf8');
 const changed=original.replace('return { ok: true };',"return { ok: 'saved' };");assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
test('the actual Orders Bank vault owner cannot replace confirmed success with display text',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/domains/finance/bank-connection-owner.js'),original=readFileSync(source,'utf8');
 const changed=original.replace('return { ok: true };',"return { ok: 'saved' };");assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
test('the actual Kupa Bank vault owner cannot replace confirmed success with display text',()=>{
 const source=path.join(root,'netunim-kupa/site/assets/js/domains/bank/connection-owner.js'),original=readFileSync(source,'utf8');
 const changed=original.replace('return true;',"return 'saved';");assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
test('the actual Finance import owner rejects a textual command confirmation',()=>{
 const source=path.join(root,'shared/finance-connection-import-runtime.js'),original=readFileSync(source,'utf8');
 const changed=original.replace(/(const cleanupWarnings[\s\S]*?)return true;/,"$1return 'imported';");assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
test('the actual native Finance file owner cannot fabricate a drain receipt',()=>{
 const source=path.join(root,'shared/finance-connection-file-selection.js'),original=readFileSync(source,'utf8');
 const changed=original.replace('drain: work.drain', 'drain: () => true');assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
test('the actual Credit connection readout cannot replace local profile evidence with display text',()=>{
 const source=path.join(root,'netunim-kupa/site/assets/js/domains/credit/connection-owner.js'),original=readFileSync(source,'utf8');
 const changed=original.replace('local: record(local)',"local: 'yes'");assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
test('the actual lease runtime cannot replace asynchronous drain with synthetic confirmation',()=>{
 const source=path.join(root,'shared/finance-lease-heartbeat.js'),original=readFileSync(source,'utf8');
 const changed=original.replace('return { assertCurrent, stop };','return { assertCurrent, stop: () => true };');assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Bank archive verification cannot replace transaction rows with a numeric status',()=>{
 const source=path.join(root,'shared/bank-archive-read-batch.js'),original=readFileSync(source,'utf8');
 const changed=original.replace(/rows:\s*await pair\.rows/,'rows:200');assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Bank command cannot replace atomic readout confirmation with operator text',()=>{
 const source=path.join(root,'netunim-kupa/site/assets/js/domains/bank/snapshot-commands.js'),original=readFileSync(source,'utf8');
 const changed=original.replace(/readoutVerified:\s*bankSnapshotReadoutIsCurrent\(committed, refreshed\)/,"readoutVerified:'confirmed'");assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&item.code===2322),describe(diagnostics));
});

test('the actual Kupa archive cache cannot publish a numeric status as transaction rows',()=>{
 const source=path.join(root,'netunim-kupa/site/assets/js/domains/bank/archive-readout.js'),original=readFileSync(source,'utf8');
 const changed=original.replace(/rows:\s*record\.rows/,'rows:200');assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Finance publication cannot replace confirmed status with presentation text',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/domains/finance/document-publication.js'),original=readFileSync(source,'utf8');
 const changed=original.replace(/return\s*\{\s*published\s*,/,'return {published:"confirmed",');
 assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Bank selector cannot replace a normalized identifier with a numeric bank code',()=>{
 const source=path.join(root,'netunim-kupa/bank-bridge/hapoalim-account-selector.mjs'),original=readFileSync(source,'utf8');
 const changed=original.replace(/bankNumber:\s*'12',\s*branchNumber:\s*''/,'bankNumber:12,branchNumber:""');
 assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
test('the actual Bank date decoder cannot replace an ISO date with a numeric status',()=>{
 const source=path.join(root,'netunim-kupa/bank-bridge/hapoalim-date-codec.mjs'),original=readFileSync(source,'utf8');
 const changed=original.replace(/date\.toISOString\(\)/,'200');
 assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual credit amount codec cannot turn a debit into presentation text',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/credit-core-values.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace(/amount\s*===\s*0\s*\?\s*0\s*:\s*-amount/,'amount===0?0:String(-amount)');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual credit sync scope cannot substitute a label for its numeric horizon',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/credit-sync-scope.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace(/futureMonths:\s*CREDIT_CORE_FUTURE_MONTHS/,'futureMonths:"quick"');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual JSON artifact owner cannot replace file completion with presentation text',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/json-artifact-owner.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('files.write(text)', 'Promise.resolve("saved")');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual installed-browser locator cannot replace a cached path with a status number',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/browser-locator.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace(/cachedBrowserPath\s*=\s*candidate;/,'cachedBrowserPath=200;');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual file owner cannot replace a promised command result with presentation text',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/file-task-owner.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace(/return task;/,'return "completed";');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual file join cannot substitute display text for an accepted attempt result',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/file-task-owner.mjs');
  const original=readFileSync(source,'utf8'),changed=original.replace('return result.value;', 'return "completed";');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

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

test('the actual Finance lease owner cannot return an ACK from cleanup',()=>{
  const source=path.join(root,'shared/finance-lease-owner.js'),original=readFileSync(source,'utf8');
  const changed=original.replace('return closing;', 'return true;');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
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
