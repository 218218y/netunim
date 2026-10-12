import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEsCount,parseEsJson} from '../netunim-orders/document-bridge/lib.mjs';
import {decodeEverythingRows} from '../netunim-orders/document-bridge/everything-result-codec.mjs';
const row={Name:'מסמך.pdf',Path:'C:\\synthetic',Size:null,Attributes:32};

test('reviewed ES 1.1.0.38 empty stdout and explicit empty collections remain valid zero results',()=>{
  for(const text of ['', ' \r\n', '\uFEFF\r\n', '[]', '{"results":[]}', '{"items":[]}', '{"files":[]}', '{"rows":[]}'])assert.deepEqual(parseEsJson(text),[]);
  assert.equal(parseEsCount('\uFEFF0\r\n'),0);assert.equal(parseEsCount('000123\r\n'),123);
});
test('bare exports and named compatibility wrappers preserve Unicode rows and exact row cardinality',()=>{
  for(const value of [[row],{results:[row]},{Items:[row]},{files:[row]},{Rows:[row]}]){
    const rows=parseEsJson('\uFEFF'+JSON.stringify(value));assert.equal(rows.length,1);assert.equal(rows[0].fullPath,'C:\\synthetic\\מסמך.pdf');assert.equal(rows[0].name,row.Name);assert.equal(rows[0].isDirectory,false);
  }
});
for(const value of [null,true,5,'error',{}, {error:'PRIVATE_SYNTHETIC'}, {metadata:[]}, {results:null,items:[]}, {items:[],results:null}, {results:[],items:[]}, {results:{},metadata:[]}]){
  test(`non-result envelope rejects instead of publishing empty rows: ${JSON.stringify(value)}`,()=>{
    assert.throws(()=>parseEsJson(JSON.stringify(value)),error=>error.code==='ES_INVALID_JSON'&&!error.message.includes('PRIVATE_SYNTHETIC'));
  });
}
for(const value of [null,[],true,{}, {Name:9,Path:'C:\\synthetic'}, {Name:'one.pdf',Path:{}}, {Name:'one.pdf',Path:'relative'}, {Name:'one.pdf',Path:'C:\\synthetic',FullPath:[]}]){
  test(`invalid row cannot silently shorten a valid page: ${JSON.stringify(value)}`,()=>{
    assert.throws(()=>parseEsJson(JSON.stringify([row,value,row])),error=>error.code==='ES_INVALID_JSON'&&error.rowIndex===1);
  });
}
test('invalid JSON diagnostics do not contain document text or path payloads',()=>{
  assert.throws(()=>parseEsJson('[{"Name":"PRIVATE_SYNTHETIC"'),error=>error.code==='ES_INVALID_JSON'&&!error.message.includes('PRIVATE_SYNTHETIC')&&error.cause===undefined);
});
test('scalar counts reject partial status text, fractions, grouped output and unsafe integers',()=>{
  for(const text of ['','error 0','123 error','-1','1.5','1,000','1e3','9007199254740992','NaN','PRIVATE_SYNTHETIC 1'])assert.throws(()=>parseEsCount(text),error=>error.code==='ES_INVALID_COUNT'&&!error.message.includes('PRIVATE_SYNTHETIC'));
});
test('direct full-path columns and absolute drive roots retain valid identity',()=>{
  assert.equal(parseEsJson(JSON.stringify([{Name:'one.pdf',FullPath:'\\\\server\\share\\one.pdf'}]))[0].fullPath,'\\\\server\\share\\one.pdf');
  const root=parseEsJson(JSON.stringify([{Name:'C:\\',Attributes:16}]))[0];assert.equal(root.fullPath,'C:\\');assert.equal(root.isDirectory,true);
});
test('nullable optional path columns retain existing compatibility when full identity is independently available',()=>{
  for(const row of [{Name:'one.pdf',Path:null,FullPath:'C:\\synthetic\\one.pdf'},{Name:'one.pdf',Path:'C:\\synthetic',FullPath:null}])assert.equal(parseEsJson(JSON.stringify([row]))[0].fullPath,'C:\\synthetic\\one.pdf');
  assert.throws(()=>parseEsJson('[{"Name":"one.pdf","Path":null,"FullPath":null}]'),{code:'ES_INVALID_JSON'});
});
test('an invalid async decoder cannot publish a page or leak an unobserved rejection',async()=>{
  assert.throws(()=>decodeEverythingRows('[{}]',async()=>{throw new Error('decoder failure')}),{code:'ES_INVALID_JSON'});await Promise.resolve();
});
