"""Morning UI workflows with deterministic transport; never issues real documents."""
from browser_harness import BrowserSession, ROOT
import json
from runtime_morning_cloud import LOCAL_CLOUD

FLOW=LOCAL_CLOUD+r"""
const assert=(value,message)=>{if(!value)throw new Error(message)};
const errors=[];window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason?.stack||event.reason)));
const waitFor=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw new Error('Morning UI timed out '+document.getElementById('morningConnectionStatus')?.textContent+' '+JSON.stringify(calls.slice(-3))+' '+JSON.stringify(errors)+' '+document.querySelector('[data-action="morning-create"]')?.outerHTML)};
const click=name=>{const button=document.querySelector('[data-action="'+name+'"]');assert(button,'Missing action '+name);button.click()};
const fill=(id,value)=>{document.getElementById(id).value=value};
const calls=[],docs=Array.from({length:26},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),number:100+i,type:305,date:'2026-09-08',amount:100,currency:'ILS',clientName:i===0?'Manual Morning':'App document',status:0,allocationNumber:'123'}));
let uncertain=false,resolveStatus=false,operation=null;
cloudAuth.supaFetch=async(path,options)=>{
  const request=JSON.parse(options.body);calls.push(request);assert(!('debt_id' in request),'Debt ID sent to backend');assert(!('applyPayment' in request)&&!('applyInvoice' in request),'Local debt allocation policy sent to backend');
  let data={ok:true};
  if(request.action==='status')data={ok:true,configured:true,available:true,environment:'sandbox',operation:resolveStatus?{...operation,state:'created',verified_at:new Date().toISOString(),document_id:docs[0].id,document_number:100}:operation,unresolved:!!operation&&!resolveStatus};
  if(request.action==='reserve')data={ok:true,reserved:true,operation:{operation_id:request.operation_id,state:'reserved'}};
  if(request.action==='abandon_reservation')data={ok:true,abandoned:operation?.state==='reserved',operation:operation?.state==='reserved'?{...operation,state:'failed'}:operation};
  if(request.action==='create'){
    if(uncertain){operation={operation_id:request.operation_id,state:'needs_reconciliation',document_type:request.document.type,amount:request.document.amount};return new Response(JSON.stringify({ok:false,uncertain:true,code:'morning_creation_uncertain',message:'Simulated lost response'}),{status:502})}
    data={ok:true,verified:true,document:{id:docs[0].id,number:100,allocationNumber:'123',type:request.document.type,amount:request.document.amount}};
  }
  if(request.action==='search_documents')data={ok:true,items:docs.slice(request.page*25,(request.page+1)*25),total:26,pages:2};
  if(request.action==='get_document')data={ok:true,document:{...docs[0],description:'On demand details'}};
  if(request.action==='document_links')data={ok:true,url:'https://example.org/document.pdf?fresh='+calls.length};
  if(request.action==='document_pdf')return new Response(new TextEncoder().encode('%PDF-1.4\nmock'),{status:200,headers:{'Content-Type':'application/pdf'}});
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
state=normalizeState({version:4,customerDebts:[{id:'prefill-only',customerName:'Verified debt',amount:100,paid:false,invoiceIssued:false,closedAt:null,phone:'123',orderNumber:'A1'}]});
switchView('customers');click('open-morning-document');await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
assert(document.getElementById('morningClientName').value==='Verified debt','Client prefilled');assert(document.getElementById('morningAmount').value==='100.00','Amount prefilled');
const morningAmount=document.getElementById('morningAmount');assert(morningAmount.step==='1','Amount spinner uses whole-shekel step');morningAmount.stepUp();assert(Number(morningAmount.value)===101,'Amount spinner increments by one shekel');morningAmount.value='100.00';
fill('morningDescription','Edited before issue');assert(uiModal.modalHasUnsavedDraft(),'Morning edits arm the generic draft guard before issue');
assert(!document.querySelector('.morning-history'),'Debt history removed');
click('morning-create');await waitFor(()=>document.getElementById('confirmBackdrop').classList.contains('open'));
const fullConfirm=document.getElementById('confirmMessage').textContent;assert(fullConfirm.includes('עדכון החוב לאחר אימות'),'Debt-linked issuance explains automatic update');assert(fullConfirm.includes('תשלום')&&fullConfirm.includes('חשבונית'),'320 confirmation covers payment and invoice');
document.getElementById('confirmAccept').click();await waitFor(()=>document.getElementById('morningOperationResult').textContent.includes('100'));
await waitFor(()=>!document.getElementById('morningPreviewBox').hidden&&document.getElementById('morningPreviewFrame').src.startsWith('blob:'));
assert(calls.filter(c=>c.action==='document_pdf').length===1,'Verified issuance automatically loads the official Morning PDF');assert(document.getElementById('morningPreviewNote').textContent.includes('מסמך רשמי'),'Issued preview is explicitly official');
assert(document.querySelector('[data-action="morning-create"]').disabled&&document.querySelector('[data-action="morning-create"]').textContent.includes('הופק ואומת'),'Verified issuance locks the same dialog against accidental duplicate creation');
const verifiedDebt=state.customerDebts.find(d=>d.id==='prefill-only');assert(verifiedDebt.debtProgress?.length===2,'Verified 320 records payment and invoice progress');assert(verifiedDebt.debtProgress.every(e=>e.source==='morning'&&e.amount===100),'Verified progress is sourced from Morning at exact debt amount');assert(verifiedDebt.paidAt&&verifiedDebt.invoiceIssuedAt&&verifiedDebt.closedAt,'Verified full 320 closes both debt dimensions');
const linkedAfterVerified=JSON.stringify(verifiedDebt);assert(!uiModal.modalHasUnsavedDraft(),'Verified issuance commits the Morning modal draft baseline');
click('close-modal');assert(!document.getElementById('confirmBackdrop').classList.contains('open'),'Closing a verified Morning document does not show a false unsaved-changes confirmation');

click('open-morning-standalone');await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);assert(document.getElementById('morningClientName').value==='','Standalone starts empty');
fill('morningClientName','General');fill('morningAmount','100');fill('morningDescription','General document');click('morning-create');await waitFor(()=>document.getElementById('confirmBackdrop').classList.contains('open'));assert(!document.getElementById('confirmMessage').textContent.includes('עדכון החוב לאחר אימות'),'Standalone issuance does not claim a debt update');document.getElementById('confirmAccept').click();await waitFor(()=>document.getElementById('morningOperationResult').textContent.includes('100'));
assert(JSON.stringify(verifiedDebt)===linkedAfterVerified,'Standalone issuance does not mutate a debt');click('close-modal');

// A Morning receipt may document a payment that was already entered manually. The explicit local allocation policy must prevent double deduction.
state.customerDebts.push({id:'manual-partial',customerName:'Already paid manually',amount:100,paid:false,invoiceIssued:false,closedAt:null,phone:'555',orderNumber:'A-MAN',debtProgress:[{id:'MANUAL-PAY-30',kind:'payment',action:'add',amount:30,source:'manual',createdAt:'2026-09-09T09:00:00.000Z'}]});switchView('customers');
const manualButton=document.querySelector('[data-customer-bulk-id="manual-partial"] [data-action="open-morning-document"]');assert(manualButton,'Missing Morning button for manual partial debt');manualButton.click();await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
assert(document.getElementById('morningApplyPayment').checked&&document.getElementById('morningApplyInvoice').checked,'320 defaults to applying both local debt dimensions');assert(document.getElementById('morningDebtUpdatePanel').textContent.includes('כבר רשום תשלום')&&document.getElementById('morningDebtUpdatePanel').textContent.includes('30'),'Existing manual payment is prominently surfaced before issuance');
document.getElementById('morningApplyPayment').checked=false;fill('morningAmount','30');fill('morningDescription','Receipt for already-recorded payment');click('morning-create');await waitFor(()=>document.getElementById('confirmBackdrop').classList.contains('open'));
const allocationConfirm=document.getElementById('confirmMessage').textContent;assert(allocationConfirm.includes('תשלום: לא יעודכן'),'Explicit payment opt-out is repeated in final confirmation');assert(allocationConfirm.includes('חשבונית')&&allocationConfirm.includes('30'),'Invoice side still shows the selected allocation');document.getElementById('confirmAccept').click();await waitFor(()=>document.getElementById('morningOperationResult').textContent.includes('100'));
const manualDebt=state.customerDebts.find(d=>d.id==='manual-partial'),manualPayments=manualDebt.debtProgress.filter(e=>e.kind==='payment'),manualInvoices=manualDebt.debtProgress.filter(e=>e.kind==='invoice');assert(manualPayments.length===1&&manualPayments[0].source==='manual'&&manualPayments[0].amount===30,'Verified 320 does not deduct the already manual payment twice when payment allocation is disabled');assert(manualInvoices.length===1&&manualInvoices[0].source==='morning'&&manualInvoices[0].amount===30,'The same 320 may still update the invoice side independently');click('close-modal');

state.customerDebts.push({id:'reconcile-debt',customerName:'Partial reconcile',amount:100,paid:false,invoiceIssued:false,closedAt:null,phone:'456',orderNumber:'A2'});switchView('customers');
const reconcileButton=document.querySelector('[data-customer-bulk-id="reconcile-debt"] [data-action="open-morning-document"]');assert(reconcileButton,'Missing Morning button for reconciliation debt');reconcileButton.click();await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
scheduleSave('fixture new debt');fill('morningAmount','40');fill('morningDescription','Partial uncertain issue');uncertain=true;resolveStatus=false;operation=null;click('morning-create');await waitFor(()=>document.getElementById('confirmBackdrop').classList.contains('open'));
const partialConfirm=document.getElementById('confirmMessage').textContent;assert(partialConfirm.includes('המסמך חלקי ביחס לחוב'),'Partial debt warning is explicit');assert(partialConfirm.includes('40')&&partialConfirm.includes('60'),'Partial confirmation explains applied and remaining amounts');document.getElementById('confirmAccept').click();await waitFor(()=>!!operation);
const createCount=calls.filter(c=>c.action==='create').length;click('morning-create');assert(calls.filter(c=>c.action==='create').length===createCount,'Timeout triggered another POST');
await waitFor(()=>!document.querySelector('[data-action="morning-create"]').textContent.includes('מפיק'));resolveStatus=true;click('morning-reconcile');await waitFor(()=>document.getElementById('morningOperationResult').textContent.includes('100')&&document.querySelector('[data-action="morning-create"]').disabled&&!localStorage.getItem('orders.morning.pending-issuance.v1'));
assert(calls.some(c=>c.action==='status'&&c.reconcile&&c.operation_id===operation.operation_id),'Reconciliation must use operation ID');
const partialDebt=state.customerDebts.find(d=>d.id==='reconcile-debt');assert(partialDebt.debtProgress?.length===2,'Verified reconciliation applies both 320 dimensions');assert(partialDebt.debtProgress.every(e=>e.amount===40&&e.source==='morning'),'Reconciled operation applies the verified partial amount once');assert(!partialDebt.paidAt&&!partialDebt.invoiceIssuedAt&&!partialDebt.closedAt,'Partial reconciliation does not falsely close the debt');
const partialBytes=JSON.stringify(partialDebt);click('morning-reconcile');await new Promise(r=>setTimeout(r,80));assert(JSON.stringify(partialDebt)===partialBytes,'Repeated reconciliation is idempotent');uncertain=false;
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
const pdfCallsBeforeManualView=calls.filter(c=>c.action==='document_pdf').length;
click('morning-browser-view');await waitFor(()=>!document.getElementById('morningBrowserPreview').hidden&&document.getElementById('morningBrowserPreviewFrame').src.startsWith('blob:'));
assert(calls.filter(c=>c.action==='document_pdf').length===pdfCallsBeforeManualView+1,'Manual view streams exactly one fresh PDF regardless of how many issued-document PDFs were automatically loaded earlier');
assert(opened.length===0,'View remains inside the app and does not open Morning');
click('morning-download');await waitFor(()=>opened.length===1);
assert(opened[0].startsWith('https://example.org/document.pdf?fresh='),'Download still uses a fresh PDF attachment link');
assert(calls.filter(c=>c.action==='document_links').length===1,'Only download requests the external signed link');
click('close-modal');operation=null;resolveStatus=false;click('open-morning-standalone');await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
document.querySelector('input[name="morningDocumentType"][value="400"]').click();click('morning-invoice-picker');await waitFor(()=>document.querySelector('[data-action="morning-select-invoice"]'));click('morning-select-invoice');assert(document.getElementById('morningLinkedDocument').value===docs[0].id,'Manual invoice picker');
assert(JSON.stringify(partialDebt)===partialBytes,'Document browser actions do not mutate debt progress');
return {prefill:true,wholeShekelSpinner:true,noFalseUnsavedAfterIssue:true,standalone:true,verifiedDebtUpdate:true,standaloneDoesNotUpdateDebt:true,manualAllocationPreventsDoubleDeduction:true,verifiedCreate:true,officialPdfAfterCreate:true,timeout:true,operationReconciliation:true,partialReconcileUpdatesDebt:true,reconciliationIdempotent:true,liveSearch:true,pagination:true,cache:true,filters:true,details:true,freshLinks:true,manualInvoicePicker:true};
"""

with BrowserSession(ROOT/'netunim-orders/site','morning-workflow') as browser:
    result=browser.evaluate('(async()=>{'+FLOW+'})()',timeout=60)
    print(json.dumps(result))
    assert result and all(result.values())
print('PASS Morning UI workflows')

from runtime_morning_audit import run as run_safety_audit
run_safety_audit()

from runtime_morning_resolution import run as run_resolution_audit
run_resolution_audit()
