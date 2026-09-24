"""Morning UI workflows with deterministic transport; never issues real documents."""
from browser_harness import LegacyBrowserSession as BrowserSession, ROOT
import json
from runtime_morning_cloud import LOCAL_CLOUD

FLOW=LOCAL_CLOUD+r"""
const assert=(value,message)=>{if(!value)throw new Error(message)};
const errors=[];window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason?.stack||event.reason)));
const confirmationSnapshot=()=>({open:!!document.getElementById('confirmBackdrop')?.classList.contains('open'),title:document.getElementById('confirmTitle')?.textContent||'',message:document.getElementById('confirmMessage')?.textContent||''});
const waitFor=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw new Error('Morning UI timed out '+document.getElementById('morningConnectionStatus')?.textContent+' '+JSON.stringify(calls.slice(-3))+' '+JSON.stringify(errors)+' '+document.querySelector('[data-action="morning-create"]')?.outerHTML+' confirmation='+JSON.stringify(confirmationSnapshot()))};
const click=name=>{const button=document.querySelector('[data-action="'+name+'"]');assert(button,'Missing action '+name);button.click()};
const waitForIssueConfirmation=async predicate=>{const before=confirmationSnapshot();assert(!before.open,'Stale confirmation before Morning issue: '+before.title+' | '+before.message);await waitFor(()=>{const current=confirmationSnapshot();return current.open&&current.title==='הפקת מסמך רשמי'&&predicate(current.message)});return confirmationSnapshot().message};
const issueAndWaitForConfirmation=async predicate=>{const pending=waitForIssueConfirmation(predicate);click('morning-create');return await pending};
const closeSavedMorningModal=async context=>{click('close-modal');const confirmation=confirmationSnapshot();assert(!confirmation.open,context+' unexpectedly triggered an unsaved-changes confirmation: '+confirmation.title+' | '+confirmation.message);await waitFor(()=>!document.getElementById('modalBackdrop')?.classList.contains('open'))};
const fill=(id,value)=>{document.getElementById(id).value=value};
const setReceiptAmount=value=>{const payment=document.querySelector('[data-payment-row] [data-payment-field="price"]');assert(payment,'Missing editable receipt amount');payment.value=String(value);payment.dispatchEvent(new Event('input',{bubbles:true}));};
const setDocumentAmount=value=>{const amount=document.getElementById('morningAmount');assert(amount,'Missing document amount');amount.value=String(value);amount.dispatchEvent(new Event('input',{bubbles:true}));};
const stageFixtureState=message=>{scheduleSave(message);clearTimeout(saveTimer);saveTimer=null};
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
state=normalizeState({version:4,customerDebts:[{id:'prefill-only',customerName:'Verified debt',amount:100,paid:false,invoiceIssued:false,closedAt:null,phone:'123',orderNumber:'A1',customerId:'123456782',clearingApproval:'4444'}]});stageFixtureState('fixture initial debt');
switchView('customers');click('open-morning-document');await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
assert(document.getElementById('morningClientName').value==='Verified debt','Client prefilled');assert(document.getElementById('morningAmount').value==='100.00','Amount prefilled');
const morningAmount=document.getElementById('morningAmount'),receiptAmount=document.querySelector('[data-payment-row] [data-payment-field="price"]');assert(!morningAmount.readOnly,'Payment documents keep the intended document amount independently editable');assert(receiptAmount&&receiptAmount.step==='1','Receipt spinner uses whole-shekel step');assert(document.getElementById('morningPaymentSummary').textContent.includes('100'),'Payment summary starts from the prefilled receipt total');receiptAmount.stepUp();receiptAmount.dispatchEvent(new Event('input',{bubbles:true}));assert(Number(receiptAmount.value)===101&&Number(morningAmount.value)===100,'Editing a receipt must not overwrite the intended document amount');assert(document.getElementById('morningPaymentSummary').classList.contains('is-mismatch')&&document.getElementById('morningPaymentMatch').textContent.includes('לא תואם')&&morningAmount.getAttribute('aria-invalid')==='true','Receipt/document mismatch is visible immediately');setReceiptAmount(100);assert(document.getElementById('morningPaymentSummary').classList.contains('is-match'),'Matching totals are visibly confirmed');
const paymentType=document.querySelector('[data-payment-row] [data-payment-field="type"]'),transferFields=document.querySelector('[data-payment-row] [data-payment-kinds="4"]'),bankFields=document.querySelector('[data-payment-row] [data-payment-kinds="2,4"]'),checkFields=document.querySelector('[data-payment-row] [data-payment-kinds="2"]'),cardFields=document.querySelector('[data-payment-row] [data-payment-kinds="3"]'),bankInput=document.querySelector('[data-payment-row] [data-payment-field="bankName"]'),cardNum=document.querySelector('[data-payment-row] [data-payment-field="cardNum"]');
const setPaymentType=type=>{paymentType.value=String(type);paymentType.dispatchEvent(new Event('change',{bubbles:true}))};
assert(paymentType.value==='3'&&cardNum?.value==='****','Debt clearing approval defaults the receipt to credit card with a four-asterisk suffix');assert(document.getElementById('morningClientTaxId').value==='123456782','Debt customer ID prefills Morning tax ID');assert(document.getElementById('morningRemarks').value.includes('4444'),'Debt clearing approval prefills Morning remarks');
assert(document.querySelector('#morningBankDirectory option[value^="12 ·"]')&&bankInput?.getAttribute('list')==='morningBankDirectory','Bank payment field is connected to the code/name autocomplete directory');
setPaymentType(1);assert(transferFields.hidden&&bankFields.hidden&&checkFields.hidden&&cardFields.hidden,'Cash shows only date and amount fields');
setPaymentType(2);assert(transferFields.hidden&&!bankFields.hidden&&!checkFields.hidden&&cardFields.hidden,'Cheque shows bank, branch, account and cheque number only');
setPaymentType(3);assert(transferFields.hidden&&bankFields.hidden&&checkFields.hidden&&!cardFields.hidden,'Credit card shows card fields only');cardNum.value='';setPaymentType(4);setPaymentType(3);assert(cardNum.value==='****','Returning to credit card auto-fills a blank suffix with four asterisks');cardNum.value='9876';setPaymentType(4);setPaymentType(3);assert(cardNum.value==='9876','Explicit four digits are preserved instead of being replaced by asterisks');
setPaymentType(4);assert(!transferFields.hidden&&!bankFields.hidden&&checkFields.hidden&&cardFields.hidden,'Bank transfer shows transfer reference and bank account fields only');
fill('morningDescription','Edited before issue');assert(uiModal.modalHasUnsavedDraft(),'Morning edits arm the generic draft guard before issue');
setDocumentAmount(99);const callsBeforeMismatchPreview=calls.length;click('morning-preview');await new Promise(r=>setTimeout(r,60));assert(calls.length===callsBeforeMismatchPreview,'Preview is blocked locally when document and receipt totals differ');assert(document.getElementById('toast').textContent.includes('אינו תואם לסך התקבולים'),'Mismatch explains exactly why preview/issuance is blocked');setDocumentAmount(100);assert(document.getElementById('morningPaymentSummary').classList.contains('is-match'),'Fixing the document amount restores a matching summary');
assert(!document.querySelector('.morning-history'),'Debt history removed');
const fullConfirm=await issueAndWaitForConfirmation(text=>text.includes('עדכון החוב לאחר אימות')&&text.includes('Verified debt'));assert(fullConfirm.includes('עדכון החוב לאחר אימות'),'Debt-linked issuance explains automatic update');assert(fullConfirm.includes('תשלום')&&fullConfirm.includes('חשבונית'),'320 confirmation covers payment and invoice');
document.getElementById('confirmAccept').click();await waitFor(()=>document.getElementById('morningOperationResult').textContent.includes('100'));
await waitFor(()=>!document.getElementById('morningPreviewBox').hidden&&document.getElementById('morningPreviewFrame').src.startsWith('blob:'));
assert(calls.filter(c=>c.action==='document_pdf').length===1,'Verified issuance automatically loads the official Morning PDF');assert(document.getElementById('morningPreviewNote').textContent.includes('מסמך רשמי'),'Issued preview is explicitly official');
assert(document.querySelector('[data-action="morning-create"]').disabled&&document.querySelector('[data-action="morning-create"]').textContent.includes('הופק ואומת'),'Verified issuance locks the same dialog against accidental duplicate creation');
const verifiedDebt=state.customerDebts.find(d=>d.id==='prefill-only');assert(verifiedDebt.debtProgress?.length===2,'Verified 320 records payment and invoice progress');assert(verifiedDebt.debtProgress.every(e=>e.source==='morning'&&e.amount===100),'Verified progress is sourced from Morning at exact debt amount');assert(verifiedDebt.paidAt&&verifiedDebt.invoiceIssuedAt&&verifiedDebt.closedAt,'Verified full 320 closes both debt dimensions');
const linkedAfterVerified=JSON.stringify(verifiedDebt);assert(!uiModal.modalHasUnsavedDraft(),'Verified issuance commits the Morning modal draft baseline');
await closeSavedMorningModal('Closing a verified Morning document');
const linkedMovement=document.createElement('button');linkedMovement.dataset.action='morning-open-document';linkedMovement.dataset.clickArg0=docs[0].id;document.getElementById('main').append(linkedMovement);
const linkedPdfBefore=calls.filter(c=>c.action==='document_pdf').length;linkedMovement.click();await waitFor(()=>!!document.getElementById('morningStandalonePreviewFrame')?.src.startsWith('blob:'));
assert(calls.filter(c=>c.action==='document_pdf').length===linkedPdfBefore+1,'A linked movement opens a fresh official PDF in its own viewer');click('close-modal');linkedMovement.remove();

click('open-morning-standalone');await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);assert(document.getElementById('morningClientName').value==='','Standalone starts empty');
fill('morningClientName','General');setDocumentAmount(100);setReceiptAmount(100);fill('morningDescription','General document');const standaloneConfirm=await issueAndWaitForConfirmation(text=>text.includes('General')&&text.includes('100'));assert(!standaloneConfirm.includes('עדכון החוב לאחר אימות'),'Standalone issuance does not claim a debt update');document.getElementById('confirmAccept').click();await waitFor(()=>document.getElementById('morningOperationResult').textContent.includes('100'));
assert(JSON.stringify(verifiedDebt)===linkedAfterVerified,'Standalone issuance does not mutate a debt');await closeSavedMorningModal('Closing a verified standalone Morning document');

// A Morning receipt may document a payment that was already entered manually. The explicit local allocation policy must prevent double deduction.
state.customerDebts.push({id:'manual-partial',customerName:'Already paid manually',amount:100,paid:false,invoiceIssued:false,closedAt:null,phone:'555',orderNumber:'A-MAN',debtProgress:[{id:'MANUAL-PAY-30',kind:'payment',action:'add',amount:30,source:'manual',createdAt:'2026-09-09T09:00:00.000Z'}]});stageFixtureState('fixture manual partial debt');switchView('customers');
const manualButton=document.querySelector('[data-customer-bulk-id="manual-partial"] [data-action="open-morning-document"]');assert(manualButton,'Missing Morning button for manual partial debt');manualButton.click();await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
assert(document.getElementById('morningApplyPayment').checked&&document.getElementById('morningApplyInvoice').checked,'320 defaults to applying both local debt dimensions');assert(document.getElementById('morningDebtUpdatePanel').textContent.includes('כבר רשום תשלום')&&document.getElementById('morningDebtUpdatePanel').textContent.includes('30'),'Existing manual payment is prominently surfaced before issuance');
document.getElementById('morningApplyPayment').checked=false;setDocumentAmount(30);setReceiptAmount(30);fill('morningDescription','Receipt for already-recorded payment');const allocationConfirm=await issueAndWaitForConfirmation(text=>text.includes('תשלום: לא יעודכן')&&text.includes('Already paid manually'));assert(allocationConfirm.includes('תשלום: לא יעודכן'),'Explicit payment opt-out is repeated in final confirmation');assert(allocationConfirm.includes('חשבונית')&&allocationConfirm.includes('30'),'Invoice side still shows the selected allocation');document.getElementById('confirmAccept').click();await waitFor(()=>document.getElementById('morningOperationResult').textContent.includes('100'));
const manualDebt=state.customerDebts.find(d=>d.id==='manual-partial'),manualPayments=manualDebt.debtProgress.filter(e=>e.kind==='payment'),manualInvoices=manualDebt.debtProgress.filter(e=>e.kind==='invoice');assert(manualPayments.length===1&&manualPayments[0].source==='manual'&&manualPayments[0].amount===30,'Verified 320 does not deduct the already manual payment twice when payment allocation is disabled');assert(manualInvoices.length===1&&manualInvoices[0].source==='morning'&&manualInvoices[0].amount===30,'The same 320 may still update the invoice side independently');await closeSavedMorningModal('Closing a verified manual-allocation Morning document');

state.customerDebts.push({id:'reconcile-debt',customerName:'Partial reconcile',amount:100,paid:false,invoiceIssued:false,closedAt:null,phone:'456',orderNumber:'A2'});stageFixtureState('fixture reconciliation debt');switchView('customers');
const reconcileButton=document.querySelector('[data-customer-bulk-id="reconcile-debt"] [data-action="open-morning-document"]');assert(reconcileButton,'Missing Morning button for reconciliation debt');reconcileButton.click();await waitFor(()=>!document.querySelector('[data-action="morning-create"]').disabled);
setDocumentAmount(40);setReceiptAmount(40);fill('morningDescription','Partial uncertain issue');uncertain=true;resolveStatus=false;operation=null;const partialConfirm=await issueAndWaitForConfirmation(text=>text.includes('המסמך חלקי ביחס לחוב')&&text.includes('Partial reconcile')&&text.includes('40')&&text.includes('60'));assert(partialConfirm.includes('המסמך חלקי ביחס לחוב'),'Partial debt warning is explicit');assert(partialConfirm.includes('40')&&partialConfirm.includes('60'),'Partial confirmation explains applied and remaining amounts');document.getElementById('confirmAccept').click();await waitFor(()=>!!operation);
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
return {prefill:true,clearingDefaultsToCard:true,maskedCardSuffix:true,wholeShekelSpinner:true,noFalseUnsavedAfterIssue:true,standalone:true,verifiedDebtUpdate:true,standaloneDoesNotUpdateDebt:true,manualAllocationPreventsDoubleDeduction:true,verifiedCreate:true,officialPdfAfterCreate:true,timeout:true,operationReconciliation:true,partialReconcileUpdatesDebt:true,reconciliationIdempotent:true,liveSearch:true,pagination:true,cache:true,filters:true,details:true,freshLinks:true,manualInvoicePicker:true};
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
