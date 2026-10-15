import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPdfIndexCoordinator} from '../netunim-orders/document-bridge/pdf-index-coordinator.mjs';
import {createEverythingSearchCoordinator} from '../netunim-orders/document-bridge/everything-search-coordinator.mjs';
import {createFileLockOwner} from '../netunim-orders/document-bridge/file-lock-owner.mjs';
import {createFileLockPlatform} from '../netunim-orders/document-bridge/file-lock-platform.mjs';

async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-index-composition-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const invalidations=[],logs=[];
  const locks=createFileLockOwner({...createFileLockPlatform({root}),clock:()=>performance.now(),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
  const files={PDF_FORM_INDEX_PATH:path.join(root,'index.json'),PDF_FORM_INDEX_JOURNAL_PATH:path.join(root,'journal.jsonl'),PDF_FORM_INDEX_LOCK_PATH:path.join(root,'lock')};
  const owner=createPdfIndexCoordinator({files,locking:{withFileLock:(lock,work)=>locks.run(lock,work)},everything:{loadConfig:async()=>({}),probeEverything:async()=>({}),runEs:async()=>assert.fail('construction cannot launch Everything')},cache:{invalidate:key=>invalidations.push(key)},runtime:{isStopping:()=>false,log:async text=>logs.push(text)},policy:{PDF_FORM_INDEX_PAGE_SIZE:2,PDF_FORM_DETECTION_REVISION:2,PDF_FORM_SEARCH_TEXT_REVISION:2}});
  return {root,files,owner,invalidations,logs};
}
const row={fullPath:'C:\\scope\\form.pdf',name:'form.pdf',text:'synthetic searchable form',hasForm:true,size:10,formFields:[],detectionRevision:2,searchTextRevision:2};
test('actual PDF coordinator constructs without I/O and owns append, reload, scoped search and removal',async t=>{
  const f=await fixture(t);assert.deepEqual(await fs.readdir(f.root),[]);assert.equal(f.owner.index.entries.set,undefined);
  await f.owner.index.append([{op:'upsert',entry:row}]);
  assert.equal(f.owner.view().inspected,1);assert.equal(f.owner.view().interactive,1);
  assert.equal(f.owner.search.search('searchable',{},'C:\\scope',5).length,1);
  assert.equal(f.owner.search.search('searchable',{},'C:\\other',5).length,0);
  await f.owner.index.compact({pending:0,pdfCount:1});
  assert.equal((await f.owner.search.prepare()).partial,false);
  await f.owner.remove(row.fullPath.toUpperCase());assert.equal(f.owner.view().inspected,0);
  assert.ok(f.invalidations.includes(row.fullPath.toLowerCase()));
});
test('actual PDF coordinator retains last good publication and corrupt raw bytes on reload failure',async t=>{
  const f=await fixture(t);await f.owner.index.append([{op:'upsert',entry:row}]);
  const before=f.owner.view(),raw='{"op":"truncated';await fs.appendFile(f.files.PDF_FORM_INDEX_JOURNAL_PATH,raw);
  assert.equal((await f.owner.search.prepare()).partial,true);assert.deepEqual(f.owner.view(),before);
  await assert.rejects(f.owner.remove(row.fullPath),{code:'PDF_INDEX_JOURNAL_INVALID'});
  assert.ok((await fs.readFile(f.files.PDF_FORM_INDEX_JOURNAL_PATH,'utf8')).endsWith(raw));
});
test('actual Everything coordinator re-probes exactly once for exit 8 and decodes before publication',async()=>{
  const probes=[],commands=[];let calls=0,invalidated=0,published=0;
  const owner=createEverythingSearchCoordinator({configuration:{load:async()=>({searchTimeoutMs:100})},session:{probe:async options=>{probes.push(options);return {esPath:'es',instance:'A'}},executable:async()=>'',invalidate:()=>{invalidated++}},process:{run:async(_file,args)=>{commands.push(args);if(calls++===0)throw Object.assign(Error('index changed'),{exitCode:8});return {stdout:'{"results":[]}'}}},pdf:{prepare:async()=>({partial:false}),search:()=>[]},publication:{prune:()=>{},publish:()=>{published++}},audit:{write:async()=>{}}});
  await owner.searchDocuments('form',5);assert.equal(invalidated,1);assert.equal(probes.length,2);assert.equal(probes[1].fresh,true);assert.deepEqual(commands[0],commands[1]);assert.equal(published,0);
  await owner.runtime.dispose();await assert.rejects(owner.searchDocuments('form',5),{code:'DOCUMENT_SEARCH_DISPOSED'});
});
