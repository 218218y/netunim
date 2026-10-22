import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root, check, describe} from './typecheck_contract_fixture.mjs';

test('canonical text matcher bodies reject text coordinates and numeric term-presence evidence',()=>{
  const source=path.join(root,'shared/document-text-search.js'),original=readFileSync(source,'utf8');
  for(const [from,to] of [
    ['matches.push(folded.range(start, end));',"matches.push({start:'match',end});"],
    ['if (found) foundTerms.push(term);','if (found) foundTerms.push(1);'],
  ]){
    const changed=original.replace(from,to);
    assert.notEqual(changed,original,from);
    const diagnostics=check(new Map([[source,changed]]));
    assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
  }
});

test('PDF preview and process bodies reject text form authority, invalid preview text and unjoined disposal',()=>{
 for(const [file,from,to]of [
  ['pdf-extraction-result.mjs','hasForm: value.hasForm',"hasForm: 'yes'"],
  ['pdf-preview-operation.mjs','return data;','return {text: 7, truncated: false, formFields: []};'],
  ['pdf-extraction-process.mjs','await Promise.all([...pending].map(flight => flight.done));','return true;'],
 ]){
  const source=path.join(root,'netunim-orders/document-bridge',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original,from);
  const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('PDF maintenance implementation rejects text progress and disposal without stop/drain',()=>{
 const source=path.join(root,'netunim-orders/document-bridge/pdf-maintenance-operation.mjs'),original=readFileSync(source,'utf8');
 for(const [from,to]of [['processed: 0',"processed: '0'"],['stop();','return true;']]){
  const changed=original.replace(from,to);assert.notEqual(changed,original,from);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Everything process and discovery bodies reject text process output and unjoined disposal',()=>{
 for(const [file,from,to]of [['everything-process.mjs','return await accept(() =>',"return { stdout: 7 }; return await accept(() =>"],['everything-discovery.mjs','await Promise.all([...pending]);','return true;']]){
  const source=path.join(root,'netunim-orders/document-bridge',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original,from);
  const diagnostics=check(new Map([[source,changed]]));assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Everything session implementation rejects text timestamps and unjoined shutdown',()=>{
 const source=path.join(root,'netunim-orders/document-bridge/everything-session.mjs'),original=readFileSync(source,'utf8');
 for(const [from,to]of [['at: runtime.now()',"at: 'now'"],['await Promise.all([...pending]);','return true;']]){
  const changed=original.replace(from,to);assert.notEqual(changed,original,from);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('Document search bodies reject text page limits, unjoined disposal and text expiry',()=>{
 for(const [file,from,to]of [
  ['search-owner.mjs','limit: boundedLimit',"limit: '2'"],
  ['search-owner.mjs','await Promise.all([...pending]);','return true;'],
  ['result-registry.mjs','expiresAt: clock.now() + clock.ttlMs',"expiresAt: 'tomorrow'"],
 ]){
  const source=path.join(root,'netunim-orders/document-bridge',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);
  assert.notEqual(changed,original,from);const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345].includes(item.code)),describe(diagnostics));
 }
});

test('the actual native Finance file owner cannot fabricate a drain receipt',()=>{
 const source=path.join(root,'shared/finance-connection-file-selection.js'),original=readFileSync(source,'utf8');
 const changed=original.replace('drain: work.drain', 'drain: () => true');assert.notEqual(changed,original);
 const diagnostics=check(new Map([[source,changed]]));
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
