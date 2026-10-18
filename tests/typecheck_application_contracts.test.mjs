import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {declaration} from './bank_policy_ast_fixture.mjs';
import {root, check, describe} from './typecheck_contract_fixture.mjs';

test('Morning form and confirmation bodies reject text money and deferred confirmation',()=>{
 for(const [file,from,to]of [
  ['morning-command-form.js','amount,\n        date,',"amount: '30',\n        date,"],
  ['morning-debt-confirmation.js','message: debtImpactConfirmation','message: async () => debtImpactConfirmation'],
 ]){
  const source=path.join(root,'netunim-orders/site/assets/js/domains/customers',file),original=readFileSync(source,'utf8').replace(/\r\n/g,'\n'),changed=original.replace(from,to);
  assert.notEqual(changed,original,from);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Morning catalog bodies reject coercible counts and deferred metadata authority',()=>{
 for(const [file,from,to]of [
  ['morning-catalog-evidence.js','total: count(data.total)',"total: '1'"],
  ['morning-catalog.js','return () => {','return async () => {'],
 ]){
  const source=path.join(root,'netunim-orders/site/assets/js/domains/customers',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);
  assert.notEqual(changed,original,from);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Calendar decoder, renderer and editor bodies reject invented identity, deferred markup and nontext payloads',()=>{
 for(const [file,from,to]of [
  ['calendar/payload.js','const event = { ...providerFields(data), id };','const event = { ...providerFields(data), id: 7 };'],
  ['domains/calendar/presentation.js','body: bodyMarkup','body: async () => bodyMarkup()'],
  ['domains/calendar/editor-payload.js',"description: $('#calendarDescription')?.value.trim() || ''",'description: 7'],
 ]){
  const source=path.join(root,'netunim-orders/site/assets/js',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);
  assert.notEqual(changed,original,from);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Morning Bank link bodies reject textual refresh results and fabricated source identity',()=>{
 for(const [name,from,to] of [
  ['morning-bank-transaction-link.js','presentation.select(selectedTransaction());return true;',"presentation.select(selectedTransaction());return 'refreshed';"],
  ['morning-bank-link-form.js',"kind:'bank',bankTransaction:row",'kind:42,bankTransaction:row'],
 ]){
  const source=path.join(root,'netunim-orders/site/assets/js/domains/customers',name),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Morning document presentation rejects deferred markup in its actual body',()=>{
 const source=path.join(root,'netunim-orders/site/assets/js/domains/customers/morning-document-view.js'),original=readFileSync(source,'utf8');
 const body=declaration(original,'morningFormMarkup'),mutated=original.slice(body.start,body.end).replace('return `','return Promise.resolve(`').replace(/`;\s*}$/, '`);\n}');
 const changed=original.slice(0,body.start)+mutated+original.slice(body.end);assert.notEqual(changed,original);declaration(changed,'morningFormMarkup');
 const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

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
  ['morning-operation-commands.js',"decodeMorningOperationStatus(await read('status',{operation_id:operationId,reconcile,...(retryChecks?{retry_checks:true}:{})},assertCurrent),operationId)","await read('status',{operation_id:operationId,reconcile,...(retryChecks?{retry_checks:true}:{})},assertCurrent)"],
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

test('Notes ownership rejects a fabricated drain and an unchecked note payload in its implementation',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/domains/notes/commands.js'),original=readFileSync(source,'utf8');
  for(const [from,to] of [['drain:saves.drain','drain:()=>true'],['record:{...note}','record:{...note,content:7}']]){
    const changed=original.replace(from,to);assert.notEqual(changed,original);
    const diagnostics=check(new Map([[source,changed]]));
    assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
  }
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

test('the actual Dashboard read owner cannot report a string as read completion',()=>{
  const source=path.join(root,'netunim-kupa/site/assets/js/domains/dashboard/controller.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('return changed;', "return 'confirmed';");
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

test('the actual Calendar confirmation reader cannot resolve a string as confirmation',()=>{
  const source=path.join(root,'netunim-orders/site/assets/js/calendar/queue-confirmation.js');
  const original=readFileSync(source,'utf8'),changed=original.replace('resolve(result)','resolve(String(result))');
  assert.notEqual(changed,original);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2345),describe(diagnostics));
});
