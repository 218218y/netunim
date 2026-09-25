import assert from 'node:assert/strict';

const elements=new Map();
const root={setAttribute(){},querySelectorAll(){return[]}};
const box={hidden:true,scrollIntoView(){}};
const frame={
  _src:'',
  listeners:new Map(),
  addEventListener(type,handler){this.listeners.set(type,handler)},
  emit(type){this.listeners.get(type)?.()},
  removeAttribute(name){if(name==='src')this._src=''},
  set src(value){this._src=String(value)},
  get src(){return this._src},
};
elements.set('#morningDocumentsBrowser',root);
elements.set('#morningBrowserPreview',box);
elements.set('#morningBrowserPreviewFrame',frame);
globalThis.document={querySelector(selector){return elements.get(selector)||null}};

const created=[],revoked=[];
const originalCreateObjectURL=URL.createObjectURL;
const originalRevokeObjectURL=URL.revokeObjectURL;
URL.createObjectURL=()=>{const url=`blob:morning-test-${created.length+1}`;created.push(url);return url};
URL.revokeObjectURL=url=>{revoked.push(String(url))};

try{
  const {createDomainsCustomersDocumentsBrowser}=await import('../netunim-orders/site/assets/js/domains/customers/documents-browser.js');
  const browser=createDomainsCustomersDocumentsBrowser({
    modal(){},
    toast(message){throw new Error(`Unexpected toast: ${message}`)},
    dateEditorMarkup(){return''},
    supaFetch:async()=>new Response(new Blob(['%PDF-1.4\nmock'],{type:'application/pdf'}),{status:200,headers:{'Content-Type':'application/pdf'}}),
  });

  assert.equal(await browser.viewDocument('00000000-0000-4000-8000-000000000001'),true);
  const firstUrl=frame.src;
  assert.equal(firstUrl,created[0]);
  assert.deepEqual(revoked,[],'The active PDF Blob URL must not be revoked while the iframe is using it');

  // The historical regression revoked the source from the iframe load event. Chrome can still
  // render/print the already-loaded PDF, but its built-in Download command then cannot reopen it.
  frame.emit('load');
  assert.deepEqual(revoked,[],'Iframe load must not invalidate the Blob URL used by the PDF viewer toolbar');

  assert.equal(await browser.viewDocument('00000000-0000-4000-8000-000000000002'),true);
  assert.deepEqual(revoked,[firstUrl],'Replacing the preview must still release the previous Blob URL');
  assert.equal(revoked.includes(frame.src),false,'The replacement PDF must remain backed by a live Blob URL');

  elements.delete('#morningDocumentsBrowser');elements.delete('#morningBrowserPreview');elements.delete('#morningBrowserPreviewFrame');
  const standaloneBox={hidden:true,scrollIntoView(){}},standaloneFrame={src:''};let opened=0;
  const linkedBrowser=createDomainsCustomersDocumentsBrowser({
    modal(_title,body){opened++;assert.match(body,/morningStandalonePreviewFrame/);elements.set('#morningStandalonePreview',standaloneBox);elements.set('#morningStandalonePreviewFrame',standaloneFrame)},
    toast(message){throw new Error(`Unexpected toast: ${message}`)},
    dateEditorMarkup(){return''},
    supaFetch:async()=>new Response(new Blob(['%PDF-1.4\nlinked'],{type:'application/pdf'}),{status:200,headers:{'Content-Type':'application/pdf'}}),
  });
  assert.equal(await linkedBrowser.viewDocument('linked-from-bank-or-debt'),true);
  assert.equal(opened,1,'a linked document opens its own viewer outside Morning dialogs');
  assert.match(standaloneFrame.src,/^blob:morning-test-/);

  let statusReads=0;
  const legacyBrowser=createDomainsCustomersDocumentsBrowser({
    modal(){throw new Error('Existing standalone viewer should be reused')},
    toast(message){throw new Error(`Unexpected toast: ${message}`)},
    dateEditorMarkup(){return''},
    supaFetch:async(_path,options)=>{
      const body=JSON.parse(options.body);
      if(body.action==='status'){statusReads++;return new Response(JSON.stringify({ok:true,operation:{state:'created',verified_at:'2026-09-09T10:00:00Z',document_id:'legacy-doc'}}),{status:200,headers:{'Content-Type':'application/json'}})}
      if(body.action==='get_document')return new Response(JSON.stringify({ok:true,document:{id:'legacy-doc',number:'2001',type:400}}),{status:200,headers:{'Content-Type':'application/json'}});
      assert.equal(body.document_id,'legacy-doc');return new Response(new Blob(['%PDF-1.4\nlegacy'],{type:'application/pdf'}),{status:200,headers:{'Content-Type':'application/pdf'}});
    },
  });
  assert.equal(await legacyBrowser.viewVerifiedOperation('legacy-operation'),true);
  assert.equal(statusReads,1,'a historical debt movement resolves its document through the verified operation ledger');

  const label={textContent:'מסמך Morning'},button={dataset:{morningDebtOperation:'legacy-operation'},title:'',isConnected:true,querySelector(selector){return selector==='[data-morning-debt-label]'?label:null}};
  const hydrateRoot={querySelectorAll(selector){assert.equal(selector,'[data-morning-debt-operation]');return[button]}};
  assert.equal(await legacyBrowser.hydrateDebtDocumentLinks(hydrateRoot),1);
  assert.equal(statusReads,2,'legacy metadata hydration reads the same authoritative operation ledger');
  assert.equal(button.dataset.clickArg0,'legacy-doc');assert.equal(label.textContent,'קבלה 2001','missing ledger metadata is read back from the official Morning document instead of guessed');

  let metadataReads=0;
  const metadataBrowser=createDomainsCustomersDocumentsBrowser({
    modal(){},toast(message){throw new Error(`Unexpected toast: ${message}`)},dateEditorMarkup(){return''},
    supaFetch:async(_path,options)=>{const body=JSON.parse(options.body);assert.equal(body.action,'status');metadataReads++;return new Response(JSON.stringify({ok:true,operation:{state:'created',verified_at:'2026-09-09T10:00:00Z',document_id:'doc-3889',document_number:'3889',document_type:320}}),{status:200,headers:{'Content-Type':'application/json'}})},
  });
  const richLabel={textContent:'מסמך Morning'},richButton={dataset:{morningDebtOperation:'operation-3889'},title:'',isConnected:true,querySelector(){return richLabel}},richRoot={querySelectorAll(){return[richButton]}};
  assert.equal(await metadataBrowser.hydrateDebtDocumentLinks(richRoot),1);assert.equal(metadataReads,1);assert.equal(richButton.dataset.clickArg0,'doc-3889');assert.equal(richLabel.textContent,'חשבונית מס / קבלה 3889');assert.equal(richButton.dataset.morningDebtOperation,undefined);

  console.log('PASS Morning embedded PDF keeps its Blob URL alive until the preview is replaced');
} finally {
  URL.createObjectURL=originalCreateObjectURL;
  URL.revokeObjectURL=originalRevokeObjectURL;
}
