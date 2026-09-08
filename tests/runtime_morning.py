"""Morning UI workflows with deterministic transport; never issues real documents."""
from browser_harness import BrowserSession, ROOT
import json

FLOW=r"""
const assert=(value,message)=>{if(!value)throw new Error(message)};
const errors=[];window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason?.stack||event.reason)));
const waitFor=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw new Error('Morning UI timed out '+document.getElementById('morningConnectionStatus')?.textContent+' '+JSON.stringify(calls.slice(-3))+' '+JSON.stringify(errors)+' '+document.querySelector('[data-action="morning-create"]')?.outerHTML)};
const click=name=>{const button=document.querySelector('[data-action="'+name+'"]');assert(button,'Missing action '+name);button.click()};
const fill=(id,value)=>{document.getElementById(id).value=value};
const calls=[],docs=Array.from({length:26},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),number:100+i,type:305,date:'2026-09-08',amount:100,currency:'ILS',clientName:i===0?'Manual Morning':'App document',status:0,allocationNumber:'123'}));
let uncertain=false,resolveStatus=false,operation=null;
cloudAuth.supaFetch=async(path,options)=>{
  const request=JSON.parse(options.body);calls.push(request);assert(!('debt_id' in request),'Debt ID sent to backend');
  let data={ok:true};
  if(request.action==='status')data={ok:true,configured:true,available:true,environment:'sandbox',operation:resolveStatus?{...operation,state:'created',verified_at:new Date().toISOString(),document_id:docs[0].id,document_number:100}:operation,unresolved:!!operation&&!resolveStatus};
  if(request.action==='create'){
    if(uncertain){operation={operation_id:request.operation_id,state:'needs_reconciliation'};return new Response(JSON.stringify({ok:false,uncertain:true,code:'morning_creation_uncertain',message:'Simulated lost response'}),{status:502})}
    data={ok:true,verified:true,document:{id:docs[0].id,number:100,allocationNumber:'123'}};
  }
  if(request.action==='search_documents')data={ok:true,items:docs.slice(request.page*25,(request.page+1)*25),total:26,pages:2};
  if(request.action==='get_document')data={ok:true,document:{...docs[0],description:'On demand details'}};
  if(request.action==='document_links')data={ok:true,url:'https://example.org/document.pdf?fresh='+calls.length};
  if(request.action==='document_pdf')return new Response(new TextEncoder().encode('%PDF-1.4\nmock'),{status:200,headers:{'Content-Type':'application/pdf'}});
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
state=normalizeState({version:4,customerDebts:[{id:'prefill-only',customerName:'Frozen debt',amount:100,paid:false,invoiceIssued:false,closedAt:null,phone:'123',orderNumber:'A1'}]});
const before=JSON.stringify(state.customerDebts);Object.freeze(state.customerDebts[0]);Object.freeze(state.customerDebts);
switchView('customers');click('open-morning-document');await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
assert(document.getElementById('morningClientName').value==='Frozen debt','Client prefilled');assert(document.getElementById('morningAmount').value==='100.00','Amount prefilled');
assert(!document.querySelector('.morning-history'),'Debt history removed');
click('morning-create');await waitFor(()=>document.getElementById('confirmBackdrop').classList.contains('open'));document.getElementById('confirmAccept').click();await waitFor(()=>document.getElementById('morningOperationResult').textContent.includes('100'));
await waitFor(()=>!document.getElementById('morningPreviewBox').hidden&&document.getElementById('morningPreviewFrame').src.startsWith('blob:'));
assert(calls.filter(c=>c.action==='document_pdf').length===1,'Verified issuance automatically loads the official Morning PDF');assert(document.getElementById('morningPreviewNote').textContent.includes('מסמך רשמי'),'Issued preview is explicitly official');
assert(document.querySelector('[data-action="morning-create"]').disabled&&document.querySelector('[data-action="morning-create"]').textContent.includes('הופק ואומת'),'Verified issuance locks the same dialog against accidental duplicate creation');
assert(JSON.stringify(state.customerDebts)===before,'Create changed debt bytes');
click('close-modal');click('open-morning-standalone');await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
assert(document.getElementById('morningClientName').value==='','Standalone starts empty');
fill('morningClientName','General');fill('morningAmount','100');fill('morningDescription','General document');
uncertain=true;click('morning-create');await waitFor(()=>document.getElementById('confirmBackdrop').classList.contains('open'));document.getElementById('confirmAccept').click();await waitFor(()=>!!operation);
const createCount=calls.filter(c=>c.action==='create').length;click('morning-create');assert(calls.filter(c=>c.action==='create').length===createCount,'Timeout triggered another POST');
await waitFor(()=>!document.querySelector('[data-action="morning-create"]').textContent.includes('מפיק'));resolveStatus=true;click('morning-reconcile');await waitFor(()=>document.getElementById('morningOperationResult').textContent.includes('100')&&document.querySelector('[data-action="morning-create"]').disabled);
assert(calls.some(c=>c.action==='status'&&c.reconcile&&c.operation_id===operation.operation_id),'Reconciliation must use operation ID');
assert(JSON.stringify(state.customerDebts)===before,'Reconciliation changed debt bytes');
click('close-modal');click('open-morning-documents');await waitFor(()=>document.querySelectorAll('.morning-browser-table tbody tr').length===25);
const initial=calls.find(c=>c.action==='search_documents');assert(initial.page===0&&initial.pageSize===25,'Pagination defaults');assert((Date.parse(initial.toDate)-Date.parse(initial.fromDate))/86400000===90,'90 day default');assert(initial.sort==='documentDate'&&initial.order==='DESC','Default sorting');
assert(document.getElementById('morningBrowserResults').textContent.includes('Manual Morning'),'External Morning document visible');
assert(!calls.some(c=>c.action==='get_document'),'No eager detail GET');
document.getElementById('morningNext').click();await waitFor(()=>document.querySelectorAll('.morning-browser-table tbody tr').length===1);
document.getElementById('morningPrevious').click();await waitFor(()=>document.querySelectorAll('.morning-browser-table tbody tr').length===25);
assert(calls.filter(c=>c.action==='search_documents').length===2,'Page cache reused');
click('morning-refresh');await waitFor(()=>calls.filter(c=>c.action==='search_documents').length===3&&!document.querySelector('[data-action="morning-refresh"]').disabled);
fill('morningSearchClient','Filtered');document.getElementById('morningSearchClient').dispatchEvent(new Event('input',{bubbles:true}));assert(calls.filter(c=>c.action==='search_documents').length===3,'No keypress search');
document.getElementById('morningSearchClient').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await waitFor(()=>calls.some(c=>c.clientName==='Filtered')&&document.querySelector('[data-action="morning-details"]'));
click('morning-details');await waitFor(()=>document.getElementById('morningBrowserDetails').textContent.includes('On demand'));
const opened=[];HTMLAnchorElement.prototype.click=function(){opened.push(this.href)};
click('morning-browser-view');await waitFor(()=>!document.getElementById('morningBrowserPreview').hidden&&document.getElementById('morningBrowserPreviewFrame').src.startsWith('blob:'));
assert(calls.filter(c=>c.action==='document_pdf').length===2,'Manual view streams a second fresh PDF after the automatic issued-document preview');
assert(opened.length===0,'View remains inside the app and does not open Morning');
click('morning-download');await waitFor(()=>opened.length===1);
assert(opened[0].startsWith('https://example.org/document.pdf?fresh='),'Download still uses a fresh PDF attachment link');
assert(calls.filter(c=>c.action==='document_links').length===1,'Only download requests the external signed link');
click('close-modal');operation=null;resolveStatus=false;click('open-morning-standalone');await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
document.querySelector('input[name="morningDocumentType"][value="400"]').click();click('morning-invoice-picker');await waitFor(()=>document.querySelector('[data-action="morning-select-invoice"]'));click('morning-select-invoice');assert(document.getElementById('morningLinkedDocument').value===docs[0].id,'Manual invoice picker');
assert(JSON.stringify(state.customerDebts)===before,'All Morning actions preserve debt bytes');
return {prefill:true,standalone:true,debtBytesUnchanged:true,verifiedCreate:true,officialPdfAfterCreate:true,timeout:true,operationReconciliation:true,liveSearch:true,pagination:true,cache:true,filters:true,details:true,freshLinks:true,manualInvoicePicker:true};
"""

with BrowserSession(ROOT/'netunim-orders/site','morning-workflow') as browser:
    result=browser.evaluate('(async()=>{'+FLOW+'})()',timeout=60)
    print(json.dumps(result))
    assert result and all(result.values())
print('PASS Morning UI workflows')
