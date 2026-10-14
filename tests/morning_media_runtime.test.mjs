import test from 'node:test';
import assert from 'node:assert/strict';
import {createMorningDocumentMedia,decodeMorningDraftPdf,decodeMorningVerifiedDocumentId} from '../netunim-orders/site/assets/js/domains/customers/morning-document-media.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(){
  const created=[],revoked=[],messages=[],held=gate(),entered=gate(),frame={src:'',removeAttribute(){this.src=''}};let current=true,watcher=null,watches=0;
  const media=createMorningDocumentMedia({request:{json:async()=>null,pdf:async()=>{entered.resolve();await held.promise;return new Blob(['%PDF-exact'])}},authority:{capture:()=>()=>{}},
    presentation:{capture:()=>({isCurrent:()=>current,show:url=>{frame.src=url;return frame}})},platform:{createUrl:()=>{const url=`blob:${created.length}`;created.push(url);return url},revokeUrl:url=>revoked.push(url),watch:callback=>{watches++;watcher=callback;return ()=>{watches--;watcher=null}}},feedback:{toast:text=>messages.push(text)}});
  return {media,created,revoked,messages,held,entered,frame,get watches(){return watches},replaceSurface(){current=false;watcher?.()}};
}
for(const change of ['cancel','dispose','replace'])test(`media ${change} fences publication and drains the accepted PDF request`,async()=>{
  const f=fixture(),viewing=f.media.viewDocument('same-document');await f.entered.promise;
  if(change==='cancel')f.media.cancelPending();else if(change==='dispose'){assert.equal(f.media.dispose(),true);assert.equal(f.media.dispose(),false)}else f.replaceSurface();
  let drained=false;const draining=f.media.drain().then(()=>{drained=true});for(let n=0;n<8;n++)await Promise.resolve();assert.equal(drained,false);assert.equal(f.media.isPending(),true);
  f.held.resolve();assert.equal(await viewing,false);await draining;
  assert.deepEqual(f.created,[]);assert.deepEqual(f.messages,[]);assert.equal(f.media.isPending(),false);assert.equal(f.watches,0);f.media.dispose();
});
test('an embedded viewer keeps its Blob until close, then releases URL and observation exactly once',async()=>{
  const f=fixture();f.held.resolve();assert.equal(await f.media.viewDocument('same-document'),true);
  assert.equal(f.frame.src,f.created[0]);assert.deepEqual(f.revoked,[]);assert.equal(f.watches,1);
  f.replaceSurface();assert.equal(f.frame.src,'');assert.deepEqual(f.revoked,f.created);assert.equal(f.watches,0);f.media.dispose();assert.equal(f.revoked.length,1);
});
test('cleanup releases only its owned URL and cannot detach a newer iframe source',async()=>{
  const f=fixture();f.held.resolve();await f.media.viewDocument('same-document');f.frame.src='blob:another-capability';f.media.dispose();
  assert.equal(f.frame.src,'blob:another-capability');assert.deepEqual(f.revoked,f.created);
});
test('unknown preview JSON is decoded before it can create a PDF source',()=>{
  for(const value of [null,[],{},true,{pdfBase64:123},{pdfBase64:''},{pdfBase64:'%%%invalid'},{pdfBase64:btoa('<html>unexpected</html>')}])assert.throws(()=>decodeMorningDraftPdf(value));
  const blob=decodeMorningDraftPdf({pdfBase64:btoa('%PDF-1.4\nexact draft')});assert.equal(blob.type,'application/pdf');assert.ok(blob.size>0);
});
test('unknown operation JSON cannot invent a verified document identity',()=>{
  const operation={state:'created',verified_at:'2026-10-14T00:00:00Z',document_id:'historical-document'};
  assert.equal(decodeMorningVerifiedDocumentId({operation}),operation.document_id);
  for(const value of [null,[],{operation:null},{operation:{...operation,state:'created_unverified'}},{operation:{...operation,verified_at:true}},{operation:{...operation,verified_at:'unknown'}},{operation:{...operation,document_id:7}}])assert.throws(()=>decodeMorningVerifiedDocumentId(value));
});
test('disposal during operation lookup joins that read without starting a later PDF request',async()=>{
  const held=gate(),entered=gate();let pdfReads=0;
  const media=createMorningDocumentMedia({request:{json:async()=>{entered.resolve();await held.promise;return {operation:{state:'created',verified_at:'2026-10-14T00:00:00Z',document_id:'retained-ID'}}},pdf:async()=>{pdfReads++;return new Blob()}},authority:{capture:()=>()=>{}},
    presentation:{capture:()=>({isCurrent:()=>true,show:()=>null})},platform:{createUrl:()=>'',revokeUrl(){},watch:()=>()=>{}},feedback:{toast:()=>assert.fail('obsolete read cannot warn')}});
  const viewing=media.viewVerifiedOperation('same-operation');await entered.promise;media.dispose();held.resolve();
  assert.equal(await viewing,false);await media.drain();assert.equal(pdfReads,0,'a closed command must not enter a new provider stage');
});
