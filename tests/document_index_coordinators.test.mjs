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

function contentSearchFixture(rawRows){
  const reads=[],published=[];
  const owner=createEverythingSearchCoordinator({
    configuration:{load:async()=>({searchTimeoutMs:1000})},
    session:{probe:async()=>({esPath:'isolated-es',instance:'synthetic'}),invalidate:()=>{},executable:async()=>''},
    process:{run:async(_file,args)=>{
      reads.push(args);
      const offset=args.includes('-offset')?Number(args[args.indexOf('-offset')+1]):0,limit=Number(args[args.indexOf('-max-results')+1]);
      return {stdout:JSON.stringify(rawRows.slice(offset,offset+limit))};
    }},
    pdf:{prepare:async()=>({partial:false}),search:()=>[]},
    publication:{prune:()=>{},publish:row=>{published.push(row);return {...row,id:row.name}}},audit:{write:async()=>{}}
  });
  return {owner,reads,published};
}
const candidate=(name,content)=>({name,path:'C:\\synthetic',content});

test('transport retries only exit 8 once; abort, malformed JSON and ordinary failures cannot publish',async()=>{
  for(const failure of [{exitCode:8},{exitCode:2},{name:'AbortError',code:'ABORT_ERR'},'invalid-json']){
    let attempts=0,invalidations=0,published=0;
    const owner=createEverythingSearchCoordinator({
      configuration:{load:async()=>({searchTimeoutMs:100})},
      session:{probe:async()=>({esPath:'synthetic',instance:'A'}),invalidate:()=>{invalidations++}},
      process:{run:async()=>{attempts++;if(failure==='invalid-json')return {stdout:'{"results":null}'};throw failure}},
      pdf:{prepare:async()=>({partial:false}),search:()=>[]},
      publication:{prune:()=>{},publish:()=>{published++}},audit:{write:async()=>{}}
    });
    await assert.rejects(owner.searchDocuments('form',1));
    assert.equal(attempts,failure.exitCode===8?2:1);assert.equal(invalidations,failure.exitCode===8?1:0);assert.equal(published,0);
    await owner.runtime.dispose();
  }
});

test('native proximity candidates are verified before publication, with repeated late suffixes and no content disclosure',async()=>{
  const f=contentSearchFixture([
    candidate('late-valid.txt','אב '.repeat(10000)+'אין'),
    candidate('repeated.txt','אב '.repeat(10000)),
    candidate('wrong-order.txt','אין '+'אב '.repeat(1000)),
    candidate('gap-overflow.txt','אב '.repeat(1000)+'אחר '.repeat(300)+'אין'),
    candidate('short-valid.txt','אב '.repeat(5)+'אין')
  ]);
  const result=await f.owner.searchDocuments('אב אב אב אב אב אין',5,'content',{matchMode:'proximity',proximityWords:50},'',0,{field:'name',direction:'asc'});
  assert.deepEqual(result.results.map(row=>row.name),['late-valid.txt','short-valid.txt']);
  assert.equal(result.partial,false);assert.equal(result.hasMore,false);
  assert.ok(f.reads[0].includes('content'));assert.doesNotMatch(f.reads[0].at(-1),/regex:/);
  assert.ok(f.published.every(row=>!Object.hasOwn(row,'content')));
});

test('candidate pages cannot consume verified result offsets or change native sort, scope and type filters',async()=>{
  const rows=Array.from({length:105},(_,i)=>candidate(String(i).padStart(3,'0')+'.txt',i<101?'beta alpha':'alpha beta'));
  const f=contentSearchFixture(rows);
  const result=await f.owner.searchDocuments('alpha beta',2,'content',{matchMode:'proximity',proximityWords:0},'C:\\synthetic',1,{field:'name',direction:'asc'},'documents');
  assert.deepEqual(result.results.map(row=>row.name),['102.txt','103.txt']);assert.equal(result.hasMore,true);
  assert.equal(f.reads.length,2);
  for(const args of f.reads){assert.equal(args[args.indexOf('-path')+1],'C:\\synthetic');assert.match(args.at(-1),/^doc:/);assert.equal(args[args.indexOf('-sort')+1],'name-ascending');}
});

test('unavailable native content fails explicitly instead of silently dropping a candidate',async()=>{
  const f=contentSearchFixture([{name:'missing.txt',path:'C:\\synthetic'}]);
  await assert.rejects(f.owner.searchDocuments('alpha beta',5,'content',{matchMode:'proximity'}),{code:'ES_CONTENT_UNAVAILABLE'});
  assert.deepEqual(f.published,[]);
});

test('exhausting the candidate budget remains partial rather than reporting a complete empty search',async()=>{
  const f=contentSearchFixture(Array.from({length:5001},(_,i)=>candidate(i+'.txt','beta alpha')));
  const result=await f.owner.searchDocuments('alpha beta',1,'content',{matchMode:'proximity',proximityWords:0});
  assert.deepEqual(result.results,[]);assert.equal(result.partial,true);assert.equal(f.reads.length,50);
});

test('phone-like proximity and ordinary Everything expressions retain their existing native contracts',async()=>{
  const f=contentSearchFixture([]);
  await f.owner.searchDocuments('050 1234567',1,'content',{matchMode:'proximity'});
  assert.match(f.reads[0].at(-1),/regex:content:/);assert.equal(f.reads[0].includes('content'),false);
  await f.owner.searchDocuments('regex:report',1,'everything',{matchMode:'proximity'});
  assert.equal(f.reads[1].at(-1),'regex:report');assert.equal(f.reads[1].includes('content'),false);
});
