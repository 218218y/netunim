import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createDocumentSearch} from '../netunim-orders/document-bridge/search-owner.mjs';
import {createDocumentFileAccess} from '../netunim-orders/document-bridge/file-access-policy.mjs';
import path from 'node:path';

for(const mode of ['everything','content','recent'])test(`${mode} timing includes final admission and audit delays`,async()=>{
  const row={fullPath:'C:\\synthetic\\file.pdf'}, logs=[];
  const owner=createDocumentSearch({
    everything:{search:async()=>({rows:[row],elapsedMs:2}),recent:async()=>({rows:[row],elapsedMs:2})},
    pdf:{prepare:async()=>{await delay(15);return {partial:false}},search:async()=>[]},
    ordering:{merge:groups=>groups.flat(),compare:()=>0},
    publication:{prune:()=>{},admit:async rows=>{await delay(45);return rows},publish:()=>({id:'opaque'})},
    audit:{write:async line=>{logs.push(line);await delay(25)}},
  },{bridgeVersion:47,maxResults:5000,defaultLimit:150,recentLimit:150});
  const started=performance.now();
  const plan={query:'synthetic',mode,scopePath:'',fileType:'all',sort:{field:'name',direction:'asc'},contentSearch:{},everythingQuery:'synthetic',includePdf:true};
  const page=mode==='recent'?await owner.recent(plan,1):await owner.search(plan,1,0);
  const wall=performance.now()-started;
  assert.ok(page.elapsedMs>=65,`${page.elapsedMs} must include 45ms admission plus 25ms audit`);
  assert.ok(page.elapsedMs<=wall+2);
  assert.ok(page.timings.publicationMs>=40);
  assert.ok(page.timings.auditMs>=20);
  assert.equal(page.timings.everythingMs,2);
  if(mode==='content')assert.ok(page.timings.pdfPrepareMs>=10);
  assert.equal(logs.length,1);
  await owner.dispose();
});

test('root, canonical-path and live-hidden checks have separate request-local timings',async()=>{
  const root=path.resolve('synthetic-business'),file=path.join(root,'file.pdf');
  const access=createDocumentFileAccess({loadConfig:async()=>({roots:[root]}),files:{
    realpath:async value=>{await delay(10);return value},stat:async()=>({isDirectory:()=>true})},
    visible:async values=>{await delay(15);return values.map(()=>true)},
  });
  const timings={rootValidationMs:0,pathValidationMs:0,hiddenValidationMs:0};
  assert.deepEqual(await access.admit([{fullPath:file}],timings),[{fullPath:file}]);
  assert.ok(timings.rootValidationMs>=5);
  assert.ok(timings.pathValidationMs>=5);
  assert.ok(timings.hiddenValidationMs>=10);
  await assert.rejects(access.authorize(path.resolve('outside-business/file.pdf')),{code:'DOCUMENT_PATH_FORBIDDEN'});
});
