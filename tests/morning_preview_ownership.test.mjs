import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCustomersDocuments} from '../netunim-orders/site/assets/js/domains/customers/documents.js';
import {createMorningBrowserFixture as createDomainsCustomersDocumentsBrowser} from './morning_browser_ports.mjs';
import {createMorningRequest} from '../netunim-orders/site/assets/js/integrations/morning.js';

function gate(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function fixture(t,{hold='preview'}={}){
  const prior=new Map(['document','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL,urls=new Map(),revoked=[],calls=[],modals=[],elements=new Map(),entered=gate(),held=gate();
  URL.createObjectURL=blob=>{const url=`blob:preview-${urls.size+1}`;urls.set(url,blob);return url};URL.revokeObjectURL=url=>revoked.push(url);
  const back={classList:{contains:()=>true}},panel={firstElementChild:{}},surface={isConnected:true},frame={src:'',isConnected:true,removeAttribute(){this.src=''}},box={hidden:true,scrollIntoView(){}},note={textContent:''};
  elements.set('#modalBackdrop',back);elements.set('#modal',panel);
  const fields={morningClientName:'Exact customer',morningAmount:'42',morningDocumentDate:'2026-10-14',morningDescription:'Exact invoice'};
  for(const [id,value] of Object.entries(fields))elements.set('#'+id,{value,dataset:{}});
  const document={querySelector:key=>key.startsWith('[data-morning-generation=')?surface:key==='input[name="morningDocumentType"]:checked'?{value:'305'}:elements.get(key)||null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};
  Object.defineProperty(globalThis,'document',{value:document,configurable:true});
  const entries=new Map();Object.defineProperty(globalThis,'localStorage',{value:{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)},configurable:true});
  const operationScope={capture:()=>()=>{},captureRead:()=>()=>{}};
  const request=createMorningRequest({operationScope,supaFetch:async(_path,options)=>{
    const {action}=JSON.parse(options.body);calls.push(action);
    if(action===hold){entered.resolve();await held.promise}
    if(action==='document_pdf')return new Response('%PDF-1.4\nexact official PDF',{headers:{'Content-Type':'application/pdf'}});
    return new Response(JSON.stringify(action==='preview'?{ok:true,pdfBase64:btoa('%PDF-1.4\nolder draft')}:{ok:true,configured:true,available:true,environment:'sandbox'}));
  }});
  const modal=(title,body)=>{modals.push(title);panel.firstElementChild={};if(body.includes('morningPreviewFrame')){elements.set('#morningPreviewBox',box);elements.set('#morningPreviewFrame',frame);elements.set('#morningPreviewNote',note)}if(body.includes('morningStandalonePreviewFrame')){elements.set('#morningStandalonePreview',box);elements.set('#morningStandalonePreviewFrame',frame)}};
  const browser=createDomainsCustomersDocumentsBrowser({operationScope,modal,toast:message=>assert.fail(message),request,dateEditorMarkup:()=>''});
  const documents=createDomainsCustomersDocuments({operationScope,model:{state:{customerDebts:[]}},modal,toast:message=>assert.fail(message),request,documentsBrowser:browser,dateEditorMarkup:()=>'',confirmDialog:async()=>true});
  t.after(()=>{held.resolve();documents.dispose();browser.dispose();URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const [key,value] of prior)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]});
  return {browser,documents,entered,held,frame,box,note,urls,revoked,modals,otherModal(){panel.firstElementChild={};modals.push('Other capability')}};
}

test('a held draft preview cannot replace the later official PDF in the same issuance iframe',async t=>{
  const f=fixture(t);await f.documents.openMorningDocumentModal({initialType:305});
  const draft=f.documents.previewMorningDocument();await f.entered.promise;
  assert.equal(await f.browser.viewDocument('official-document'),true);const official=f.frame.src;
  assert.match(await f.urls.get(official).text(),/exact official PDF/);
  f.held.resolve();await draft;
  assert.equal(f.frame.src,official,'a superseded draft must not replace the official viewer source');
  assert.equal(f.revoked.includes(official),false,'the official viewer toolbar must retain its live Blob');
  assert.match(f.note.textContent,/מסמך רשמי/);
});

test('a delayed standalone PDF cannot replace a newer modal owned by another capability',async t=>{
  const f=fixture(t,{hold:'document_pdf'}),viewing=f.browser.viewDocument('official-document');await f.entered.promise;
  f.otherModal();f.held.resolve();
  assert.equal(await viewing,false,'the former modal request must lose publication authority');
  assert.deepEqual(f.modals,['Other capability']);assert.equal(f.urls.size,0);
});
