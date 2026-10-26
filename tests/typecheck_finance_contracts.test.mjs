import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root, check, describe} from './typecheck_contract_fixture.mjs';

test('Kupa Bank operation and candidate bodies reject deferred authority, invented money/watermarks and unjoined completion',()=>{
 for(const [file,from,to]of [
  ['refresh.js','assertCurrent: () => {','assertCurrent: async () => {'],
  ['refresh.js','await Promise.all([work.drain(), leases.runtime.drain()]);','return true;'],
  ['snapshot-policy.js','snapshotSeq: source.observedSequence()',"snapshotSeq: '7'"],
  ['snapshot-policy.js','currentBalance: feeds.roundMoney(business.balance)',"currentBalance: '500'"],
 ]){
  const source=path.join(root,'netunim-kupa/site/assets/js/domains/bank',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);
  assert.notEqual(changed,original,from);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Credit operation bodies reject fabricated publication, deferred guards and unjoined completion',()=>{
 for(const file of ['netunim-orders/site/assets/js/domains/finance/credit-refresh.js','netunim-kupa/site/assets/js/domains/credit/refresh.js']){
  const source=path.join(root,file),original=readFileSync(source,'utf8');
  const cases=[['assertCurrent: () => {','assertCurrent: async () => {'],['await Promise.all([work.drain(), leases.runtime.drain()]);','return true;']];
  if(file.includes('orders'))cases.push(['onPublished(saved, result, deferredOnly);','onPublished({publicationWarning:true}, result, deferredOnly);']);
  else cases.push(['onPublished(result, deferredOnly);',"onPublished({profiles:[],attemptedCount:'0'}, deferredOnly);"]);
  for(const [from,to] of cases){
   const changed=original.replace(from,to);assert.notEqual(changed,original,from);
   const diagnostics=check(new Map([[source,changed]]));
   assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
  }
 }
 const source=path.join(root,'shared/credit-refresh-result.js'),original=readFileSync(source,'utf8'),changed=original.replace('decoded[field] = count;','decoded[field] = String(count);');
 assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
 assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('Orders Bank operation bodies reject fabricated publication, deferred authority and unjoined completion',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/domains/finance/bank-refresh.js'),original=readFileSync(source,'utf8');
 for(const [from,to] of [
  ['onPublished(result);',"onPublished({published:'saved'});"],
  ['assertCurrent: () => {','assertCurrent: async () => {'],
  ['await Promise.all([work.drain(), leases.runtime.drain()]);',"return true;"],
 ]){
  const changed=original.replace(from,to);assert.notEqual(changed,original,from);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
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
 const changed=original.replace(/readoutVerified,\s*receipt:/,"readoutVerified:'confirmed',receipt:");assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&item.code===2322),describe(diagnostics));
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

test('the actual Credit form cannot convert credential strings into numbers',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/ui/credit-connection-input.js');
  const original=readFileSync(source,'utf8'),changed=original.replace("card6Digits:readField('ccCard6')", "card6Digits:Number(readField('ccCard6'))");
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

test('an actual Credit preference reader cannot return a string attempt timestamp',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/platform/credit-preferences.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('attemptAt:Number(storage.getItem(ATTEMPT)||0)','attemptAt:storage.getItem(ATTEMPT)||"0"');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Finance lease owner cannot return an ACK from cleanup',()=>{
  const source=path.join(root,'shared/finance-lease-owner.js'),original=readFileSync(source,'utf8');
  const changed=original.replace('return closing;', 'return true;');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('a Credit implementation cannot replace an explicit remote commit result with a string',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/domains/credit/publication.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('remoteCommitted:true,displayPublished:true',"remoteCommitted:'true',displayPublished:true");
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});
