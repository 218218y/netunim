import test from 'node:test';
import assert from 'node:assert/strict';
import {plain,row,serverFixture} from './document_search_server_fixture.mjs';

// The historical fixture stays immutable. Native transport now intentionally
// adds content decoding and an overall deadline; its retry behavior is exercised
// against the actual factory in document_index_coordinators.test.mjs.
// Compare unchanged native partial-search paging here. Whole-word publication
// now intentionally uses canonical verification over candidate pages; the real
// factory/corpus regressions cover that separate behavior without rewriting this
// immutable historical policy.

test('old and current search preserve 4,608 pagination, filter, order and partial-PDF combinations',async()=>{
 let cases=0;
 for(const mode of ['everything','content'])for(const type of ['all','audio','documents','folders','images','video','pdf','word'])
 for(const field of ['name','path','size','modified'])for(const direction of ['asc','desc'])
 for(const offset of [-2,0,1,3,4999,5000])for(const limit of [undefined,0,1,2.8,150,6000]){
  const options={partial:cases%2===0,rows:[row(1),row(2),row(3),row(8,{size:null})],pdfRows:[row(2,{fullPath:'c:\\SYNTHETIC\\DOCUMENT-2.pdf'}),row(4),row(5)]};
  const old=serverFixture('baseline',options),current=serverFixture('current',options);
  const args=[' document ',limit,mode,{matchMode:'all',wordMatch:'partial',proximityWords:4},'C:\\synthetic',offset,{field,direction},type];
  const expected=await old.search(...args),actual=await current.search(...args);
  const excludesPdf=mode==='content'&&!['all','documents','pdf'].includes(type);
  if(excludesPdf)expected.partial=false;
  assert.deepEqual(plain(actual),plain(expected),JSON.stringify(args));
  for(const result of actual.results){assert.deepEqual(plain(await current.resolve(result.id)),plain(await old.resolve(result.id)));assert.equal(Object.hasOwn(result,'fullPath'),false)}
  const historical=old.observation();
  if(excludesPdf){
    historical.calls=historical.calls.filter(call=>call[0]!=='pdf-prepare');
    historical.logs=historical.logs.map(message=>message.replace('partial=true','partial=false'));
  }
  assert.deepEqual(current.observation(),historical);cases++;
 }
 assert.equal(cases,4608);
});

test('old and current recent results preserve historical fractional/default limits and scoped type filters',async()=>{
 let cases=0;
 for(const limit of [undefined,null,-10,0,1,1.8,'2',150,9999])for(const scope of ['', 'C:/synthetic/', '"C:\\synthetic"'])for(const type of ['all','pdf','folders','invalid']){
  const old=serverFixture('baseline'),current=serverFixture();const args=[limit,scope,type];
  assert.deepEqual(plain(await current.recent(...args)),plain(await old.recent(...args)));
  assert.deepEqual(current.observation(),old.observation());cases++;
 }
 assert.equal(cases,108);
});

test('query rejection, capped empty pages and read failures cannot mint opaque IDs or log success',async()=>{
 for(const mode of ['everything','content'])for(const query of ['',null,{},'x']){
  const old=serverFixture('baseline'),current=serverFixture();
  async function outcome(f){try{return {value:plain(await f.search(query,1,mode))}}catch(error){return {error:{code:error.code,message:error.message}}}}
  assert.deepEqual(await outcome(current),await outcome(old));assert.deepEqual(current.observation(),old.observation());
 }
 for(const which of ['everything','prepare']){
  const error=Object.assign(new Error(which),{code:'SYNTHETIC_FAILURE'}),f=serverFixture('current',{[which]:async()=>{throw error}});
  await assert.rejects(f.search('document',2,'content'),value=>value===error);assert.equal(f.ids(),0);assert.deepEqual(f.logs,[]);
 }
});

test('registry keeps exact TTL boundary, missing-target errors, case-insensitive invalidation and captured command authority',async()=>{
 for(const version of ['baseline','current']){
  const f=serverFixture(version),page=await f.search('document',2),ids=page.results.map(item=>item.id);
  await f.resolve(ids[0]);f.setTime(10_000+600_000-1);await f.resolve(ids[0]);f.setTime(10_000+600_000);
  await assert.rejects(f.resolve(ids[0]),{code:'RESULT_EXPIRED',message:'תוצאת החיפוש פגה. חפש שוב את הקובץ.'});
  const missing=serverFixture(version,{stat:async()=>{throw new Error('synthetic file missing')}}),item=(await missing.search('document',1)).results[0];
  await assert.rejects(missing.resolve(item.id),{code:'OPEN_TARGET_MISSING',message:'הקובץ כבר אינו קיים או שאינו נגיש.'});
  const invalid=serverFixture(version),results=(await invalid.search('document',2)).results;
  assert.deepEqual(plain(await invalid.invalidate('c:\\SYNTHETIC\\DOCUMENT-1.pdf')),[results[0].id]);
  await assert.rejects(invalid.resolve(results[0].id),{code:'RESULT_EXPIRED'});await invalid.resolve(results[1].id);
 }
});
